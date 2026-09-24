import { describe, expect, it } from "vitest";
import { formatTimestamp, formatTranscript, parseTranscriptFile } from "../shared/transcript.ts";

describe("formatTimestamp", () => {
  it("formate minutes et heures", () => {
    expect(formatTimestamp(65_000)).toBe("01:05");
    expect(formatTimestamp(3_725_000)).toBe("1:02:05");
  });
});

describe("parseTranscriptFile", () => {
  it("lit un WebVTT Teams avec balises de voix et fusionne les répliques", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Claire Martin>Bonjour à tous.</v>

00:00:04.500 --> 00:00:06.000
<v Claire Martin>Commençons par la situation.</v>

00:00:07.000 --> 00:00:09.000
<v Paul Diallo>La route nord est fermée.</v>`;
    const { segments, speakers } = parseTranscriptFile(vtt);
    expect(speakers).toEqual(["Claire Martin", "Paul Diallo"]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      start: 1000,
      end: 6000,
      speakerId: "Claire Martin",
      text: "Bonjour à tous. Commençons par la situation.",
    });
  });

  it("lit un SRT avec « Nom : texte »", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Ahmed : Le couvre-feu est prolongé.`;
    const { segments } = parseTranscriptFile(srt);
    expect(segments[0]).toMatchObject({ speakerId: "Ahmed", text: "Le couvre-feu est prolongé.", start: 1000 });
  });

  it("lit un texte brut horodaté", () => {
    const { segments } = parseTranscriptFile("[00:10] Alice : Point un.\n[01:02] Bob : Point deux.");
    expect(segments.map((s) => [s.start, s.speakerId, s.text])).toEqual([
      [10_000, "Alice", "Point un."],
      [62_000, "Bob", "Point deux."],
    ]);
  });
});

describe("formatTranscript", () => {
  it("résout les noms et signale notes et marque-pages", () => {
    const out = formatTranscript(
      [
        { id: "1", start: 0, speakerId: "p1", text: "Ouverture." },
        { id: "2", start: 5000, text: "Décision clé", kind: "bookmark" },
        { id: "3", start: 6000, speakerId: "Locuteur 2", text: "D'accord." },
      ],
      [{ id: "p1", name: "Claire", presence: "present" }],
    );
    expect(out).toBe(
      "[00:00] Claire : Ouverture.\n[00:05] ★ MARQUE-PAGE : Décision clé\n[00:06] Locuteur 2 : D'accord.",
    );
  });
});
