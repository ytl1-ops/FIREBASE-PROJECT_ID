import { formatTimestamp, formatTranscript } from "../../shared/transcript.ts";
import { CLASSIFICATION_LABELS } from "../../shared/types.ts";
import type { Meeting } from "./db.ts";
import { markdownToHtml } from "./markdown.ts";
import { saveFile } from "./share.ts";

export function fileSlug(meeting: Meeting, suffix: string): string {
  const date = meeting.info.date.slice(0, 10);
  const title = meeting.info.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 50);
  return `${date}_${title || "reunion"}_${suffix}`;
}

export async function exportDocx(markdown: string, meeting: Meeting, suffix: string) {
  const { buildDocx } = await import("./docx.ts");
  void saveFile(await buildDocx(markdown, meeting), `${fileSlug(meeting, suffix)}.docx`);
}

export function exportMarkdown(markdown: string, meeting: Meeting, suffix: string) {
  void saveFile(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    `${fileSlug(meeting, suffix)}.md`,
  );
}

/** Ouvre le document dans une fenêtre d'impression (Enregistrer au format PDF). */
export function printDocument(markdown: string, meeting: Meeting) {
  const win = window.open("", "_blank");
  if (!win) return;
  const label = CLASSIFICATION_LABELS[meeting.info.classification].toUpperCase();
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>${meeting.info.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>
<style>
  @page { margin: 2cm; }
  body { font: 11pt/1.5 Calibri, "Segoe UI", Arial, sans-serif; color: #111; }
  .banner { text-align: center; font-weight: bold; font-size: 9pt; color: #b42318; letter-spacing: .1em; }
  h1 { font-size: 18pt; color: #0f2a44; } h2 { font-size: 14pt; color: #0f2a44; border-bottom: 1px solid #ccd; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #99a; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #0f2a44; color: #fff; }
  blockquote { border-left: 3px solid #0f2a44; margin-left: 0; padding-left: 12px; }
</style></head><body>
<div class="banner">${label}</div>
${markdownToHtml(markdown)}
<div class="banner">${label}</div>
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

export function transcriptBlob(meeting: Meeting): Blob {
  const header = [
    meeting.info.title,
    new Date(meeting.info.date).toLocaleString("fr-FR"),
    `Classification : ${CLASSIFICATION_LABELS[meeting.info.classification]}`,
    `Durée : ${formatTimestamp(meeting.durationMs)}`,
    "",
  ].join("\n");
  return new Blob([header + formatTranscript(meeting.transcript, meeting.info.participants)], {
    type: "text/plain;charset=utf-8",
  });
}

export function exportTranscript(meeting: Meeting) {
  void saveFile(transcriptBlob(meeting), `${fileSlug(meeting, "transcription")}.txt`);
}

export function audioFileName(meeting: Meeting, audio: Blob): string {
  const video = audio.type.startsWith("video/");
  const ext = audio.type.includes("ogg")
    ? "ogg"
    : audio.type.includes("mp4")
      ? video ? "mp4" : "m4a"
      : audio.type.includes("mpeg")
        ? "mp3"
        : "webm";
  return `${fileSlug(meeting, video ? "video" : "audio")}.${ext}`;
}

export function exportAudio(meeting: Meeting, audio: Blob) {
  void saveFile(audio, audioFileName(meeting, audio));
}

export async function docxBlob(markdown: string, meeting: Meeting): Promise<Blob> {
  const { buildDocx } = await import("./docx.ts");
  return buildDocx(markdown, meeting);
}
