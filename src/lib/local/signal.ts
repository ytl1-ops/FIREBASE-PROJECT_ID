/**
 * Traitements de signal purs (sans dépendance au navigateur) utilisés par la
 * transcription locale : découpage de l'audio et regroupement des voix.
 */

export interface Window {
  start: number; // échantillon de début (inclus)
  end: number; // échantillon de fin (exclu)
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

/**
 * Découpe l'audio en fenêtres d'au plus `maxSec` secondes (limite de Whisper), en coupant
 * dans le passage le plus silencieux des `searchSec` dernières secondes pour ne pas
 * trancher un mot.
 */
export function splitWindows(
  samples: Float32Array,
  sampleRate: number,
  maxSec = 30,
  searchSec = 5,
): Window[] {
  const maxLen = Math.floor(maxSec * sampleRate);
  const search = Math.floor(searchSec * sampleRate);
  const frame = Math.floor(0.05 * sampleRate);
  const windows: Window[] = [];
  let start = 0;
  while (start < samples.length) {
    let end = Math.min(samples.length, start + maxLen);
    if (end < samples.length) {
      let best = end;
      let bestEnergy = Infinity;
      for (let f = end - frame; f >= end - search && f > start; f -= frame) {
        const e = rms(samples, f, f + frame);
        if (e < bestEnergy) {
          bestEnergy = e;
          best = f + Math.floor(frame / 2);
        }
      }
      end = best;
    }
    windows.push({ start, end });
    start = end;
  }
  return windows;
}

/** Vrai si la fenêtre ne contient pratiquement que du silence (évite les « hallucinations » de Whisper). */
export function isSilent(samples: Float32Array, win: Window, threshold = 0.004): boolean {
  return rms(samples, win.start, win.end) < threshold;
}

/** Phrases que Whisper invente sur du silence ou du bruit. */
const HALLUCINATIONS = [
  /sous-titr(es|age)/i,
  /amara\.org/i,
  /merci d'avoir regardé/i,
  /abonnez-vous/i,
  /thanks? for watching/i,
  /^\W*$/,
];

export function isHallucination(text: string): boolean {
  return HALLUCINATIONS.some((re) => re.test(text.trim()));
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/**
 * Regroupement hiérarchique (lien moyen, similarité cosinus) des empreintes vocales.
 * - `k` connu : fusion jusqu'à obtenir exactement k groupes ;
 * - sinon : fusion tant que la similarité moyenne entre deux groupes dépasse `threshold`.
 * Renvoie l'indice de groupe de chaque empreinte, numéroté par ordre de première apparition.
 */
export function clusterEmbeddings(
  embeddings: Float32Array[],
  options: { k?: number; threshold?: number } = {},
): number[] {
  const n = embeddings.length;
  if (n === 0) return [];
  const threshold = options.threshold ?? 0.72;
  const k = options.k ? Math.max(1, Math.min(options.k, n)) : undefined;

  const sim: number[][] = embeddings.map((a) => embeddings.map((b) => cosine(a, b)));
  let clusters: number[][] = embeddings.map((_, i) => [i]);

  const linkage = (a: number[], b: number[]) => {
    let total = 0;
    for (const i of a) for (const j of b) total += sim[i][j];
    return total / (a.length * b.length);
  };

  while (clusters.length > 1) {
    let bestI = -1;
    let bestJ = -1;
    let best = -Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const s = linkage(clusters[i], clusters[j]);
        if (s > best) {
          best = s;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (k !== undefined ? clusters.length <= k : best < threshold) break;
    clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
    clusters.splice(bestJ, 1);
  }

  const labels = new Array<number>(n);
  clusters
    .map((members) => [...members].sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0])
    .forEach((members, label) => members.forEach((m) => (labels[m] = label)));
  return labels;
}
