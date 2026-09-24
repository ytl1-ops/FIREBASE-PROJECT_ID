import type { Participant, TranscriptSegment } from "./types.ts";

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function speakerName(
  participants: Participant[],
  speakerId: string | undefined,
): string {
  if (!speakerId) return "Intervenant non identifié";
  return participants.find((p) => p.id === speakerId)?.name ?? speakerId;
}

/** Transcription lisible, une ligne par segment : `[mm:ss] Nom : texte`. */
export function formatTranscript(
  segments: TranscriptSegment[],
  participants: Participant[],
): string {
  return segments
    .map((seg) => {
      const ts = `[${formatTimestamp(seg.start)}]`;
      if (seg.kind === "bookmark") return `${ts} ★ MARQUE-PAGE : ${seg.text}`;
      if (seg.kind === "note") return `${ts} ✎ NOTE DU RÉDACTEUR : ${seg.text}`;
      return `${ts} ${speakerName(participants, seg.speakerId)} : ${seg.text}`;
    })
    .join("\n");
}

function parseClock(value: string): number {
  // Accepte hh:mm:ss.mmm, hh:mm:ss,mmm, mm:ss.mmm
  const parts = value.trim().replace(",", ".").split(":");
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + parseFloat(part);
  return Math.round(seconds * 1000);
}

let idCounter = 0;
function segmentId(): string {
  idCounter += 1;
  return `imp-${Date.now().toString(36)}-${idCounter}`;
}

export interface ImportedTranscript {
  segments: TranscriptSegment[];
  /** Noms de locuteurs trouvés dans le fichier (ex. balises <v Nom> des VTT Teams). */
  speakers: string[];
}

/**
 * Importe une transcription existante (WebVTT de Teams/Zoom/Meet, SRT, ou texte brut
 * au format « Nom : texte »). Les locuteurs sont renvoyés par leur nom dans `speakerId`
 * et doivent être rapprochés des participants par l'appelant.
 */
export function parseTranscriptFile(content: string): ImportedTranscript {
  const text = content.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const speakers = new Set<string>();
  const segments: TranscriptSegment[] = [];
  const cueRe =
    /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*((\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

  if (cueRe.test(text)) {
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split("\n").filter((l) => l.trim() !== "");
      const cueIndex = lines.findIndex((l) => cueRe.test(l));
      if (cueIndex === -1) continue;
      const [startRaw, endRaw] = lines[cueIndex].split("-->");
      let body = lines.slice(cueIndex + 1).join(" ").trim();
      if (!body) continue;
      let speaker: string | undefined;
      const voice = body.match(/^<v\s+([^>]+)>/);
      if (voice) {
        speaker = voice[1].trim();
      } else {
        const colon = body.match(/^([^:]{2,40}):\s+/);
        if (colon) {
          speaker = colon[1].trim();
          body = body.slice(colon[0].length);
        }
      }
      body = body.replace(/<[^>]+>/g, "").trim();
      if (speaker) speakers.add(speaker);
      const start = parseClock(startRaw);
      const end = parseClock(endRaw.trim().split(/\s/)[0]);
      // Fusionne les répliques consécutives d'un même locuteur.
      const prev = segments[segments.length - 1];
      if (prev && prev.speakerId === speaker && start - (prev.end ?? prev.start) < 2000) {
        prev.text += ` ${body}`;
        prev.end = end;
      } else {
        segments.push({ id: segmentId(), start, end, speakerId: speaker, text: body, kind: "speech" });
      }
    }
    return { segments, speakers: [...speakers] };
  }

  // Texte brut : une réplique par ligne, « [hh:mm:ss] Nom : texte » (horodatage facultatif).
  let lastStart = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let rest = line;
    let start = lastStart;
    const ts = rest.match(/^\[?((\d{1,2}:)?\d{1,2}:\d{2})\]?\s*/);
    if (ts) {
      start = parseClock(ts[1]);
      rest = rest.slice(ts[0].length);
    }
    lastStart = start;
    let speaker: string | undefined;
    const colon = rest.match(/^([^:]{2,40})\s?:\s+/);
    if (colon) {
      speaker = colon[1].trim();
      rest = rest.slice(colon[0].length);
      speakers.add(speaker);
    }
    segments.push({ id: segmentId(), start, speakerId: speaker, text: rest, kind: "speech" });
  }
  return { segments, speakers: [...speakers] };
}
