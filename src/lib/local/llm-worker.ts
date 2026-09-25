/// <reference lib="webworker" />
/**
 * Rédaction par IA locale : un petit modèle de langage (Qwen2.5 Instruct, ONNX) exécuté dans
 * le navigateur. Téléchargé une seule fois, il fonctionne ensuite hors ligne ; aucun texte de
 * la réunion ne quitte l'appareil.
 */
import { TextStreamer, pipeline, type ProgressInfo, type TextGenerationPipeline } from "@huggingface/transformers";
import { LLM_MODELS, type LlmRequest, type LlmResponse } from "./llm-protocol.ts";
import { configureOnnx } from "./onnx.ts";

const post = (msg: LlmResponse) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

async function run(req: LlmRequest) {
  const webgpu = await configureOnnx(req.modelHost);
  const choice = webgpu ? LLM_MODELS.webgpu : LLM_MODELS.wasm;
  post({ type: "progress", label: "Téléchargement du modèle de rédaction (une seule fois)", progress: 0 });
  const generator: TextGenerationPipeline = await pipeline("text-generation", choice.id, {
    device: webgpu ? "webgpu" : "wasm",
    dtype: choice.dtype,
    progress_callback: (info: ProgressInfo) => {
      if (info.status === "progress_total") {
        post({ type: "progress", label: "Téléchargement du modèle de rédaction (une seule fois)", progress: info.progress / 100 });
      }
    },
  });

  post({ type: "progress", label: "Rédaction sur l'appareil…", progress: 0 });
  let text = "";
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      text += chunk;
      post({ type: "text", text });
    },
  });
  await generator(req.messages, { max_new_tokens: req.maxNewTokens, do_sample: false, repetition_penalty: 1.1, streamer });
  await generator.dispose();
  post({ type: "done", text: text.trim(), model: `${choice.id.split("/")[1]} (sur l'appareil)`, device: webgpu ? "webgpu" : "wasm" });
}

self.onmessage = (event: MessageEvent<LlmRequest>) => {
  run(event.data).catch((err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    const message = /fetch|network|load|404/i.test(raw)
      ? `Téléchargement du modèle impossible (${raw}). Le premier usage nécessite une connexion vers huggingface.co (ou un miroir interne) ; ensuite l'IA locale fonctionne hors ligne. Le mode « Extraction » reste disponible sans téléchargement.`
      : /memory|allocation|OOM/i.test(raw)
        ? `Mémoire insuffisante pour l'IA locale (${raw}). Utilisez le mode « Extraction » (instantané, sans modèle).`
        : `Échec de l'IA locale : ${raw}`;
    post({ type: "error", message });
  });
};
