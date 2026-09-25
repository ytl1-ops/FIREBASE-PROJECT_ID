/**
 * Transcription haute fidélité (audio complet, séparation des voix), par tâches suivies :
 * une réunion longue peut demander plusieurs minutes, sans coupure réseau.
 *
 * Fournisseurs :
 * - « local » (par défaut) : service MonMeeting ASR auto-hébergé (faster-whisper + sherpa-onnx) ;
 * - « gladia » : service Gladia (facultatif, clé GLADIA_API_KEY).
 */
import { GladiaClient } from "@gladiaio/sdk";
import { openAsBlob } from "node:fs";
import { rm } from "node:fs/promises";
import crypto from "node:crypto";
import type { TranscriptionResponse } from "../shared/types.ts";

export type TranscriptionProvider = "local" | "gladia";
export const TRANSCRIPTION_PROVIDER: TranscriptionProvider =
  process.env.TRANSCRIPTION_PROVIDER === "gladia" ? "gladia" : "local";
const ASR_URL = (process.env.ASR_URL ?? "http://localhost:8000").replace(/\/$/, "");

export interface TranscribeOptions {
  /** Codes ISO 639-1 ; vide = détection automatique. */
  languages: string[];
  /** Nombre de locuteurs attendu (améliore nettement la séparation des voix). */
  speakers?: number;
  /** Noms propres, sigles, termes métier à reconnaître. */
  vocabulary: string[];
}

export interface JobState {
  status: "queued" | "running" | "done" | "error";
  label: string;
  progress: number;
  result?: TranscriptionResponse;
  error?: string;
}

export async function transcriptionAvailable(): Promise<boolean> {
  if (TRANSCRIPTION_PROVIDER === "gladia") return Boolean(process.env.GLADIA_API_KEY);
  try {
    const res = await fetch(`${ASR_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Suivi des tâches

const jobs = new Map<string, JobState & { updated: number; remoteId?: string }>();
const JOB_TTL = 6 * 3600 * 1000;

function purge() {
  const limit = Date.now() - JOB_TTL;
  for (const [id, job] of jobs) if (job.updated < limit) jobs.delete(id);
}

function update(id: string, patch: Partial<JobState>) {
  const job = jobs.get(id);
  if (job) Object.assign(job, patch, { updated: Date.now() });
}

/** Lance une transcription en arrière-plan ; le fichier temporaire est supprimé à la fin. */
export async function startTranscription(
  filePath: string,
  fileName: string,
  options: TranscribeOptions,
): Promise<string> {
  purge();
  const id = crypto.randomUUID();
  jobs.set(id, { status: "queued", label: "En file d'attente", progress: 0, updated: Date.now() });

  if (TRANSCRIPTION_PROVIDER === "local") {
    try {
      const form = new FormData();
      form.append("audio", await openAsBlob(filePath), fileName);
      form.append("languages", options.languages.join(","));
      if (options.speakers) form.append("speakers", String(options.speakers));
      form.append("vocabulary", options.vocabulary.join("\n"));
      const res = await fetch(`${ASR_URL}/jobs`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Service de transcription : erreur ${res.status}.`);
      const { id: remoteId } = (await res.json()) as { id: string };
      jobs.get(id)!.remoteId = remoteId;
    } catch (err) {
      jobs.delete(id);
      throw err instanceof TypeError
        ? new Error(`Service de transcription injoignable (${ASR_URL}). Vérifiez qu'il est démarré.`)
        : err;
    } finally {
      await rm(filePath, { force: true });
    }
    return id;
  }

  // Gladia : le SDK attend la fin de la tâche ; on l'exécute en arrière-plan.
  update(id, { status: "running", label: "Transcription (service Gladia)", progress: 0.1 });
  void transcribeWithGladia(filePath, options)
    .then((result) => update(id, { status: "done", label: "Terminé", progress: 1, result }))
    .catch((err: unknown) =>
      update(id, { status: "error", error: err instanceof Error ? err.message : String(err) }),
    )
    .finally(() => void rm(filePath, { force: true }));
  return id;
}

export async function getTranscription(id: string): Promise<JobState | null> {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.remoteId && job.status !== "done" && job.status !== "error") {
    try {
      const res = await fetch(`${ASR_URL}/jobs/${job.remoteId}`);
      if (res.status === 404) {
        update(id, { status: "error", error: "Tâche perdue (service de transcription redémarré ?)." });
      } else if (res.ok) {
        const remote = (await res.json()) as JobState;
        update(id, {
          status: remote.status,
          label: remote.label,
          progress: remote.progress,
          result: remote.result,
          error: remote.error,
        });
      }
    } catch {
      // Service momentanément injoignable : on renverra le dernier état connu.
    }
  }
  const { status, label, progress, result, error } = jobs.get(id)!;
  if (status === "done" || status === "error") jobs.delete(id);
  return { status, label, progress, result, error };
}

// ---------------------------------------------------------------- Gladia (facultatif)

let gladia: GladiaClient | null = null;

async function transcribeWithGladia(filePath: string, options: TranscribeOptions): Promise<TranscriptionResponse> {
  gladia ??= new GladiaClient();
  const vocabulary = options.vocabulary.map((v) => v.trim()).filter(Boolean).slice(0, 1000);
  const job = await gladia.preRecorded().transcribe(
    filePath,
    {
      diarization: true,
      diarization_config: options.speakers ? { number_of_speakers: options.speakers } : undefined,
      language_config: options.languages.length
        ? {
            // Les codes proviennent d'une liste fermée côté interface.
            languages: options.languages as never,
            code_switching: options.languages.length > 1,
          }
        : { code_switching: true },
      punctuation_enhanced: true,
      custom_vocabulary: vocabulary.length > 0,
      custom_vocabulary_config: vocabulary.length ? { vocabulary } : undefined,
    },
    { timeout: 60 * 60 * 1000 },
  );
  const transcription = job.result?.transcription;
  if (job.status !== "done" || !transcription) {
    throw new Error(`Transcription échouée (statut ${job.status}, code ${job.error_code ?? "?"}).`);
  }
  return {
    languages: transcription.languages.map(String),
    segments: transcription.utterances.map((u) => ({
      start: Math.round(u.start * 1000),
      end: Math.round(u.end * 1000),
      speaker: `Locuteur ${(u.speaker ?? 0) + 1}`,
      text: u.text.trim(),
    })),
  };
}
