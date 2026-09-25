import { describe, expect, it } from "vitest";
import type { Meeting } from "../src/lib/db.ts";
import { buildMeetingPackage, PasswordRequiredError, readMeetingPackage } from "../src/lib/share.ts";

const meeting: Meeting = {
  id: "r-1",
  createdAt: "2026-09-24T08:00:00.000Z",
  updatedAt: "2026-09-24T08:00:00.000Z",
  info: {
    title: "Comité sûreté",
    date: "2026-09-24T08:00:00.000Z",
    agenda: [],
    participants: [],
    classification: "confidentiel",
  },
  transcript: [{ id: "s", start: 0, text: "Route nord fermée." }],
  notes: "",
  durationMs: 1000,
  audioChunks: 1,
  documents: {},
};
const audio = new Blob([new Uint8Array([1, 2, 3, 250])], { type: "audio/webm" });

describe("paquet .monmeeting", () => {
  it("aller-retour en clair avec audio", async () => {
    const pkg = await buildMeetingPackage(meeting, audio);
    const { meeting: back, audio: a } = await readMeetingPackage(pkg);
    expect(back.transcript[0].text).toBe("Route nord fermée.");
    expect(a?.mime).toBe("audio/webm");
    expect(atob(a!.data).split("").map((c) => c.charCodeAt(0))).toEqual([1, 2, 3, 250]);
  });

  it("chiffré : illisible sans mot de passe, refusé avec un mauvais", async () => {
    const pkg = await buildMeetingPackage(meeting, null, "motdepasse-solide");
    const raw = await pkg.text();
    expect(raw).not.toContain("Route nord");
    expect(raw).not.toContain("Comité");
    await expect(readMeetingPackage(pkg)).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(readMeetingPackage(pkg, "mauvais")).rejects.toThrow("Mot de passe incorrect");
    const { meeting: back } = await readMeetingPackage(pkg, "motdepasse-solide");
    expect(back.info.title).toBe("Comité sûreté");
  });

  it("refuse un fichier étranger", async () => {
    await expect(readMeetingPackage(new Blob(["{}"]))).rejects.toThrow("pas une réunion");
  });
});

describe("taille du paquet", () => {
  it("reste proche de la taille de l'audio (pas d'inflation base64)", async () => {
    const big = new Uint8Array(300_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24; // quasi aléatoire
    const pkg = await buildMeetingPackage(meeting, new Blob([big], { type: "audio/webm" }), "motdepasse-solide");
    expect(pkg.size).toBeLessThan(big.length * 1.08);
    const { audio: a } = await readMeetingPackage(pkg, "motdepasse-solide");
    expect(atob(a!.data).length).toBe(big.length);
  });
});

describe("compatibilité v1", () => {
  it("relit un ancien paquet JSON en clair", async () => {
    const v1 = { format: "monmeeting", version: 1, title: "x", createdAt: "", encrypted: false, data: JSON.stringify({ meeting }) };
    const { meeting: back } = await readMeetingPackage(new Blob([JSON.stringify(v1)]));
    expect(back.info.title).toBe("Comité sûreté");
  });
});
