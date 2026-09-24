/** Messages échangés entre l'interface et le worker de transcription locale. */

export interface LocalRequest {
  /** Audio mono 16 kHz. */
  audio: Float32Array;
  model: string;
  /** Nom de langue Whisper (« french »…), vide = détection automatique. */
  language?: string;
  speakers?: number;
  diarize: boolean;
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
  | { type: "done"; segments: LocalSegment[]; device: string }
  | { type: "error"; message: string };

export const LOCAL_MODELS = [
  {
    id: "onnx-community/whisper-base",
    label: "Rapide",
    detail: "≈ 80 Mo, convient aux ordinateurs modestes",
  },
  {
    id: "onnx-community/whisper-small",
    label: "Équilibré",
    detail: "≈ 250 Mo, bon compromis qualité/vitesse",
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Précis",
    detail: "≈ 800 Mo, carte graphique récente (WebGPU) recommandée",
  },
] as const;
