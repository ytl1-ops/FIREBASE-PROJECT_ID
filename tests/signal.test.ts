import { describe, expect, it } from "vitest";
import { clusterEmbeddings, isHallucination, isSilent, splitWindows } from "../src/lib/local/signal.ts";

const SR = 1000; // fréquence réduite pour des tests rapides

function tone(seconds: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(seconds * SR);
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(i / 3);
  return out;
}

describe("splitWindows", () => {
  it("couvre tout l'audio sans chevauchement ni fenêtre > 30 s", () => {
    const audio = tone(95);
    const windows = splitWindows(audio, SR);
    expect(windows[0].start).toBe(0);
    expect(windows[windows.length - 1].end).toBe(audio.length);
    for (let i = 1; i < windows.length; i++) expect(windows[i].start).toBe(windows[i - 1].end);
    for (const w of windows) expect(w.end - w.start).toBeLessThanOrEqual(30 * SR);
  });

  it("coupe dans le silence", () => {
    const audio = tone(40);
    audio.fill(0, 27 * SR, 28 * SR); // silence entre 27 et 28 s
    const [first] = splitWindows(audio, SR);
    expect(first.end).toBeGreaterThanOrEqual(27 * SR);
    expect(first.end).toBeLessThanOrEqual(28 * SR);
  });
});

describe("isSilent / isHallucination", () => {
  it("détecte silence et phrases parasites", () => {
    expect(isSilent(new Float32Array(1000), { start: 0, end: 1000 })).toBe(true);
    expect(isSilent(tone(1), { start: 0, end: SR })).toBe(false);
    expect(isHallucination("Sous-titres réalisés par la communauté d'Amara.org")).toBe(true);
    expect(isHallucination("La route nord est fermée.")).toBe(false);
  });
});

describe("clusterEmbeddings", () => {
  const a = new Float32Array([1, 0, 0]);
  const a2 = new Float32Array([0.95, 0.1, 0]);
  const b = new Float32Array([0, 1, 0]);
  const b2 = new Float32Array([0.1, 0.9, 0.05]);
  const c = new Float32Array([0, 0, 1]);

  it("regroupe par seuil et numérote par ordre d'apparition", () => {
    expect(clusterEmbeddings([b, a, b2, a2, c])).toEqual([0, 1, 0, 1, 2]);
  });

  it("respecte un nombre de voix imposé", () => {
    expect(new Set(clusterEmbeddings([a, a2, b, b2, c], { k: 2 })).size).toBe(2);
    expect(clusterEmbeddings([a, a2, b], { k: 5 })).toEqual([0, 1, 2]);
  });
});
