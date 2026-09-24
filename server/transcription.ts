import { GladiaClient } from "@gladiaio/sdk";
import type { TranscriptionResponse } from "../shared/types.ts";

/**
 * Transcription haute fidélité « style Plaud » : l'enregistrement complet est transcrit
 * a posteriori, avec séparation des locuteurs (diarisation) et vocabulaire métier.
 *
 * Fournisseur : Gladia (société française, hébergement UE), clé GLADIA_API_KEY.
 */
export function transcriptionConfigured(): boolean {
  return Boolean(process.env.GLADIA_API_KEY);
}

export interface TranscribeOptions {
  /** Codes ISO 639-1 ; vide = détection automatique. */
  languages: string[];
  /** Nombre de locuteurs attendu (améliore nettement la diarisation). */
  speakers?: number;
  /** Noms propres, sigles, termes métier à reconnaître. */
  vocabulary: string[];
}

let client: GladiaClient | null = null;

export async function transcribeFile(
  filePath: string,
  options: TranscribeOptions,
): Promise<TranscriptionResponse> {
  client ??= new GladiaClient();
  const vocabulary = options.vocabulary.map((v) => v.trim()).filter(Boolean).slice(0, 1000);

  const job = await client.preRecorded().transcribe(
    filePath,
    {
      diarization: true,
      diarization_config: options.speakers
        ? { number_of_speakers: options.speakers }
        : undefined,
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
