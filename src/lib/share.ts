/**
 * Partage de fichiers au sein d'un cercle restreint, sans stockage en ligne :
 * - partage natif de l'appareil (Mail, Signal, WhatsApp, Teams…) quand il est disponible ;
 * - paquet de réunion `.monmeeting`, chiffré (AES-256-GCM, clé dérivée du mot de passe par
 *   PBKDF2-SHA-256) si un mot de passe est choisi, à importer dans un autre MonMeeting.
 */
import { saveAs } from "file-saver";
import { appendAudioChunk, newId, saveMeeting, type Meeting } from "./db.ts";

const FORMAT = "monmeeting";
const VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;

interface PackagePayload {
  meeting: Meeting;
  audio?: { mime: string; data: string };
}

interface PackageFile {
  format: typeof FORMAT;
  version: number;
  title: string;
  createdAt: string;
  encrypted: boolean;
  /** Paramètres de chiffrement (base64) si `encrypted`. */
  salt?: string;
  iv?: string;
  /** Charge utile : JSON en clair, ou JSON chiffré encodé en base64. */
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function buildMeetingPackage(
  meeting: Meeting,
  audio: Blob | null,
  password?: string,
): Promise<Blob> {
  const payload: PackagePayload = { meeting };
  if (audio) {
    payload.audio = {
      mime: audio.type || meeting.audioMime || "audio/webm",
      data: toBase64(new Uint8Array(await audio.arrayBuffer())),
    };
  }
  const json = JSON.stringify(payload);
  const file: PackageFile = {
    format: FORMAT,
    version: VERSION,
    title: password ? "Réunion chiffrée" : meeting.info.title,
    createdAt: new Date().toISOString(),
    encrypted: Boolean(password),
    data: json,
  };
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(json));
    file.salt = toBase64(salt);
    file.iv = toBase64(iv);
    file.data = toBase64(new Uint8Array(cipher));
  }
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

export class PasswordRequiredError extends Error {
  constructor() {
    super("Ce fichier est protégé par un mot de passe.");
  }
}

/** Lit un paquet `.monmeeting` sans l'enregistrer. */
export async function readMeetingPackage(file: Blob, password?: string): Promise<PackagePayload> {
  let parsed: PackageFile;
  try {
    parsed = JSON.parse(await file.text()) as PackageFile;
  } catch {
    throw new Error("Fichier illisible : ce n'est pas une réunion MonMeeting.");
  }
  if (parsed.format !== FORMAT) throw new Error("Ce fichier n'est pas une réunion MonMeeting.");
  if (parsed.version > VERSION) {
    throw new Error("Fichier créé par une version plus récente de MonMeeting : mettez l'application à jour.");
  }
  let json = parsed.data;
  if (parsed.encrypted) {
    if (!password) throw new PasswordRequiredError();
    try {
      const key = await deriveKey(password, fromBase64(parsed.salt ?? ""));
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(parsed.iv ?? "") },
        key,
        fromBase64(parsed.data),
      );
      json = new TextDecoder().decode(plain);
    } catch {
      throw new Error("Mot de passe incorrect ou fichier altéré.");
    }
  }
  return JSON.parse(json) as PackagePayload;
}

/** Importe un paquet comme nouvelle réunion (nouvel identifiant : pas d'écrasement). */
export async function importMeetingPackage(file: Blob, password?: string): Promise<Meeting> {
  const { meeting, audio } = await readMeetingPackage(file, password);
  const imported: Meeting = {
    ...meeting,
    id: newId("r-"),
    audioChunks: 0,
  };
  if (audio) {
    await appendAudioChunk(imported.id, 0, new Blob([fromBase64(audio.data)], { type: audio.mime }));
    imported.audioChunks = 1;
    imported.audioMime = audio.mime;
  }
  return saveMeeting(imported);
}

export function canShareFiles(): boolean {
  try {
    return Boolean(
      navigator.canShare?.({ files: [new File([""], "test.txt", { type: "text/plain" })] }),
    );
  } catch {
    return false;
  }
}

/**
 * Partage un fichier via le menu de partage de l'appareil ; à défaut, le télécharge.
 * Renvoie `"shared"`, `"downloaded"` ou `"cancelled"`.
 */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
  title: string,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Partage refusé (type de fichier, taille…) : repli sur le téléchargement.
    }
  }
  saveAs(file, filename);
  return "downloaded";
}
