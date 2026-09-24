import type { Attachment } from "../../shared/types.ts";
import { newId } from "./db.ts";

/** Au-delà, la requête dépasserait la limite de l'API (32 Mo, base64 compris). */
export const MAX_PDF_TOTAL = 20 * 1024 * 1024;
export const ACCEPTED_FILES = ".pdf,.docx,.txt,.md,.csv,.vtt,.srt,application/pdf,text/plain";

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Lit un fichier source : PDF conservé tel quel, Word et texte convertis en texte brut. */
export async function readAttachment(file: File): Promise<Attachment> {
  const name = file.name;
  const lower = name.toLowerCase();
  const base = { id: newId("f-"), name, size: file.size };

  if (lower.endsWith(".pdf") || file.type === "application/pdf") {
    return { ...base, kind: "pdf", data: base64(await file.arrayBuffer()) };
  }
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { ...base, kind: "text", text: value.trim() };
  }
  if (lower.endsWith(".doc")) {
    throw new Error(`« ${name} » : format .doc ancien non pris en charge, enregistrez-le en .docx ou PDF.`);
  }
  if (file.type.startsWith("text/") || /\.(txt|md|csv|vtt|srt)$/.test(lower)) {
    return { ...base, kind: "text", text: (await file.text()).trim() };
  }
  throw new Error(`« ${name} » : format non pris en charge (PDF, Word .docx ou texte).`);
}

export function pdfTotal(attachments: Attachment[]): number {
  return attachments.filter((a) => a.kind === "pdf").reduce((sum, a) => sum + a.size, 0);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}
