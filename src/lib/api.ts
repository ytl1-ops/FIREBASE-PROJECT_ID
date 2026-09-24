import type {
  AskRequest,
  GenerateRequest,
  TranscriptionResponse,
} from "../../shared/types.ts";

export interface Health {
  ok: boolean;
  model: string;
  apiKeyConfigured: boolean;
  transcriptionConfigured: boolean;
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch("/api/health");
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

async function errorFrom(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string };
    return new Error(body.error ?? `Erreur ${res.status}`);
  } catch {
    return new Error(`Erreur ${res.status}`);
  }
}

export interface StreamResult {
  text: string;
  model?: string;
  truncated?: boolean;
}

/** Lit un flux SSE `delta` / `done` / `error` et appelle `onText` au fil de l'eau. */
async function streamPost(
  url: string,
  body: unknown,
  onText: (full: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await errorFrom(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (!raw.startsWith("data: ")) continue;
      const event = JSON.parse(raw.slice(6)) as
        | { type: "delta"; text: string }
        | { type: "done"; model: string; truncated: boolean }
        | { type: "error"; message: string };
      if (event.type === "delta") {
        text += event.text;
        onText(text);
      } else if (event.type === "done") {
        return { text, model: event.model, truncated: event.truncated };
      } else {
        throw new Error(event.message);
      }
    }
  }
  throw new Error("Connexion interrompue avant la fin de la rédaction.");
}

export function generateDocument(
  req: GenerateRequest,
  onText: (full: string) => void,
  signal?: AbortSignal,
) {
  return streamPost("/api/generate", req, onText, signal);
}

export function askMeeting(req: AskRequest, onText: (full: string) => void, signal?: AbortSignal) {
  return streamPost("/api/ask", req, onText, signal);
}

export async function transcribeAudio(
  audio: Blob,
  options: { languages: string[]; speakers?: number; vocabulary: string[] },
): Promise<TranscriptionResponse> {
  const ext = audio.type.startsWith("video/")
    ? audio.type.includes("mp4") ? "mp4" : "webm"
    : audio.type.includes("ogg")
    ? "ogg"
    : audio.type.includes("mp4") || audio.type.includes("m4a")
      ? "m4a"
      : audio.type.includes("mpeg")
        ? "mp3"
        : audio.type.includes("wav")
          ? "wav"
          : "webm";
  const form = new FormData();
  form.append("audio", audio, `reunion.${ext}`);
  form.append("languages", options.languages.join(","));
  if (options.speakers) form.append("speakers", String(options.speakers));
  form.append("vocabulary", options.vocabulary.join("\n"));
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as TranscriptionResponse;
}
