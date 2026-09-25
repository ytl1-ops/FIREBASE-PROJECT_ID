/**
 * Stockage sur l'appareil de l'utilisateur, sans aucun serveur :
 * - stockage « persistant » demandé au navigateur (pas d'effacement automatique) ;
 * - sauvegarde automatique de chaque réunion dans un dossier choisi sur le PC
 *   (API File System Access : Chrome, Edge) ;
 * - sauvegarde complète en un fichier / restauration (tous appareils).
 */
import { openDB } from "idb";
import { getAudio, listMeetings, type Meeting } from "./db.ts";
import { fileSlug } from "./export.ts";
import { buildMeetingPackage, importMeetingPackage, saveFile } from "./share.ts";

// ---------------------------------------------------------------- Stockage persistant

export interface StorageStatus {
  persisted: boolean;
  usedMo: number;
  quotaMo: number;
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageStatus(): Promise<StorageStatus | null> {
  try {
    const [persisted, estimate] = await Promise.all([
      navigator.storage?.persisted?.() ?? Promise.resolve(false),
      navigator.storage?.estimate?.(),
    ]);
    if (!estimate) return null;
    return {
      persisted,
      usedMo: Math.round((estimate.usage ?? 0) / 1e6),
      quotaMo: Math.round((estimate.quota ?? 0) / 1e6),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Dossier de sauvegarde (PC)

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
};

const handles = () =>
  openDB("monmeeting-backup", 1, {
    upgrade(db) {
      db.createObjectStore("handles");
    },
  });

export const folderBackupSupported = () => "showDirectoryPicker" in window;

export async function getBackupFolder(): Promise<DirHandle | null> {
  try {
    return ((await (await handles()).get("handles", "folder")) as DirHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function chooseBackupFolder(): Promise<DirHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> })
    .showDirectoryPicker;
  const dir = await picker({ id: "monmeeting", mode: "readwrite", startIn: "documents" });
  await (await handles()).put("handles", dir, "folder");
  return dir;
}

export async function forgetBackupFolder() {
  await (await handles()).delete("handles", "folder");
}

/** Vrai si l'écriture est autorisée ; `ask` redemande l'accès (nécessite un clic). */
export async function folderReady(dir: DirHandle, ask = false): Promise<boolean> {
  if ((await dir.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return ask && (await dir.requestPermission({ mode: "readwrite" })) === "granted";
}

const backupName = (m: Meeting) => `${fileSlug(m, m.id)}.monmeeting`;

async function writeFile(dir: DirHandle, name: string, blob: Blob) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Copie une réunion (avec son enregistrement) dans le dossier choisi, si autorisé. */
export async function backupMeetingToFolder(meeting: Meeting): Promise<boolean> {
  const dir = await getBackupFolder();
  if (!dir || !(await folderReady(dir))) return false;
  await writeFile(dir, backupName(meeting), await buildMeetingPackage(meeting, await getAudio(meeting)));
  return true;
}

/** Copie toutes les réunions dans le dossier (première activation). */
export async function backupAllToFolder(onProgress?: (done: number, total: number) => void): Promise<number> {
  const dir = await getBackupFolder();
  if (!dir || !(await folderReady(dir, true))) throw new Error("Accès au dossier refusé.");
  const meetings = await listMeetings();
  for (let i = 0; i < meetings.length; i++) {
    onProgress?.(i, meetings.length);
    await writeFile(dir, backupName(meetings[i]), await buildMeetingPackage(meetings[i], await getAudio(meetings[i])));
  }
  return meetings.length;
}

// ---------------------------------------------------------------- Sauvegarde complète (tous appareils)

const BACKUP_MAGIC = "MONMEETING-SAUVEGARDE1\n";

/**
 * Un seul fichier contenant toutes les réunions : suite de paquets `.monmeeting` précédés
 * de leur taille. Chiffré réunion par réunion si un mot de passe est fourni.
 */
export async function exportFullBackup(password?: string): Promise<number> {
  const meetings = await listMeetings();
  const parts: BlobPart[] = [BACKUP_MAGIC];
  for (const m of meetings) {
    const pkg = await buildMeetingPackage(m, await getAudio(m), password);
    parts.push(`${pkg.size}\n`, pkg);
  }
  const date = new Date().toISOString().slice(0, 10);
  await saveFile(new Blob(parts, { type: "application/octet-stream" }), `${date}_monmeeting-sauvegarde.mmbackup`);
  return meetings.length;
}

/** Restaure une sauvegarde complète ; les réunions sont ajoutées (jamais écrasées). */
export async function importFullBackup(file: Blob, password?: string): Promise<number> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const magic = new TextEncoder().encode(BACKUP_MAGIC);
  if (!magic.every((b, i) => bytes[i] === b)) throw new Error("Ce fichier n'est pas une sauvegarde MonMeeting.");
  let offset = magic.length;
  let count = 0;
  while (offset < bytes.length) {
    const nl = bytes.indexOf(10, offset);
    const size = Number(new TextDecoder().decode(bytes.subarray(offset, nl)));
    if (!Number.isFinite(size) || size <= 0) throw new Error("Sauvegarde endommagée.");
    const start = nl + 1;
    await importMeetingPackage(new Blob([bytes.slice(start, start + size)]), password);
    offset = start + size;
    count++;
  }
  return count;
}

export const isFullBackup = (name: string) => name.toLowerCase().endsWith(".mmbackup");
