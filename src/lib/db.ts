import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DocumentType, MeetingInfo, TranscriptSegment } from "../../shared/types.ts";

export interface GeneratedDocument {
  content: string;
  generatedAt: string;
  model?: string;
  /** Le document a été modifié à la main après génération. */
  edited?: boolean;
}

export interface Meeting {
  id: string;
  createdAt: string;
  updatedAt: string;
  info: MeetingInfo;
  transcript: TranscriptSegment[];
  notes: string;
  durationMs: number;
  audioMime?: string;
  audioChunks: number;
  documents: Partial<Record<DocumentType, GeneratedDocument>>;
}

interface MonMeetingDB extends DBSchema {
  meetings: { key: string; value: Meeting; indexes: { byDate: string } };
  audio: { key: [string, number]; value: Blob };
}

let dbPromise: Promise<IDBPDatabase<MonMeetingDB>> | null = null;

function db() {
  dbPromise ??= openDB<MonMeetingDB>("monmeeting", 1, {
    upgrade(database) {
      const meetings = database.createObjectStore("meetings", { keyPath: "id" });
      meetings.createIndex("byDate", "info.date");
      database.createObjectStore("audio");
    },
  });
  return dbPromise;
}

export async function listMeetings(): Promise<Meeting[]> {
  const all = await (await db()).getAll("meetings");
  return all.sort((a, b) => b.info.date.localeCompare(a.info.date));
}

export async function getMeeting(id: string): Promise<Meeting | undefined> {
  return (await db()).get("meetings", id);
}

export async function saveMeeting(meeting: Meeting): Promise<Meeting> {
  const updated = { ...meeting, updatedAt: new Date().toISOString() };
  await (await db()).put("meetings", updated);
  return updated;
}

export async function deleteMeeting(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["meetings", "audio"], "readwrite");
  await tx.objectStore("meetings").delete(id);
  await tx.objectStore("audio").delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
  await tx.done;
}

/** Les fragments audio sont persistés au fil de l'eau : une coupure ne perd que quelques secondes. */
export async function appendAudioChunk(meetingId: string, index: number, chunk: Blob) {
  await (await db()).put("audio", chunk, [meetingId, index]);
}

export async function getAudio(meeting: Meeting): Promise<Blob | null> {
  if (!meeting.audioChunks) return null;
  const chunks = await (await db()).getAll(
    "audio",
    IDBKeyRange.bound([meeting.id, 0], [meeting.id, Infinity]),
  );
  if (!chunks.length) return null;
  return new Blob(chunks, { type: meeting.audioMime ?? "audio/webm" });
}

export async function clearAudio(meetingId: string) {
  await (await db()).delete("audio", IDBKeyRange.bound([meetingId, 0], [meetingId, Infinity]));
}

export function newId(prefix = ""): string {
  return prefix + crypto.randomUUID().slice(0, 8);
}

export function createMeeting(info: MeetingInfo): Meeting {
  const now = new Date().toISOString();
  return {
    id: newId("r-"),
    createdAt: now,
    updatedAt: now,
    info,
    transcript: [],
    notes: "",
    durationMs: 0,
    audioChunks: 0,
    documents: {},
  };
}
