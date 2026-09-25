/**
 * Mode AUTONOME : rédaction et questions entièrement sur l'appareil, sans serveur, sans clé,
 * sans Claude ni autre service d'IA.
 * - « Extraction » : instantané, tout appareil, aucun téléchargement (shared/extraction.ts) ;
 * - « IA locale » : petit modèle de langage dans le navigateur (téléchargé une fois).
 */
import { ficheAnalyse, redigerSansIA } from "../../shared/extraction.ts";
import { SYSTEM_PROMPT, buildUserPrompt } from "../../shared/prompts.ts";
import { formatTranscript } from "../../shared/transcript.ts";
import type { GenerateRequest } from "../../shared/types.ts";
import { getModelHost } from "./api.ts";
import { withPdfText } from "./cloud.ts";
import type { LlmRequest, LlmResponse } from "./local/llm-protocol.ts";

export type MoteurRedaction = "auto" | "extraction" | "ia-locale";

const KEY = "monmeeting.redaction";

export function getMoteur(): MoteurRedaction {
  try {
    const v = localStorage.getItem(KEY);
    return v === "extraction" || v === "ia-locale" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function saveMoteur(m: MoteurRedaction) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // stockage indisponible
  }
}

/** Rédaction instantanée par extraction (aucune IA). */
export async function redigerExtraction(req: GenerateRequest): Promise<{ text: string; model: string }> {
  const attachments = await withPdfText(req.attachments);
  return { text: redigerSansIA({ ...req, attachments }), model: "Extraction sur l'appareil (sans IA)" };
}

/** Au-delà, la réunion est remplacée par sa fiche d'analyse (mémoire limitée des petits modèles). */
const MAX_CARACTERES_DIRECTS = 12_000;

export async function redigerIaLocale(
  req: GenerateRequest,
  onText: (full: string) => void,
  onProgress: (label: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
  const attachments = await withPdfText(req.attachments);
  let prepared: GenerateRequest = { ...req, attachments };
  const brut = formatTranscript(req.transcript, req.meeting.participants).length + (req.notes?.length ?? 0);
  if (brut > MAX_CARACTERES_DIRECTS || (attachments ?? []).some((a) => (a.text?.length ?? 0) > 6000)) {
    onProgress("Analyse de la réunion…");
    prepared = {
      ...req,
      attachments: undefined,
      notes: "",
      transcript: [{ id: "fiche", start: 0, kind: "note", text: `Fiche d'analyse de la réunion (extraits horodatés) :\n${ficheAnalyse({ ...req, attachments })}` }],
    };
  }
  const request: LlmRequest = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(prepared) },
    ],
    maxNewTokens: 1800,
    modelHost: getModelHost() || undefined,
  };

  const worker = new Worker(new URL("./local/llm-worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const stop = () => {
      worker.terminate();
      reject(new DOMException("Rédaction annulée", "AbortError"));
    };
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<LlmResponse>) => {
      const msg = event.data;
      if (msg.type === "progress") onProgress(msg.progress > 0 ? `${msg.label} ${Math.round(msg.progress * 100)} %` : msg.label);
      else if (msg.type === "text") onText(msg.text);
      else {
        signal?.removeEventListener("abort", stop);
        worker.terminate();
        if (msg.type === "done") resolve({ text: msg.text, model: msg.model });
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "L'IA locale s'est arrêtée (mémoire insuffisante ?). Utilisez le mode « Extraction »."));
    };
    worker.postMessage(request);
  });
}
