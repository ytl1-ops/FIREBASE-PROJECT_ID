/** Messages échangés avec le worker de rédaction par IA locale (sur l'appareil). */

export interface LlmRequest {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  maxNewTokens: number;
  modelHost?: string;
}

export type LlmResponse =
  | { type: "progress"; label: string; progress: number }
  | { type: "text"; text: string }
  | { type: "done"; text: string; model: string; device: string }
  | { type: "error"; message: string };

/** Modèles instruits multilingues au format ONNX (téléchargés une fois, puis hors ligne). */
export const LLM_MODELS = {
  /** Ordinateur avec carte graphique (WebGPU) : ≈ 1,2 Go. */
  webgpu: { id: "onnx-community/Qwen2.5-1.5B-Instruct", dtype: "q4f16" },
  /** Processeur seul (téléphone, PC sans WebGPU) : ≈ 500 Mo, plus lent. */
  wasm: { id: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q4" },
} as const;
