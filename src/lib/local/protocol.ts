/** Messages échangés entre l'interface et le worker de transcription locale. */

export interface LocalRequest {
  /** Audio mono 16 kHz. */
  audio: Float32Array;
  model: string;
  /** Nom de langue Whisper (« french »…), vide = détection automatique. */
  language?: string;
  speakers?: number;
  diarize: boolean;
  /** Serveur de modèles (défaut : Hugging Face) — miroir interne possible. */
  modelHost?: string;
}

export interface LocalSegment {
  start: number; // secondes
  end: number;
  text: string;
  speaker: number;
}

export type LocalResponse =
  | { type: "progress"; phase: "download" | "transcribe" | "speakers"; label: string; progress: number }
  | { type: "partial"; segments: LocalSegment[] }
  | { type: "done"; segments: LocalSegment[]; device: string; warning?: string }
  | { type: "error"; message: string };

export const LOCAL_MODELS = [
  {
    id: "onnx-community/whisper-base",
    label: "Rapide",
    detail: "≈ 150 Mo, recommandé sur téléphone",
  },
  {
    id: "onnx-community/whisper-small",
    label: "Équilibré",
    detail: "≈ 450 Mo, ordinateur conseillé",
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Précis",
    detail: "≈ 1 Go, ordinateur avec carte graphique récente",
  },
] as const;

/** Téléphone ou appareil peu doté en mémoire : modèle « Rapide » par défaut. */
export function defaultLocalModel(): string {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const lowMemory = (nav.deviceMemory ?? 8) <= 4;
  return mobile || lowMemory ? LOCAL_MODELS[0].id : LOCAL_MODELS[1].id;
}
