/**
 * API d'IA gratuites (clé personnelle de l'utilisateur), appelées directement depuis le
 * navigateur — sans serveur et sans Claude. Format commun « compatible OpenAI ».
 *
 * Confidentialité : le texte (et l'audio pour la transcription) part chez le fournisseur
 * choisi. Désactivé en mode entreprise.
 */
import { ASK_SYSTEM_PROMPT, SYSTEM_PROMPT, buildAskContext, buildUserPrompt } from "../../shared/prompts.ts";
import { formatTimestamp, speakerName } from "../../shared/transcript.ts";
import type { AskRequest, Attachment, GenerateRequest, TranscriptSegment, TranscriptionResponse } from "../../shared/types.ts";
import { ENTERPRISE_MODE } from "./config.ts";

export type CloudProviderId = "groq" | "gemini" | "mistral" | "openrouter";

export interface CloudProvider {
  id: CloudProviderId;
  label: string;
  baseUrl: string;
  model: string;
  /** Modèle de transcription (Whisper) si le fournisseur en propose un gratuitement. */
  transcriptionModel?: string;
  /** Taille maximale d'une requête (jetons estimés) pour rester dans le quota gratuit. */
  maxInputTokens: number;
  keyUrl: string;
  note: string;
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: "groq",
    label: "Groq (recommandé)",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    transcriptionModel: "whisper-large-v3",
    maxInputTokens: 6000,
    keyUrl: "https://console.groq.com/keys",
    note: "Gratuit sans carte : rédaction et transcription Whisper (≈ 8 h d'audio par jour).",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    maxInputTokens: 200_000,
    keyUrl: "https://aistudio.google.com/apikey",
    note: "Gratuit, idéal pour les très longues réunions. Palier gratuit : données utilisées par Google pour améliorer ses produits.",
  },
  {
    id: "mistral",
    label: "Mistral AI (français)",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    maxInputTokens: 60_000,
    keyUrl: "https://console.mistral.ai/api-keys",
    note: "Palier « Experiment » gratuit : exige d'accepter l'utilisation des données pour l'entraînement.",
  },
  {
    id: "openrouter",
    label: "OpenRouter (modèles gratuits)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    maxInputTokens: 30_000,
    keyUrl: "https://openrouter.ai/keys",
    note: "Environ 50 requêtes gratuites par jour.",
  },
];

// ---------------------------------------------------------------- Réglages (navigateur)

const KEY = "monmeeting.cloud";

export interface CloudSettings {
  provider: CloudProviderId;
  apiKey: string;
  model?: string;
  /** Adresse de base remplaçant celle du fournisseur (tests, passerelle d'entreprise). */
  baseUrl?: string;
}

export function getCloudSettings(): CloudSettings | null {
  if (ENTERPRISE_MODE) return null;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as CloudSettings) : null;
    return parsed?.apiKey ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCloudSettings(settings: CloudSettings | null) {
  try {
    if (settings?.apiKey) localStorage.setItem(KEY, JSON.stringify(settings));
    else localStorage.removeItem(KEY);
  } catch {
    // stockage indisponible
  }
}

function resolve(settings: CloudSettings) {
  const provider = CLOUD_PROVIDERS.find((p) => p.id === settings.provider) ?? CLOUD_PROVIDERS[0];
  return {
    provider,
    baseUrl: (settings.baseUrl || provider.baseUrl).replace(/\/+$/, ""),
    model: settings.model || provider.model,
  };
}

export const cloudCanTranscribe = (s: CloudSettings | null) =>
  Boolean(s && CLOUD_PROVIDERS.find((p) => p.id === s.provider)?.transcriptionModel);

// ---------------------------------------------------------------- Appels

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function cloudError(res: Response): Promise<Error> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    detail = typeof body.error === "string" ? body.error : (body.error?.message ?? "");
  } catch {
    // réponse non JSON
  }
  if (res.status === 401 || res.status === 403) return new Error("Clé d'API refusée : vérifiez-la dans les Réglages.");
  if (res.status === 429) return new Error(`Quota gratuit atteint pour le moment (${detail || "trop de requêtes"}). Réessayez plus tard.`);
  if (res.status === 413) return new Error("Réunion trop longue pour ce fournisseur en une seule requête.");
  return new Error(`Erreur du fournisseur (${res.status}) : ${detail || res.statusText}`);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolveSleep, reject) => {
    const t = setTimeout(resolveSleep, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Annulé", "AbortError"));
    });
  });

/** Requête de chat en flux (SSE) ; patiente et réessaie si le quota par minute est atteint. */
async function streamChat(
  settings: CloudSettings,
  messages: ChatMessage[],
  onText: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { baseUrl, model } = resolve(settings);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.2 }),
      signal,
    });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) || 20;
      await sleep(Math.min(wait, 60) * 1000, signal);
      continue;
    }
    if (!res.ok || !res.body) throw await cloudError(res);

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return text;
        try {
          const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
          if (chunk.error) throw new Error(chunk.error.message ?? "Erreur du fournisseur.");
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            onText(text);
          }
        } catch (err) {
          if (err instanceof SyntaxError) continue; // ligne partielle ou commentaire
          throw err;
        }
      }
    }
    return text;
  }
}

// ---------------------------------------------------------------- Longues réunions

const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/** Texte des PDF joints (les API compatibles OpenAI ne lisent pas les PDF). */
async function withPdfText(attachments: Attachment[] | undefined): Promise<Attachment[] | undefined> {
  if (!attachments?.some((a) => a.kind === "pdf")) return attachments;
  const { extractText } = await import("unpdf");
  return Promise.all(
    attachments.map(async (a) => {
      if (a.kind !== "pdf" || !a.data) return a;
      try {
        const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0));
        const { text } = await extractText(bytes, { mergePages: true });
        return { ...a, kind: "text" as const, text, data: undefined };
      } catch {
        return { ...a, kind: "text" as const, text: "(PDF illisible : texte non extractible)", data: undefined };
      }
    }),
  );
}

/**
 * Si la réunion dépasse le quota d'une requête, la transcription est d'abord condensée par
 * tranches (notes fidèles horodatées), puis le document est rédigé à partir de ces notes.
 */
async function condenseIfNeeded(
  settings: CloudSettings,
  req: GenerateRequest,
  onProgress: (label: string) => void,
  signal?: AbortSignal,
): Promise<GenerateRequest> {
  const { provider } = resolve(settings);
  const budget = provider.maxInputTokens;
  if (estimateTokens(SYSTEM_PROMPT + buildUserPrompt(req)) <= budget) return req;

  const lines = req.transcript.map((s) => {
    const who = s.kind === "note" ? "NOTE" : s.kind === "bookmark" ? "MARQUE-PAGE" : speakerName(req.meeting.participants, s.speakerId);
    return `[${formatTimestamp(s.start)}] ${who} : ${s.text}`;
  });
  const sliceTokens = Math.max(1500, Math.floor(budget * 0.6));
  const slices: string[] = [];
  let current = "";
  for (const line of lines) {
    if (estimateTokens(current + line) > sliceTokens && current) {
      slices.push(current);
      current = "";
    }
    current += `${line}\n`;
  }
  if (current) slices.push(current);

  const notes: string[] = [];
  for (let i = 0; i < slices.length; i++) {
    onProgress(`Lecture de la réunion (partie ${i + 1}/${slices.length})…`);
    notes.push(
      await streamChat(
        settings,
        [
          {
            role: "system",
            content:
              "Tu condenses fidèlement un extrait de transcription de réunion, en français. Conserve pour chaque idée l'horodatage [mm:ss] et l'intervenant, et TOUTES les décisions, actions, responsables, échéances, chiffres, noms et risques. N'invente rien. Réponds par une liste à puces.",
          },
          { role: "user", content: slices[i] },
        ],
        () => {},
        signal,
      ),
    );
  }
  const condensed: TranscriptSegment[] = [
    {
      id: "condense",
      start: 0,
      kind: "note",
      text: `Transcription condensée (réunion longue, ${slices.length} parties) :\n${notes.join("\n")}`,
    },
  ];
  return { ...req, transcript: condensed };
}

// ---------------------------------------------------------------- Fonctions exposées

export async function cloudGenerate(
  settings: CloudSettings,
  req: GenerateRequest,
  onText: (full: string) => void,
  onProgress: (label: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
  const prepared = await condenseIfNeeded(settings, { ...req, attachments: await withPdfText(req.attachments) }, onProgress, signal);
  onProgress("Rédaction en cours…");
  const text = await streamChat(
    settings,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(prepared) },
    ],
    onText,
    signal,
  );
  return { text, model: resolve(settings).model };
}

export async function cloudAsk(
  settings: CloudSettings,
  req: AskRequest,
  onText: (full: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string }> {
  const attachments = await withPdfText(req.attachments);
  const context = buildAskContext({ ...req, attachments });
  const messages: ChatMessage[] = [{ role: "system", content: ASK_SYSTEM_PROMPT }];
  req.history.forEach((m, i) => messages.push({ role: m.role, content: i === 0 ? `${context}\n\n${m.content}` : m.content }));
  messages.push({ role: "user", content: req.history.length ? req.question : `${context}\n\n${req.question}` });
  return { text: await streamChat(settings, messages, onText, signal) };
}

/** Transcription par le Whisper gratuit du fournisseur (sans séparation des voix). */
export async function cloudTranscribe(
  settings: CloudSettings,
  audio: Blob,
  language: string | undefined,
  vocabulary: string[],
  signal?: AbortSignal,
): Promise<TranscriptionResponse> {
  const { provider, baseUrl } = resolve(settings);
  if (!provider.transcriptionModel) throw new Error(`${provider.label} ne propose pas de transcription gratuite : choisissez Groq.`);
  if (audio.size > 25 * 1024 * 1024) {
    throw new Error("Enregistrement trop lourd pour la transcription gratuite (25 Mo max) : utilisez la qualité « Économe » ou la transcription sur l'appareil.");
  }
  const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : audio.type.includes("mpeg") ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", audio, `reunion.${ext}`);
  form.append("model", provider.transcriptionModel);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  if (language) form.append("language", language);
  const terms = vocabulary.map((v) => v.trim()).filter(Boolean);
  if (terms.length) form.append("prompt", `Vocabulaire : ${terms.slice(0, 60).join(", ")}.`);

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form,
    signal,
  });
  if (!res.ok) throw await cloudError(res);
  const body = (await res.json()) as { text?: string; language?: string; segments?: { start: number; end: number; text: string }[] };
  const segments = (body.segments ?? (body.text ? [{ start: 0, end: 0, text: body.text }] : []))
    .map((s) => ({ start: Math.round(s.start * 1000), end: Math.round(s.end * 1000), speaker: "Locuteur 1", text: s.text.trim() }))
    .filter((s) => s.text);
  return { segments, languages: body.language ? [body.language] : [] };
}

/** Vérifie la clé avec une requête minimale. */
export async function testCloud(settings: CloudSettings): Promise<string> {
  const text = await streamChat(settings, [{ role: "user", content: "Réponds uniquement : OK" }], () => {});
  return text.trim() || "(réponse vide)";
}
