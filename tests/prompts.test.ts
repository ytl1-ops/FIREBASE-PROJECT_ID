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
