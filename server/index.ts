import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStream } from "@anthropic-ai/sdk/lib/BetaMessageStream";
import type {
  BetaContentBlockParam,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import express, { type Response } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENTS } from "../shared/documents.ts";
import type { AskRequest, Attachment, GenerateRequest } from "../shared/types.ts";
import { ASK_SYSTEM_PROMPT, SYSTEM_PROMPT, buildAskContext, buildUserPrompt } from "../shared/prompts.ts";
import { transcribeFile, transcriptionConfigured } from "./transcription.ts";

// Charge .env s'il existe (Node ≥ 20.12).
try {
  process.loadEnvFile();
} catch {
  // pas de fichier .env : variables d'environnement du système uniquement
}

const MODEL = process.env.MONMEETING_MODEL ?? "claude-opus-5";
const PORT = Number(process.env.PORT ?? 8787);
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../dist");

const app = express();
// Les PDF joints sont transmis en base64 (limite de requête de l'API : 32 Mo).
app.use(express.json({ limit: "32mb" }));

// Les fichiers audio transitent par un répertoire temporaire et sont supprimés après transcription.
// L'extension d'origine est conservée : elle sert à identifier le format audio.
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) =>
      cb(null, `monmeeting-${crypto.randomUUID()}${path.extname(file.originalname) || ".webm"}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    transcriptionConfigured: transcriptionConfigured(),
  });
});

function sendEvent(res: Response, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function hasContent(body: {
  transcript?: { text?: string }[];
  notes?: string;
  attachments?: Attachment[];
}): boolean {
  return (
    Boolean(body.transcript?.some((s) => s?.text?.trim())) ||
    Boolean(body.notes?.trim()) ||
    Boolean(body.attachments?.length)
  );
}

/** Les PDF joints sont transmis au modèle comme documents (texte et mise en page). */
function pdfBlocks(attachments: Attachment[] | undefined): BetaContentBlockParam[] {
  return (attachments ?? [])
    .filter((a) => a.kind === "pdf" && a.data)
    .map((a) => ({
      type: "document",
      title: a.name,
      source: { type: "base64", media_type: "application/pdf", data: a.data! },
    }));
}

function validateGenerate(body: unknown): GenerateRequest | string {
  const req = body as Partial<GenerateRequest> | undefined;
  if (!req || typeof req !== "object") return "Requête invalide.";
  if (!DOCUMENTS.some((d) => d.type === req.type)) return "Type de document inconnu.";
  if (!req.meeting || typeof req.meeting !== "object") return "Informations de réunion manquantes.";
  if (!Array.isArray(req.transcript)) return "Transcription manquante.";
  if (!hasContent(req)) return "Ni transcription, ni notes, ni fichier joint : rien à rédiger.";
  return req as GenerateRequest;
}

function validateAsk(body: unknown): AskRequest | string {
  const req = body as Partial<AskRequest> | undefined;
  if (!req || typeof req !== "object") return "Requête invalide.";
  if (!req.meeting || !Array.isArray(req.transcript)) return "Réunion manquante.";
  if (!req.question?.trim()) return "Question vide.";
  if (!Array.isArray(req.history)) return "Historique invalide.";
  if (!hasContent(req)) return "La réunion ne contient encore aucune transcription.";
  return req as AskRequest;
}

function errorMessage(err: unknown): string {
  if (
    err instanceof Anthropic.AuthenticationError ||
    (err instanceof Error && err.message.includes("Could not resolve authentication method"))
  ) {
    return "Clé API Anthropic absente ou invalide : renseignez ANTHROPIC_API_KEY côté serveur.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Limite de débit de l'API atteinte. Réessayez dans quelques instants.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Requête refusée par l'API : ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Impossible de joindre l'API Anthropic (réseau).";
  }
  if (err instanceof Anthropic.APIError) {
    return `Erreur de l'API (${err.status ?? "?"}) : ${err.message}`;
  }
  return err instanceof Error ? err.message : "Erreur inconnue.";
}

/** Diffuse la réponse de Claude en Server-Sent Events (`delta`, puis `done` ou `error`). */
async function streamClaude(
  res: Response,
  system: string,
  messages: BetaMessageParam[],
  maxTokens: number,
) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  let stream: BetaMessageStream | null = null;
  res.on("close", () => stream?.abort());

  try {
    stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      // En cas de refus par les filtres de sécurité, l'API relance la requête sur le
      // modèle de repli recommandé au lieu d'échouer.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
    });

    stream.on("text", (text) => sendEvent(res, { type: "delta", text }));
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      sendEvent(res, { type: "error", message: "Le modèle a décliné cette demande." });
    } else {
      sendEvent(res, {
        type: "done",
        model: message.model,
        truncated: message.stop_reason === "max_tokens",
      });
    }
  } catch (err) {
    if (!res.writableEnded && !(err instanceof Anthropic.APIUserAbortError)) {
      console.error("[claude]", err);
      sendEvent(res, { type: "error", message: errorMessage(err) });
    }
  } finally {
    res.end();
  }
}

/** Rédaction d'un document (PV, compte rendu, note de synthèse, TBM, relevé de décisions). */
app.post("/api/generate", async (req, res) => {
  const parsed = validateGenerate(req.body);
  if (typeof parsed === "string") {
    res.status(400).json({ error: parsed });
    return;
  }
  await streamClaude(
    res,
    SYSTEM_PROMPT,
    [
      {
        role: "user",
        content: [...pdfBlocks(parsed.attachments), { type: "text", text: buildUserPrompt(parsed) }],
      },
    ],
    32000,
  );
});

/** « Demandez à votre réunion » : questions-réponses sur la transcription. */
app.post("/api/ask", async (req, res) => {
  const parsed = validateAsk(req.body);
  if (typeof parsed === "string") {
    res.status(400).json({ error: parsed });
    return;
  }
  const turns = [...parsed.history, { role: "user" as const, content: parsed.question }];
  const messages: BetaMessageParam[] = turns.map((turn, index) =>
    index === 0
      ? {
          role: "user",
          content: [
            ...pdfBlocks(parsed.attachments),
            // Le contexte de la réunion est identique d'une question à l'autre : mis en cache.
            { type: "text", text: buildAskContext(parsed), cache_control: { type: "ephemeral" } },
            { type: "text", text: turn.content },
          ],
        }
      : { role: turn.role, content: turn.content },
  );
  await streamClaude(res, ASK_SYSTEM_PROMPT, messages, 16000);
});

/** Transcription haute fidélité de l'enregistrement complet, avec séparation des locuteurs. */
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  const file = req.file;
  try {
    if (!transcriptionConfigured()) {
      res.status(503).json({
        error: "Transcription haute fidélité non configurée : renseignez GLADIA_API_KEY côté serveur.",
      });
      return;
    }
    if (!file) {
      res.status(400).json({ error: "Aucun fichier audio reçu." });
      return;
    }
    const languages = String(req.body.languages ?? "")
      .split(",")
      .map((l) => l.trim())
      .filter((l) => /^[a-z]{2,3}$/.test(l));
    const speakers = Number(req.body.speakers) || undefined;
    const vocabulary = String(req.body.vocabulary ?? "").split(/[\n,;]/);

    const result = await transcribeFile(file.path, { languages, speakers, vocabulary });
    res.json(result);
  } catch (err) {
    console.error("[transcribe]", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Transcription échouée." });
  } finally {
    if (file) await rm(file.path, { force: true });
  }
});

if (process.env.NODE_ENV === "production" && existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(PORT, () => {
  console.log(`MonMeeting API à l'écoute sur http://localhost:${PORT} (modèle ${MODEL})`);
});
