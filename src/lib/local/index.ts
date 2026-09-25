import type { LocalRequest, LocalResponse, LocalSegment } from "./protocol.ts";

const SAMPLE_RATE = 16_000;

/** Décode n'importe quel fichier audio/vidéo lisible par le navigateur en mono 16 kHz. */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
    }
    return mono;
  } finally {
    void context.close();
  }
}

export interface LocalJob {
  result: Promise<{ segments: LocalSegment[]; device: string; warning?: string }>;
  cancel: () => void;
}

export function runLocalTranscription(
  audio: Float32Array,
  options: Omit<LocalRequest, "audio">,
  onMessage: (msg: LocalResponse) => void,
): LocalJob {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let reject: (err: Error) => void = () => {};
  const result = new Promise<{ segments: LocalSegment[]; device: string; warning?: string }>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (event: MessageEvent<LocalResponse>) => {
      const msg = event.data;
      onMessage(msg);
      if (msg.type === "done") {
        resolve({ segments: msg.segments, device: msg.device, warning: msg.warning });
        worker.terminate();
      } else if (msg.type === "error") {
        rej(new Error(msg.message));
        worker.terminate();
      }
    };
    worker.onerror = (event) => {
      rej(new Error(event.message || "Le moteur de transcription locale a planté."));
      worker.terminate();
    };
  });
  const request: LocalRequest = { audio, ...options };
  worker.postMessage(request, [audio.buffer]);
  return {
    result,
    cancel: () => {
      worker.terminate();
      reject(new DOMException("Transcription annulée", "AbortError"));
    },
  };
}
