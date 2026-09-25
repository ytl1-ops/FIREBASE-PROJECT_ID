import { describe, expect, it } from "vitest";
import { parseTranscriptFile } from "../shared/transcript.ts";
import { parseMarkdown } from "../src/lib/markdown.ts";

// Entrées conçues pour provoquer un retour arrière exponentiel : doivent rester instantanées.
describe("expressions régulières (anti-ReDoS)", () => {
  it("analyse Markdown en temps linéaire", () => {
    const evil = ["| " + "- ".repeat(20000) + "x", "-".repeat(50000) + "x", " *".repeat(20000) + "x"];
    const t0 = performance.now();
    for (const line of evil) parseMarkdown(`${line}\n${line}\n`);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("import de transcription en temps linéaire", () => {
    const evil = "1:".repeat(20000) + "\n" + "[" + "12:".repeat(20000) + "x\n" + "00:00:01.000 -->" + " ".repeat(50000);
    const t0 = performance.now();
    parseTranscriptFile(evil);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("reconnaît toujours tableaux et séparateurs", () => {
    expect(parseMarkdown("| a | b |\n|:--|--:|\n| 1 | 2 |")[0]).toMatchObject({ type: "table", rows: [["1", "2"]] });
    expect(parseMarkdown("* * *")[0]).toEqual({ type: "hr" });
    expect(parseMarkdown("- - -")[0]).toEqual({ type: "hr" });
  });
});
