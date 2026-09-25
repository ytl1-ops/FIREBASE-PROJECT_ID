import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENTS } from "../shared/documents.ts";
import { ASK_SYSTEM_PROMPT, SYSTEM_PROMPT, buildAskContext, buildUserPrompt } from "../shared/prompts.ts";
import type { AskRequest, Attachment, GenerateRequest } from "../shared/types.ts";
import { LLM_PROVIDER, llmAvailable, llmModel, streamLlm } from "./llm.ts";
import { TRANSCRIPTION_PROVIDER, getTranscription, startTranscription, transcriptionAvailable } from "./transcription.ts";

// Charge .env s'il existe (Node ≥ 20.12).
try {
  process.loadEnvFile();
} catch {
  // pas de fichier .env : variables d'environnement du système uniquement
}

const PORT = Number(process.env.PORT ?? 8787);
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../dist");

/** Origines web autorisées à appeler l'API (ex. l'application publiée sur GitHub Pages). */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);
/** Jeton facultatif exigé sur les routes /api (recommandé dès que le serveur est exposé). */
const API_TOKEN = process.env.MONMEETING_API_TOKEN?.trim() ?? "";
/** Nombre de requêtes de rédaction / transcription par adresse IP et par minute. */
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);

const app = express();
app.disable("x-powered-by");
// Derrière un reverse proxy (Caddy, Nginx, tunnel) : adresse IP réelle du client.
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);

// ---------------------------------------------------------------- Sécurité HTTP

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "microphone=(self), camera=(self), display-capture=(self), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (!req.path.startsWith("/api/")) {
    // Interface : scripts et styles servis par ce serveur uniquement ; modèles Whisper
    // téléchargés depuis Hugging Face (transcription sur l'appareil).
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    );
  }
  next();
});

// CORS : seules les origines listées peuvent appeler l'API depuis un navigateur.
app.use("/api", (req, res, next) => {
  const origin = req.get("origin")?.replace(/\/$/, "");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    if (!(origin && ALLOWED_ORIGINS.includes(origin))) securityLog(`origine refusée (${origin ?? "aucune"})`, req);
    res.sendStatus(origin && ALLOWED_ORIGINS.includes(origin) ? 204 : 403);
    return;
  }
  next();
});

/** Journal des événements de sécurité (jamais de jeton ni de contenu de réunion). */
function securityLog(event: string, req: Request) {
  console.warn(`[sécurité] ${new Date().toISOString()} ${event} ip=${req.ip ?? "?"} ${req.method} ${req.path}`);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Session par cookie httpOnly (application servie par ce serveur) : le jeton n'est jamais
 * conservé par le JavaScript du navigateur. Valeur dérivée du jeton (HMAC) : changer
 * MONMEETING_API_TOKEN révoque toutes les sessions.
 */
const SESSION_COOKIE = "mm_session";
const sessionValue = () => crypto.createHmac("sha256", API_TOKEN).update("monmeeting-session-v1").digest("hex");

function cookie(req: Request, name: string): string {
  for (const part of (req.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function tokenOk(req: Request): boolean {
  if (!API_TOKEN) return true;
  const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (bearer) return safeEqual(bearer, API_TOKEN);
  const session = cookie(req, SESSION_COOKIE);
  return Boolean(session) && safeEqual(session, sessionValue());
}

// Échange du jeton (lien de connexion) contre un cookie de session httpOnly.
app.post("/api/session", express.json({ limit: "2kb" }), (req, res) => {
  const token = (req.body as { token?: unknown } | undefined)?.token;
  if (!API_TOKEN || typeof token !== "string" || !safeEqual(token, API_TOKEN)) {
    securityLog("session refusée", req);
    res.status(401).json({ error: "Jeton d'API invalide.", code: "token" });
    return;
  }
  res.cookie(SESSION_COOKIE, sessionValue(), {
    httpOnly: true,
    secure: req.secure,
    sameSite: "strict",
    path: "/api",
    maxAge: 30 * 24 * 3600 * 1000,
  });
  res.status(204).end();
});

app.use("/api", (req, res, next) => {
  if (req.path === "/health" || tokenOk(req)) return next();
  securityLog("accès refusé (jeton)", req);
  res.status(401).json({ error: "Jeton d'API manquant ou invalide.", code: "token" });
});

// Limitation de débit en mémoire (par IP), sur les routes coûteuses.
const hits = new Map<string, { count: number; reset: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? "inconnu";
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    hits.set(key, { count: 1, reset: now + 60_000 });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return next();
  }
  if (++entry.count > RATE_LIMIT) {
    if (entry.count === RATE_LIMIT + 1) securityLog("limite de débit atteinte", req);
    res.setHeader("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
    res.status(429).json({ error: "Trop de requêtes : patientez une minute." });
    return;
  }
  next();
}

// Les PDF joints sont transmis en base64 : 32 Mo maximum par requête.
app.use(express.json({ limit: "32mb" }));

// Fichiers audio/vidéo : répertoire temporaire, nom aléatoire, supprimés après traitement.
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `monmeeting-${crypto.randomUUID()}${/^\.[a-z0-9]{2,5}$/.test(ext) ? ext : ".webm"}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => cb(null, /^(audio|video)\//.test(file.mimetype)),
});

// ---------------------------------------------------------------- Routes

app.get("/api/health", async (_req, res) => {
  const [generation, transcription] = await Promise.all([llmAvailable(), transcriptionAvailable()]);
  res.json({
    ok: true,
    tokenRequired: Boolean(API_TOKEN),
    generation: { provider: LLM_PROVIDER, model: llmModel(), available: generation },
    transcription: { provider: TRANSCRIPTION_PROVIDER, available: transcription },
  });
});

function hasContent(body: { transcript?: { text?: string }[]; notes?: string; attachments?: Attachment[] }) {
  return (
    Boolean(body.transcript?.some((s) => s?.text?.trim())) ||
    Boolean(body.notes?.trim()) ||
    Boolean(body.attachments?.length)
  );
}

function validMeeting(meeting: unknown): boolean {
  const m = meeting as GenerateRequest["meeting"] | undefined;
  return Boolean(m && typeof m === "object" && Array.isArray(m.participants) && Array.isArray(m.agenda));
}

function validateGenerate(body: unknown): GenerateRequest | string {
  const req = body as Partial<GenerateRequest> | undefined;
  if (!req || typeof req !== "object") return "Requête invalide.";
  if (!DOCUMENTS.some((d) => d.type === req.type)) return "Type de document inconnu.";
  if (!validMeeting(req.meeting)) return "Informations de réunion manquantes.";
  if (!Array.isArray(req.transcript)) return "Transcription manquante.";
  if (!hasContent(req)) return "Ni transcription, ni notes, ni fichier joint : rien à rédiger.";
  return req as GenerateRequest;
}

function validateAsk(body: unknown): AskRequest | string {
  const req = body as Partial<AskRequest> | undefined;
  if (!req || typeof req !== "object") return "Requête invalide.";
  if (!validMeeting(req.meeting) || !Array.isArray(req.transcript)) return "Réunion manquante.";
  if (!req.question?.trim()) return "Question vide.";
  if (!Array.isArray(req.history) || req.history.some((h) => h?.role !== "user" && h?.role !== "assistant")) {
    return "Historique invalide.";
  }
  if (!hasContent(req)) return "La réunion ne contient encore aucune transcription.";
  return req as AskRequest;
}

const pdfs = (attachments: Attachment[] | undefined) => attachments?.filter((a) => a.kind === "pdf");

/** Rédaction d'un document (PV, compte rendu, note de synthèse, TBM, relevé de décisions). */
app.post("/api/generate", rateLimit, async (req, res) => {
  const parsed = validateGenerate(req.body);
  if (typeof parsed === "string") {
    res.status(400).json({ error: parsed });
    return;
  }
  await streamLlm(
    res,
    SYSTEM_PROMPT,
    [{ role: "user", text: buildUserPrompt(parsed), pdfs: pdfs(parsed.attachments) }],
    32000,
  );
});

/** « Demandez à votre réunion » : questions-réponses sur la transcription. */
app.post("/api/ask", rateLimit, async (req, res) => {
  const parsed = validateAsk(req.body);
  if (typeof parsed === "string") {
    res.status(400).json({ error: parsed });
    return;
  }
  const turns = [...parsed.history, { role: "user" as const, content: parsed.question }];
  await streamLlm(
    res,
    ASK_SYSTEM_PROMPT,
    turns.map((turn, index) => ({
      role: turn.role,
      text: String(turn.content ?? ""),
      ...(index === 0 ? { context: buildAskContext(parsed), pdfs: pdfs(parsed.attachments) } : {}),
    })),
    16000,
  );
});

/** Lance la transcription de l'enregistrement complet ; renvoie un identifiant de tâche. */
app.post("/api/transcribe", rateLimit, upload.single("audio"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Aucun fichier audio ou vidéo reçu." });
    return;
  }
  try {
    const fields = (req.body ?? {}) as Record<string, unknown>;
    const field = (name: string) => (typeof fields[name] === "string" ? (fields[name]) : "");
    const languages = field("languages")
      .split(",")
      .map((l) => l.trim())
      .filter((l) => /^[a-z]{2,3}$/.test(l));
    const speakers = Math.min(Number(field("speakers")) || 0, 50) || undefined;
    const vocabulary = field("vocabulary").slice(0, 20_000).split(/[\n,;]/);
    const id = await startTranscription(file.path, file.originalname || "reunion.webm", {
      languages,
      speakers,
      vocabulary,
    });
    res.status(202).json({ id });
  } catch (err) {
    await rm(file.path, { force: true });
    console.error("[transcribe]", err instanceof Error ? err.message : err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Transcription impossible." });
  }
});

/** État d'une transcription : progression, puis résultat (remis une seule fois). */
app.get("/api/transcribe/:id", async (req, res) => {
  const job = await getTranscription(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Tâche inconnue ou expirée." });
    return;
  }
  res.json(job);
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Route inconnue." }));

// Erreurs (fichier trop volumineux, JSON invalide…) : message générique, sans détail interne.
// Express reconnaît un gestionnaire d'erreurs à ses quatre paramètres : `_next` est requis.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.status && err.status < 500 ? err.status : 500;
  if (status >= 500) console.error("[serveur]", err.message);
  res.status(status).json({
    error:
      status === 413 ? "Fichier trop volumineux." : status < 500 ? "Requête invalide." : "Erreur interne du serveur.",
  });
});

if (process.env.NODE_ENV === "production" && existsSync(distDir)) {
  app.use(express.static(distDir, { index: "index.html", maxAge: "1h" }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(PORT, () => {
  console.log(
    `MonMeeting API sur http://localhost:${PORT} — rédaction : ${LLM_PROVIDER} (${llmModel()}), transcription : ${TRANSCRIPTION_PROVIDER}` +
      (API_TOKEN ? ", jeton requis" : "") +
      (ALLOWED_ORIGINS.length ? `, origines autorisées : ${ALLOWED_ORIGINS.join(", ")}` : ""),
  );
});
