/**
 * Partage de fichiers au sein d'un cercle restreint, sans stockage en ligne :
 * - partage natif de l'appareil (Mail, Signal, WhatsApp, Teams…) quand il est disponible ;
 * - paquet de réunion `.monmeeting`, chiffré (AES-256-GCM, clé dérivée du mot de passe par
 *   PBKDF2-SHA-256) si un mot de passe est choisi, à importer dans un autre MonMeeting.
 */
import { Capacitor } from "@capacitor/core";
import { saveAs } from "file-saver";
import { appendAudioChunk, newId, saveMeeting, type Meeting } from "./db.ts";

const FORMAT = "monmeeting";
/** v2 : contenu compressé (gzip) avant l'éventuel chiffrement. */
const VERSION = 2;
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

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
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

/**
 * Format v2 (binaire, compact) : « MONMEETING2\n » + en-tête JSON + « \n » + contenu gzip
 * (chiffré AES-GCM si mot de passe). L'audio n'est plus encodé en base64 dans le fichier :
 * le paquet pèse à peine plus que l'enregistrement lui-même.
 */
const MAGIC = "MONMEETING2\n";

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
  let body: Uint8Array<ArrayBuffer> = await gzip(JSON.stringify(payload));
  const header: Omit<PackageFile, "data"> = {
    format: FORMAT,
    version: VERSION,
    title: password ? "Réunion chiffrée" : meeting.info.title,
    createdAt: new Date().toISOString(),
    encrypted: Boolean(password),
  };
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, body));
    header.salt = toBase64(salt);
    header.iv = toBase64(iv);
  }
  return new Blob([MAGIC, JSON.stringify(header), "\n", body], { type: "application/octet-stream" });
}

export class PasswordRequiredError extends Error {
  constructor() {
    super("Ce fichier est protégé par un mot de passe.");
  }
}

/** Lit un paquet `.monmeeting` sans l'enregistrer. */
export async function readMeetingPackage(file: Blob, password?: string): Promise<PackagePayload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const magic = new TextEncoder().encode(MAGIC);
  const isV2 = magic.every((b, i) => bytes[i] === b);

  let header: Partial<PackageFile>;
  let body: Uint8Array<ArrayBuffer> | null = null;
  try {
    if (isV2) {
      const end = bytes.indexOf(10, magic.length);
      header = JSON.parse(new TextDecoder().decode(bytes.subarray(magic.length, end))) as Partial<PackageFile>;
      body = bytes.slice(end + 1);
    } else {
      header = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PackageFile>; // format v1 (JSON)
    }
  } catch {
    throw new Error("Fichier illisible : ce n'est pas une réunion MonMeeting.");
  }
  if (header.format !== FORMAT) throw new Error("Ce fichier n'est pas une réunion MonMeeting.");
  if ((header.version ?? 0) > VERSION) {
    throw new Error("Fichier créé par une version plus récente de MonMeeting : mettez l'application à jour.");
  }

  // v1 non chiffré : la charge utile est déjà du JSON en clair.
  if (!body && !header.encrypted) return JSON.parse(header.data ?? "") as PackagePayload;
  let cipherOrPlain: Uint8Array<ArrayBuffer> = body ?? fromBase64(header.data ?? "");
  if (header.encrypted) {
    if (!password) throw new PasswordRequiredError();
    try {
      const key = await deriveKey(password, fromBase64(header.salt ?? ""));
      cipherOrPlain = new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(header.iv ?? "") }, key, cipherOrPlain),
      );
    } catch {
      throw new Error("Mot de passe incorrect ou fichier altéré.");
    }
  }
  const json = body ? await gunzip(cipherOrPlain) : new TextDecoder().decode(cipherOrPlain);
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

/** Vrai dans l'application téléphone (Android / iOS). */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** Application téléphone : fichier écrit dans le cache puis feuille de partage du système. */
async function nativeShare(blob: Blob, filename: string, title: string): Promise<"shared" | "cancelled"> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: toBase64(new Uint8Array(await blob.arrayBuffer())),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title, files: [uri] });
    return "shared";
  } catch (err) {
    if (err instanceof Error && /cancel/i.test(err.message)) return "cancelled";
    throw err;
  }
}

/** Enregistre un fichier : téléchargement sur le web, feuille de partage dans l'application. */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (isNativeApp()) await nativeShare(blob, filename, filename);
  else saveAs(blob, filename);
}

export function canShareFiles(): boolean {
  if (isNativeApp()) return true;
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
  if (isNativeApp()) return nativeShare(blob, filename, title);
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
