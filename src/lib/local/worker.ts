/// <reference lib="webworker" />
/**
 * Transcription 100 % locale, exécutée dans un Web Worker :
 * 1. Whisper transcrit l'audio fenêtre par fenêtre (horodatage par phrase) ;
 * 2. WavLM calcule une empreinte vocale par phrase ;
 * 3. les empreintes sont regroupées par voix (« Locuteur N »).
 * Les modèles sont téléchargés une seule fois puis conservés dans le cache du navigateur.
 * L'audio ne quitte jamais l'appareil.
 */
import {
  AutoModel,
  AutoProcessor,
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";
// Moteur ONNX servi par l'application elle-même (aucun téléchargement depuis un CDN tiers).
// Variante simple (14 Mo) sur processeur ; variante « asyncify » (27 Mo) requise pour WebGPU.
import ortAsyncifyMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortAsyncifyWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { clusterEmbeddings, isHallucination, isSilent, splitWindows } from "./signal.ts";
import type { LocalRequest, LocalResponse, LocalSegment } from "./protocol.ts";

const SAMPLE_RATE = 16_000;
const SPEAKER_MODEL = "Xenova/wavlm-base-plus-sv";

const post = (msg: LocalResponse) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

function downloadProgress(label: string) {
  return (info: ProgressInfo) => {
    if (info.status === "progress_total") {
      post({ type: "progress", phase: "download", label, progress: info.progress / 100 });
    }
  };
}

async function transcribe(req: LocalRequest) {
  const { audio, model, language, speakers, diarize } = req;
  const webgpu = await hasWebGpu();
  const onnx = env.backends.onnx;
  if (onnx?.wasm) {
    onnx.wasm.wasmPaths = webgpu ? { mjs: ortAsyncifyMjs, wasm: ortAsyncifyWasm } : { mjs: ortMjs, wasm: ortWasm };
  }
  // Import direct du moteur (pas de copie en « blob: »), compatible avec la CSP stricte.
  env.useWasmCache = false;

  post({ type: "progress", phase: "download", label: "Modèle de transcription", progress: 0 });
  const asr = (await pipeline("automatic-speech-recognition", model, {
    device: webgpu ? "webgpu" : "wasm",
    // L'encodeur reste en pleine précision : quantifié, il produit du texte incohérent.
    dtype: webgpu
      ? { encoder_model: "fp32", decoder_model_merged: "q4" }
      : { encoder_model: "fp32", decoder_model_merged: "q8" },
    progress_callback: downloadProgress("Modèle de transcription"),
  })) as AutomaticSpeechRecognitionPipeline;

  // 1. Transcription fenêtre par fenêtre.
  const windows = splitWindows(audio, SAMPLE_RATE);
  const segments: LocalSegment[] = [];
  for (let i = 0; i < windows.length; i++) {
    const win = windows[i];
    post({ type: "progress", phase: "transcribe", label: "Transcription", progress: i / windows.length });
    if (isSilent(audio, win)) continue;
    const offset = win.start / SAMPLE_RATE;
    const output = await asr(audio.subarray(win.start, win.end), {
      return_timestamps: true,
      task: "transcribe",
      ...(language ? { language } : {}),
    });
    const winEnd = win.end / SAMPLE_RATE;
    for (const chunk of output.chunks ?? [{ text: output.text, timestamp: [0, winEnd - offset] }]) {
      const text = chunk.text.trim();
      if (!text || isHallucination(text)) continue;
      if (segments.length && segments[segments.length - 1].text === text) continue; // répétition
      const [s, e] = chunk.timestamp;
      const start = Math.min(offset + (s ?? 0), winEnd);
      const end = Math.min(e == null ? winEnd : offset + e, winEnd);
      segments.push({ start, end: Math.max(end, start + 0.2), text, speaker: 0 });
    }
    // Aperçu progressif : l'interface affiche les phrases au fur et à mesure.
    post({ type: "partial", segments });
  }
  await asr.dispose();

  // 2 & 3. Identification des voix.
  if (diarize && segments.length > 1 && speakers !== 1) {
    post({ type: "progress", phase: "download", label: "Modèle d'empreinte vocale", progress: 0 });
    const processor = await AutoProcessor.from_pretrained(SPEAKER_MODEL, {
      progress_callback: downloadProgress("Modèle d'empreinte vocale"),
    });
    const speakerModel = await AutoModel.from_pretrained(SPEAKER_MODEL, {
      device: "wasm",
      dtype: "q8",
      progress_callback: downloadProgress("Modèle d'empreinte vocale"),
    });

    const embeddings: Float32Array[] = [];
    const embedded: number[] = [];
    for (let i = 0; i < segments.length; i++) {
      post({ type: "progress", phase: "speakers", label: "Identification des voix", progress: i / segments.length });
      const seg = segments[i];
      // Phrases trop courtes (< 1 s) : empreinte peu fiable, rattachées ensuite à leur voisine.
      if (seg.end - seg.start < 1) continue;
      const from = Math.floor(seg.start * SAMPLE_RATE);
      const to = Math.min(Math.floor(seg.end * SAMPLE_RATE), from + 10 * SAMPLE_RATE);
      const inputs = await processor(audio.slice(from, to));
      const { embeddings: tensor } = await speakerModel(inputs);
      embeddings.push(new Float32Array(tensor.data as Float32Array));
      embedded.push(i);
    }
    await speakerModel.dispose();

    const labels = clusterEmbeddings(embeddings, { k: speakers });
    embedded.forEach((segIndex, j) => (segments[segIndex].speaker = labels[j]));
    // Les phrases courtes prennent la voix de la phrase précédente (ou suivante en début).
    const known = new Set(embedded);
    let last = labels[0] ?? 0;
    segments.forEach((seg, i) => {
      if (known.has(i)) last = seg.speaker;
      else seg.speaker = last;
    });
  }

  post({ type: "done", segments, device: webgpu ? "webgpu" : "wasm" });
}

self.onmessage = (event: MessageEvent<LocalRequest>) => {
  transcribe(event.data).catch((err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    const message = /fetch|network|load|404/i.test(raw)
      ? `Téléchargement du modèle impossible (${raw}). Le premier usage nécessite une connexion Internet vers huggingface.co ; ensuite la transcription fonctionne hors ligne.`
      : /memory|allocation|OOM/i.test(raw)
        ? `Mémoire insuffisante (${raw}). Choisissez la qualité « Rapide » ou fermez d'autres onglets.`
        : `Échec de la transcription locale : ${raw}`;
    post({ type: "error", message });
  });
};
