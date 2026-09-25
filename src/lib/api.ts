import type {
  AskRequest,
  GenerateRequest,
  TranscriptionResponse,
} from "../../shared/types.ts";

export interface Health {
  ok: boolean;
  tokenRequired?: boolean;
  generation: { provider: "ollama" | "anthropic"; model: string; available: boolean };
  transcription: { provider: "local" | "gladia"; available: boolean };
}

/**
 * Connexion à « Mon API » (serveur MonMeeting auto-hébergé). Par défaut, le serveur qui
 * sert l'application ; sinon l'adresse saisie dans les Réglages (application publiée sur
 * GitHub Pages, application téléphone). Mémorisée dans ce navigateur uniquement.
 */
const API_URL_KEY = "monmeeting.apiUrl";
const API_TOKEN_KEY = "monmeeting.apiToken";

function readSetting(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function getApiSettings(): { url: string; token: string } {
  return { url: readSetting(API_URL_KEY), token: readSetting(API_TOKEN_KEY) };
}

export function saveApiSettings(url: string, token: string) {
  try {
    localStorage.setItem(API_URL_KEY, url.trim().replace(/\/+$/, ""));
    localStorage.setItem(API_TOKEN_KEY, token.trim());
  } catch {
    // stockage indisponible (navigation privée) : réglage non mémorisé
  }
}

function apiUrl(path: string): string {
  return `${getApiSettings().url}${path}`;
}

function apiInit(init: RequestInit = {}): RequestInit {
  const { token } = getApiSettings();
  return token ? { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } } : init;
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch(apiUrl("/api/health"), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const health = (await res.json()) as Partial<Health>;
    return health.generation && health.transcription ? (health as Health) : null;
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
  const res = await fetch(apiUrl(url), apiInit({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }));
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

export interface TranscriptionProgress {
  label: string;
  progress: number;
}

/** Envoie l'enregistrement à « Mon API », puis suit la tâche jusqu'au résultat. */
export async function transcribeAudio(
  audio: Blob,
  options: { languages: string[]; speakers?: number; vocabulary: string[] },
  onProgress: (p: TranscriptionProgress) => void,
  signal?: AbortSignal,
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

  onProgress({ label: "Envoi de l'enregistrement", progress: 0 });
  const res = await fetch(apiUrl("/api/transcribe"), apiInit({ method: "POST", body: form, signal }));
  if (!res.ok) throw await errorFrom(res);
  const { id } = (await res.json()) as { id: string };

  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    if (signal?.aborted) throw new DOMException("Transcription annulée", "AbortError");
    const poll = await fetch(apiUrl(`/api/transcribe/${id}`), apiInit({ signal }));
    if (!poll.ok) throw await errorFrom(poll);
    const job = (await poll.json()) as {
      status: string;
      label: string;
      progress: number;
      result?: TranscriptionResponse;
      error?: string;
    };
    if (job.status === "done" && job.result) return job.result;
    if (job.status === "error") throw new Error(job.error ?? "Transcription échouée.");
    onProgress({ label: job.label, progress: job.progress });
  }
}
