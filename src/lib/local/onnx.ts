/** Configuration commune du moteur ONNX des workers (servi par l'application, compatible CSP). */
import { env } from "@huggingface/transformers";
import ortAsyncifyMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortAsyncifyWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

export async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

export const isMobile = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

/** Choisit WebGPU (ordinateur) ou le processeur, et pointe vers les fichiers ONNX locaux. */
export async function configureOnnx(modelHost?: string): Promise<boolean> {
  // Serveur de modèles : Hugging Face par défaut, ou miroir interne (entreprise).
  if (modelHost) env.remoteHost = modelHost.replace(/\/?$/, "/");
  // Téléphones : WebGPU encore instable sur beaucoup de puces mobiles ; le processeur est sûr.
  const webgpu = !isMobile() && (await hasWebGpu());
  const onnx = env.backends.onnx;
  if (onnx?.wasm) {
    // Variante simple (14 Mo) sur processeur ; variante « asyncify » (27 Mo) requise pour WebGPU.
    onnx.wasm.wasmPaths = webgpu ? { mjs: ortAsyncifyMjs, wasm: ortAsyncifyWasm } : { mjs: ortMjs, wasm: ortWasm };
  }
  // Import direct du moteur (pas de copie en « blob: »), compatible avec la CSP stricte.
  env.useWasmCache = false;
  return webgpu;
}
