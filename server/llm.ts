/**
 * Rédaction (documents, questions) par un modèle de langage, diffusée en Server-Sent Events.
 *
 * Fournisseurs :
 * - « ollama » (par défaut) : modèle libre auto-hébergé (Mistral, Qwen, Llama…), aucune
 *   dépendance externe, les données ne quittent pas votre serveur ;
 * - « anthropic » : API Claude, facultative (clé ANTHROPIC_API_KEY).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStream } from "@anthropic-ai/sdk/lib/BetaMessageStream";
import type {
  BetaContentBlockParam,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Response } from "express";
import type { Attachment } from "../shared/types.ts";

export type LlmProvider = "ollama" | "anthropic";

export const LLM_PROVIDER: LlmProvider =
  process.env.LLM_PROVIDER === "anthropic" ? "anthropic" : "ollama";
export const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
const OLLAMA_CONTEXT = Number(process.env.OLLAMA_CONTEXT ?? 32768);
export const ANTHROPIC_MODEL = process.env.MONMEETING_MODEL ?? "claude-opus-5";

export const llmModel = () => (LLM_PROVIDER === "ollama" ? OLLAMA_MODEL : ANTHROPIC_MODEL);

/** Un tour de conversation : texte, plus d'éventuels PDF joints (premier tour). */
export interface Turn {
  role: "user" | "assistant";
  text: string;
  /** Contexte stable (réunion) à placer avant le texte et à mettre en cache si possible. */
  context?: string;
  pdfs?: Attachment[];
}

export async function llmAvailable(): Promise<boolean> {
  if (LLM_PROVIDER === "anthropic") {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const { models } = (await res.json()) as { models?: { name: string }[] };
    return Boolean(models?.some((m) => m.name === OLLAMA_MODEL || m.name === `${OLLAMA_MODEL}:latest`));
  } catch {
    return false;
  }
}

function sendEvent(res: Response, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Texte des PDF joints (les modèles libres ne lisent pas les PDF directement). */
async function pdfText(pdfs: Attachment[] | undefined): Promise<string> {
  if (!pdfs?.length) return "";
  const { extractText } = await import("unpdf");
  const parts: string[] = [];
  for (const pdf of pdfs) {
    if (!pdf.data) continue;
    try {
      const { text } = await extractText(new Uint8Array(Buffer.from(pdf.data, "base64")), { mergePages: true });
      parts.push(`<piece_jointe nom="${pdf.name.replace(/"/g, "'")}">\n${text.trim()}\n</piece_jointe>`);
    } catch {
      parts.push(`<piece_jointe nom="${pdf.name}">(PDF illisible : texte non extractible, document scanné ?)</piece_jointe>`);
    }
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- Ollama (modèle libre)

async function streamOllama(res: Response, system: string, turns: Turn[], signal: AbortSignal) {
  const messages = [{ role: "system", content: system }];
  for (const turn of turns) {
    const extra = turn.pdfs ? await pdfText(turn.pdfs) : "";
    messages.push({
      role: turn.role,
      content: [turn.context, extra, turn.text].filter(Boolean).join("\n\n"),
    });
  }

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: true,
      options: { num_ctx: OLLAMA_CONTEXT, temperature: 0.2 },
    }),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      response.status === 404
        ? `Modèle « ${OLLAMA_MODEL} » absent du serveur Ollama : lancez « ollama pull ${OLLAMA_MODEL} ».`
        : `Ollama a répondu ${response.status} : ${detail.slice(0, 200)}`,
    );
  }

  // Réponse NDJSON : une ligne JSON par fragment.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let truncated = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const chunk = JSON.parse(line) as {
        message?: { content?: string };
        done?: boolean;
        done_reason?: string;
        error?: string;
      };
      if (chunk.error) throw new Error(`Ollama : ${chunk.error}`);
      if (chunk.message?.content) sendEvent(res, { type: "delta", text: chunk.message.content });
      if (chunk.done) truncated = chunk.done_reason === "length";
    }
  }
  sendEvent(res, { type: "done", model: OLLAMA_MODEL, truncated });
}

// ---------------------------------------------------------------- Anthropic (facultatif)

let anthropic: Anthropic | null = null;

function anthropicError(err: unknown): string {
  if (
    err instanceof Anthropic.AuthenticationError ||
    (err instanceof Error && err.message.includes("Could not resolve authentication method"))
  ) {
    return "Clé API Anthropic absente ou invalide : renseignez ANTHROPIC_API_KEY côté serveur.";
  }
  if (err instanceof Anthropic.RateLimitError) return "Limite de débit de l'API atteinte. Réessayez dans quelques instants.";
  if (err instanceof Anthropic.BadRequestError) return `Requête refusée par l'API : ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Impossible de joindre l'API Anthropic (réseau).";
  if (err instanceof Anthropic.APIError) return `Erreur de l'API (${err.status ?? "?"}) : ${err.message}`;
  return err instanceof Error ? err.message : "Erreur inconnue.";
}

async function streamAnthropic(res: Response, system: string, turns: Turn[], maxTokens: number, onStream: (s: BetaMessageStream) => void) {
  anthropic ??= new Anthropic();
  const messages: BetaMessageParam[] = turns.map((turn) => {
    if (turn.role === "assistant") return { role: "assistant", content: turn.text };
    const blocks: BetaContentBlockParam[] = (turn.pdfs ?? [])
      .filter((a) => a.kind === "pdf" && a.data)
      .map((a) => ({
        type: "document",
        title: a.name,
        source: { type: "base64", media_type: "application/pdf", data: a.data! },
      }));
    // Le contexte de la réunion est identique d'une question à l'autre : mis en cache.
    if (turn.context) blocks.push({ type: "text", text: turn.context, cache_control: { type: "ephemeral" } });
    blocks.push({ type: "text", text: turn.text });
    return { role: "user", content: blocks };
  });

  const stream = anthropic.beta.messages.stream({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    // En cas de refus par les filtres de sécurité, relance sur le modèle de repli recommandé.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  });
  onStream(stream);
  stream.on("text", (text) => sendEvent(res, { type: "delta", text }));
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    sendEvent(res, { type: "error", message: "Le modèle a décliné cette demande." });
  } else {
    sendEvent(res, { type: "done", model: message.model, truncated: message.stop_reason === "max_tokens" });
  }
}

// ---------------------------------------------------------------- Point d'entrée commun

export async function streamLlm(res: Response, system: string, turns: Turn[], maxTokens: number) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const controller = new AbortController();
  let anthropicStream: BetaMessageStream | null = null;
  res.on("close", () => {
    controller.abort();
    anthropicStream?.abort();
  });

  try {
    if (LLM_PROVIDER === "ollama") await streamOllama(res, system, turns, controller.signal);
    else await streamAnthropic(res, system, turns, maxTokens, (s) => (anthropicStream = s));
  } catch (err) {
    const aborted =
      controller.signal.aborted || (err instanceof Error && err.name === "AbortError") || err instanceof Anthropic.APIUserAbortError;
    if (!res.writableEnded && !aborted) {
      console.error("[llm]", err);
      const message =
        LLM_PROVIDER === "anthropic"
          ? anthropicError(err)
          : err instanceof TypeError
            ? `Serveur Ollama injoignable (${OLLAMA_URL}). Vérifiez qu'il est démarré.`
            : err instanceof Error
              ? err.message
              : String(err);
      sendEvent(res, { type: "error", message });
    }
  } finally {
    res.end();
  }
}
