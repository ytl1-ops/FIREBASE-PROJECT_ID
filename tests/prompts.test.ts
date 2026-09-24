import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "../shared/prompts.ts";

describe("buildUserPrompt", () => {
  it("inclut consignes, participants, transcription et classification", () => {
    const prompt = buildUserPrompt({
      type: "tbm",
      meeting: {
        title: "Causerie convoi",
        date: "2026-09-24T08:00:00.000Z",
        agenda: ["Itinéraire", ""],
        participants: [{ id: "p1", name: "Awa", role: "Chef de convoi", presence: "present" }],
        classification: "confidentiel",
      },
      transcript: [{ id: "s", start: 3000, speakerId: "p1", text: "Départ à 6 h." }],
      notes: "Checkpoint à Gao.",
    });
    expect(prompt).toContain("Tool Box Meeting");
    expect(prompt).toContain("- Awa (Chef de convoi) — présent(e)");
    expect(prompt).toContain("[00:03] Awa : Départ à 6 h.");
    expect(prompt).toContain("Classification : Confidentiel");
    expect(prompt).toContain("1. Itinéraire\n</");
    expect(prompt).toContain("<notes_du_redacteur>\nCheckpoint à Gao.");
  });
});

describe("pièces jointes", () => {
  it("intègre le texte et annonce les PDF", async () => {
    const { buildManualPrompt } = await import("../shared/prompts.ts");
    const prompt = buildManualPrompt({
      type: "note_synthese",
      meeting: { title: "Synthèse", date: "2026-09-24T08:00:00.000Z", agenda: [], participants: [], classification: "non_protege" },
      transcript: [],
      attachments: [
        { id: "1", name: "rapport.docx", size: 10, kind: "text", text: "Hausse des enlèvements." },
        { id: "2", name: "carte.pdf", size: 10, kind: "pdf", data: "AAAA" },
      ],
    });
    expect(prompt).toContain('<piece_jointe nom="rapport.docx">\nHausse des enlèvements.');
    expect(prompt).toContain("« carte.pdf »");
    expect(prompt).toContain("Joignez aussi à ce message les fichiers PDF : carte.pdf");
    expect(prompt).not.toContain("AAAA");
  });
});
