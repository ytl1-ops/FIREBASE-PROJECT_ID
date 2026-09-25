/**
 * Moteur de synthèse AUTONOME : aucune IA générative, aucun serveur, aucune clé.
 * Tout se fait sur l'appareil, instantanément, par analyse du texte de la réunion :
 * repérage des décisions, actions (responsable, échéance), risques, points en suspens,
 * sélection des phrases clés (fréquence des termes), rattachement à l'ordre du jour.
 * Le document produit reprend les propos exacts, horodatés, pour vérification.
 */
import { getDocument } from "./documents.ts";
import { PRESENCE_LABELS, formatDate } from "./prompts.ts";
import { formatTimestamp, speakerName } from "./transcript.ts";
import {
  CLASSIFICATION_LABELS,
  type AskRequest,
  type Attachment,
  type DocumentType,
  type GenerateRequest,
  type MeetingInfo,
  type TranscriptSegment,
} from "./types.ts";

export interface Phrase {
  /** Position dans la réunion (ms). */
  t: number;
  speaker: string;
  /** Identifiant du locuteur (pour savoir qui dit « je »). */
  speakerKnown: boolean;
  text: string;
  kind: "speech" | "note" | "bookmark";
  /** Index du point de l'ordre du jour (ou de la partie chronologique). */
  point: number;
  score: number;
}

export interface Action {
  phrase: Phrase;
  responsable: string;
  echeance: string;
  priorite: "Haute" | "Normale";
}

export interface Analyse {
  dureeMs: number;
  intervenants: { nom: string; tempsMs: number; interventions: number }[];
  themes: string[];
  points: { titre: string; phrases: Phrase[] }[];
  pointsCles: Phrase[];
  decisions: Phrase[];
  actions: Action[];
  risques: Phrase[];
  suspens: Phrase[];
  questions: { question: Phrase; reponse?: Phrase }[];
  consignes: Phrase[];
  retours: Phrase[];
  marques: Phrase[];
  prochaineReunion?: Phrase;
  piecesJointes: { nom: string; extraits: string[] }[];
  phrases: Phrase[];
}

// ------------------------------------------------------------------ Outils de texte

/** Minuscules sans accents, même longueur que le texte d'origine (NFC). */
export function normaliser(text: string): string {
  return text
    .normalize("NFC")
    .split("")
    .map((c) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().charAt(0) || c)
    .join("")
    .replace(/[’`]/g, "'");
}

const STOPWORDS = new Set(
  (
    "alors aussi autre autres avec avoir avait avons bien car ceci cela celle celles celui ceux cette chaque chez comme comment " +
    "dans des deja depuis donc dont elle elles encore entre etre etait etaient fait faire faut font hors ici ils juste leur leurs " +
    "lors mais meme memes moins mon nos notre nous oui non parce pour pourquoi quand quel quelle quelles quels quoi sans sera " +
    "seront ses sont sous suis tout tous toute toutes tres trop une uns vers vos votre vous voila voilà cest cetait quil quelle " +
    "puis peut peuvent peu plus pas par sur son sa ses les des aux avec ceux elle nous vous ils elles donc ainsi apres avant " +
    "voir vais allez allons va vont dit dire disait bon ben euh hein bah enfin quoi truc chose choses genre effectivement " +
    "justement vraiment voilà simplement actuellement notamment egalement toujours jamais rien personne quelque quelques " +
    "merci bonjour monsieur madame d'accord okay accord ceux-ci celle-ci celui-ci peut-etre etc " +
    "reste restent point points niveau fois moment partie prochaine prochain dernier derniere question questions nouvel nouvelle ordre cours faire fait pense crois sais veux voulons"
  ).split(" "),
);

function mots(text: string): string[] {
  return normaliser(text)
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .split(/[\s']+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** Racine grossière (5 premières lettres) : « sécurité » ≈ « sécuriser ». */
const racine = (w: string) => w.slice(0, 5);

function decouperPhrases(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    for (const s of line.split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"])/u)) {
      const clean = s.replace(/\s+/g, " ").trim();
      if (clean) out.push(clean);
    }
  }
  return out;
}

const couper = (s: string, max = 320) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const cellule = (s: string) => couper(s.replace(/\|/g, "/").replace(/\n/g, " "), 260);
const premiereMaj = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ Lexiques (texte normalisé)

const RE_DECISION =
  /\b(on (a )?decide|nous (avons )?decide|il (est|a ete) decide|decision|decide de|on valide|c'?est valide|est valide|valide[es]? |approuve|adopte|on retient|est retenu|acte|on arrete|est arrete|d'?accord pour|on part sur|on maintient|est maintenu|on suspend|est suspendu|on reporte|est reporte|il est convenu|convenu|on s'?accorde|est entendu|feu vert|on garde|on annule|est annule|interdiction de|desormais)/;
const RE_ACTION =
  /\b(je vais|je m'?en (charge|occupe)|je le fais|je prends|on va |nous allons|vous allez|tu vas|il va |elle va |ils vont|il faut|il faudra|il faudrait|doit |doivent|devra|devront|se charge|s'?occupe|a faire|charge de|merci de|je propose de|relancer|envoyer|transmettre|preparer|organiser|verifier|mettre a jour|programmer|planifier|contacter|informer|rediger|diffuser|remonter|renforcer|installer|former|sensibiliser)/;
const RE_RISQUE =
  /\b(risque|menace|danger|incident|attaque|attentat|enlevement|kidnapping|rapt|braquage|agression|cambriolage|vol |vols |manifestation|emeute|troubles|insecurit|vigilance|alerte|couvre-feu|evacu|explosi|engin|tirs?\b|arme|checkpoint|barrage|embuscade|accident|blesse|victime|terroris|jihad|criminalit|banditisme|piraterie|cyber|hameconnage|fraude|intrusion|vulnerabilit|niveau (de )?(securite|surete|menace|alerte)|zone rouge|zone orange|deconseill|instabilit|coup d'?etat|tension)/;
const RE_SUSPENS =
  /\b(en suspens|a trancher|a arbitrer|arbitrage|pas encore (decide|tranche|clair|valide)|on verra|a voir|on en reparlera|on reviendra|reste a (definir|determiner|confirmer|valider)|a confirmer|a preciser|pas de consensus|desaccord|pas d'?accord|question ouverte|a clarifier|en attente)/;
const RE_CONSIGNE =
  /\b(consigne|obligatoire|interdit|il faut|toujours|jamais|port du|porter|respecter|ne (pas|jamais)|pensez a|rappel|imperatif|systematiquement|en cas de|signaler|prevenir)/;
const RE_RETOUR =
  /\b(retour d'?experience|rex\b|presque[- ]accident|la derniere fois|s'?est produit|est arrive|on a eu|il y a eu|l'?an dernier|la semaine derniere|hier)/;
const RE_JE = /\b(je vais|je m'?en (charge|occupe)|je le fais|je prends|je propose de|je m'?engage)/;
const RE_URGENT = /\b(urgent|urgence|immediat|priorit|asap|au plus vite|des que possible|sans delai|critique)/;
const RE_PROCHAINE = /\b(prochaine reunion|prochain point|on se revoit|se retrouve|reunion suivante|prochaine seance)/;
const RE_REMPLISSAGE = /^(oui|non|ok|okay|d'?accord|merci|tres bien|bien sur|voila|exactement|parfait|bonjour|au revoir)\b/;

const MOIS = "janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre";
const JOURS = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche";
const RE_ECHEANCE = new RegExp(
  `\\b(aujourd'?hui|demain|apres-demain|ce soir|cette semaine|(la )?semaine prochaine|le mois prochain|` +
    `d'?ici (a )?(la fin (du|de la) \\w+|(${JOURS})|(\\d+|deux|trois|quatre|huit|quinze) (jours|semaines|mois)|demain)|` +
    `avant (le |la )?(\\d{1,2}( (${MOIS}))?|${JOURS}|(la )?fin (du mois|de (la )?semaine|de l'?annee)|demain)|` +
    `fin (du mois|de (la )?semaine|de l'?annee|(${MOIS}))|` +
    `((ce |le )?(${JOURS})( prochain)?)|le \\d{1,2}(er)?( (${MOIS}))?|\\d{1,2}/\\d{1,2}(/\\d{2,4})?|` +
    `sous (\\d+|huit|quinze|quarante-huit) (jours|heures|h)|asap|immediatement|des que possible|au plus vite)\\b`,
);

function extraitOriginal(text: string, re: RegExp): string | undefined {
  const nfc = text.normalize("NFC");
  const m = re.exec(normaliser(nfc));
  return m ? nfc.slice(m.index, m.index + m[0].length).trim() : undefined;
}

// ------------------------------------------------------------------ Analyse

function phrasesDe(meeting: MeetingInfo, transcript: TranscriptSegment[], notes?: string): Phrase[] {
  const out: Phrase[] = [];
  for (const seg of transcript) {
    const kind = seg.kind ?? "speech";
    const speaker = kind === "speech" ? speakerName(meeting.participants, seg.speakerId) : kind === "note" ? "Note du rédacteur" : "Marque-page";
    for (const text of decouperPhrases(seg.text)) {
      out.push({ t: seg.start, speaker, speakerKnown: Boolean(seg.speakerId), text, kind, point: 0, score: 0 });
    }
  }
  if (notes?.trim()) {
    const fin = transcript.reduce((m, s) => Math.max(m, s.end ?? s.start), 0);
    for (const text of decouperPhrases(notes)) {
      out.push({ t: fin, speaker: "Note du rédacteur", speakerKnown: false, text, kind: "note", point: 0, score: 0 });
    }
  }
  return out;
}

function responsableDe(p: Phrase, participants: MeetingInfo["participants"]): string {
  const n = normaliser(p.text);
  if (RE_JE.test(n) && p.kind === "speech" && p.speakerKnown) return p.speaker;
  for (const part of participants) {
    const noms = [part.name, ...part.name.split(/\s+/).filter((x) => x.length >= 3)].map(normaliser);
    if (noms.some((nom) => nom && new RegExp(`\\b${nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n))) return part.name;
  }
  if (/\b(on va|nous allons|il faut|il faudra)\b/.test(n)) return "Collectif — à préciser";
  if (/\b(tu vas|vous allez)\b/.test(n)) return "Interlocuteur de " + p.speaker + " — à préciser";
  return "À préciser";
}

const cacheRacines = new Map<string, Set<string>>();
function racinesDe(text: string): Set<string> {
  let r = cacheRacines.get(text);
  if (!r) {
    if (cacheRacines.size > 20_000) cacheRacines.clear();
    r = new Set(mots(text).map(racine));
    cacheRacines.set(text, r);
  }
  return r;
}

function similaire(a: string, b: string): boolean {
  const A = racinesDe(a);
  const B = racinesDe(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  A.forEach((x) => B.has(x) && inter++);
  return inter / Math.min(A.size, B.size) > 0.7;
}

function dedoublonner<T>(items: T[], texte: (x: T) => string): T[] {
  const out: T[] = [];
  for (const it of items) if (!out.some((o) => similaire(texte(o), texte(it)))) out.push(it);
  return out;
}

export function analyser(req: Pick<GenerateRequest, "meeting" | "transcript" | "notes" | "attachments">): Analyse {
  const { meeting } = req;
  const phrases = phrasesDe(meeting, req.transcript, req.notes);
  const parole = phrases.filter((p) => p.kind === "speech");
  const dureeMs = req.transcript.reduce((m, s) => Math.max(m, s.end ?? s.start), 0);

  // Temps de parole : durée des segments (ou estimation à 2,5 mots/s).
  const temps = new Map<string, { tempsMs: number; interventions: number }>();
  req.transcript.forEach((seg, i) => {
    if ((seg.kind ?? "speech") !== "speech" || !seg.text.trim()) return;
    const nom = speakerName(meeting.participants, seg.speakerId);
    const fin = seg.end ?? req.transcript[i + 1]?.start ?? seg.start + (seg.text.split(/\s+/).length / 2.5) * 1000;
    const e = temps.get(nom) ?? { tempsMs: 0, interventions: 0 };
    e.tempsMs += Math.max(0, fin - seg.start);
    e.interventions += 1;
    temps.set(nom, e);
  });
  const intervenants = [...temps.entries()].map(([nom, v]) => ({ nom, ...v })).sort((a, b) => b.tempsMs - a.tempsMs);

  // Fréquence des termes (racines) sur toute la réunion.
  const freq = new Map<string, number>();
  const formes = new Map<string, Map<string, number>>();
  for (const p of phrases) {
    for (const w of mots(p.text)) {
      const r = racine(w);
      freq.set(r, (freq.get(r) ?? 0) + 1);
      const f = formes.get(r) ?? new Map<string, number>();
      f.set(w, (f.get(w) ?? 0) + 1);
      formes.set(r, f);
    }
  }
  const themes = [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([r]) => premiereMaj([...(formes.get(r) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0][0]));

  // Score des phrases : densité en termes fréquents, bonus pour les moments marqués.
  const marquesT = phrases.filter((p) => p.kind === "bookmark").map((p) => p.t);
  for (const p of phrases) {
    const racines = [...new Set(mots(p.text).map(racine))];
    const n = normaliser(p.text);
    let s = racines.reduce((acc, r) => acc + Math.log(1 + (freq.get(r) ?? 0)), 0) / Math.sqrt(Math.max(racines.length, 1) + 2);
    if (racines.length < 4 || RE_REMPLISSAGE.test(n)) s *= 0.4;
    if (p.kind !== "speech") s *= 1.6;
    if (marquesT.some((t) => p.t >= t - 5000 && p.t <= t + 30000)) s *= 1.5;
    if (RE_DECISION.test(n) || RE_RISQUE.test(n)) s *= 1.3;
    if (p.text.trim().endsWith("?")) s *= 0.7;
    p.score = s;
  }

  // Rattachement à l'ordre du jour (sinon, parties chronologiques).
  const agenda = meeting.agenda.map((a) => a.trim()).filter(Boolean);
  let points: { titre: string; phrases: Phrase[] }[];
  if (agenda.length) {
    const cles = agenda.map((a) => new Set(mots(a).map(racine)));
    let courant = 0;
    for (const p of phrases) {
      const r = new Set(mots(p.text).map(racine));
      let best = -1;
      let bestScore = 0;
      cles.forEach((c, i) => {
        let sc = 0;
        c.forEach((x) => r.has(x) && sc++);
        // Les réunions suivent en général l'ordre du jour : léger avantage au point en cours et au suivant.
        const bonus = i === courant ? 0.3 : i === courant + 1 ? 0.2 : 0;
        if (sc > 0 && sc + bonus > bestScore) {
          best = i;
          bestScore = sc + bonus;
        }
      });
      if (best >= 0) courant = best;
      p.point = courant;
    }
    points = agenda.map((titre, i) => ({ titre, phrases: phrases.filter((p) => p.point === i) }));
  } else {
    const tranche = Math.max(5 * 60_000, Math.ceil(dureeMs / 6 / 60_000) * 60_000);
    const n = Math.max(1, Math.ceil((dureeMs + 1) / tranche));
    for (const p of phrases) p.point = Math.min(n - 1, Math.floor(p.t / tranche));
    points = Array.from({ length: n }, (_, i) => ({
      titre: n === 1 ? "Échanges" : `Partie ${i + 1} (${formatTimestamp(i * tranche)} – ${formatTimestamp(Math.min((i + 1) * tranche, dureeMs))})`,
      phrases: phrases.filter((p) => p.point === i),
    }));
  }

  const classe = (re: RegExp, source = phrases) => source.filter((p) => re.test(normaliser(p.text)));
  const nonQuestion = (p: Phrase) => !p.text.trim().endsWith("?");

  const decisions = dedoublonner(classe(RE_DECISION).filter(nonQuestion), (p) => p.text);
  const actions = dedoublonner(
    classe(RE_ACTION)
      .filter(nonQuestion)
      .filter((p) => !decisions.includes(p) || RE_ECHEANCE.test(normaliser(p.text))),
    (p) => p.text,
  ).map<Action>((p) => ({
    phrase: p,
    responsable: responsableDe(p, meeting.participants),
    echeance: extraitOriginal(p.text, RE_ECHEANCE) ?? "À préciser",
    priorite: RE_URGENT.test(normaliser(p.text)) ? "Haute" : "Normale",
  }));
  const risques = dedoublonner(classe(RE_RISQUE), (p) => p.text);
  const suspens = dedoublonner(classe(RE_SUSPENS), (p) => p.text);
  const consignes = dedoublonner(classe(RE_CONSIGNE).filter(nonQuestion), (p) => p.text);
  const retours = dedoublonner(classe(RE_RETOUR), (p) => p.text);
  const questions = parole
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.text.trim().endsWith("?") && mots(p.text).length >= 2)
    .map(({ p, i }) => {
      const reponse = parole.slice(i + 1, i + 4).find((r) => r.speaker !== p.speaker && !r.text.trim().endsWith("?"));
      return { question: p, reponse };
    });
  const marques = phrases.filter((p) => p.kind !== "speech");
  const prochaineReunion = classe(RE_PROCHAINE)[0];

  const nbCles = Math.min(15, Math.max(5, Math.round(parole.length * 0.12)));
  const pointsCles = dedoublonner([...phrases].sort((a, b) => b.score - a.score), (p) => p.text)
    .slice(0, nbCles)
    .sort((a, b) => a.t - b.t);

  // Pièces jointes texte : phrases les plus représentatives de chaque document.
  const piecesJointes = (req.attachments ?? []).map((a: Attachment) => {
    const src = a.kind === "text" ? (a.text ?? "") : "";
    const ph = decouperPhrases(src).filter((s) => s.length > 30);
    const f = new Map<string, number>();
    ph.forEach((s) => mots(s).forEach((w) => f.set(racine(w), (f.get(racine(w)) ?? 0) + 1)));
    const notees = ph.map((s, i) => {
      const r = [...new Set(mots(s).map(racine))];
      return { s, i, sc: r.reduce((acc, x) => acc + Math.log(1 + (f.get(x) ?? 0)), 0) / Math.sqrt(r.length + 2) };
    });
    const extraits = dedoublonner(notees.sort((x, y) => y.sc - x.sc), (x) => x.s)
      .slice(0, 6)
      .sort((x, y) => x.i - y.i)
      .map((x) => couper(x.s));
    return { nom: a.name, extraits: extraits.length ? extraits : [a.kind === "pdf" ? "(PDF : texte non extrait)" : "(document vide)"] };
  });

  // Longues réunions : on garde les éléments les plus significatifs, dans l'ordre chronologique.
  const garder = <T,>(items: T[], max: number, ph: (x: T) => Phrase) =>
    items.length <= max ? items : [...items].sort((x, y) => ph(y).score - ph(x).score).slice(0, max).sort((x, y) => ph(x).t - ph(y).t);
  const id = (p: Phrase) => p;

  return {
    dureeMs,
    intervenants,
    themes,
    points,
    pointsCles,
    decisions: garder(decisions, 30, id),
    actions: garder(actions, 40, (x) => x.phrase),
    risques: garder(risques, 30, id),
    suspens: garder(suspens, 20, id),
    questions: garder(questions, 20, (x) => x.question),
    consignes: garder(consignes, 15, id),
    retours: garder(retours, 15, id),
    marques,
    prochaineReunion,
    piecesJointes,
    phrases,
  };
}

// ------------------------------------------------------------------ Mise en forme

const ts = (p: Phrase) => `[${formatTimestamp(p.t)}]`;
const cite = (p: Phrase) =>
  p.kind === "speech" ? `**${p.speaker}** ${ts(p)} : ${couper(p.text)}` : `${p.kind === "bookmark" ? "★" : "✎"} ${ts(p)} ${couper(p.text)}`;
const liste = (items: string[], vide = "_Aucun élément détecté — à préciser._") =>
  items.length ? items.map((x) => `- ${x}`).join("\n") : vide;
const numerotee = (items: string[], vide = "_Aucun élément détecté — à préciser._") =>
  items.length ? items.map((x, i) => `${i + 1}. ${x}`).join("\n") : vide;

function duree(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "moins d'une minute";
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`;
}

function entete(meeting: MeetingInfo, a: Analyse, extra: [string, string][] = []): string {
  const lignes: [string, string][] = [
    ["Objet", meeting.title || "À préciser"],
    ["Date", formatDate(meeting.date, meeting.timeZone)],
    ["Lieu", meeting.location || "À préciser"],
    ["Organisateur / président(e) de séance", meeting.organiser || "À préciser"],
    ...extra,
    ["Durée enregistrée", a.dureeMs ? duree(a.dureeMs) : "—"],
    ["Classification", CLASSIFICATION_LABELS[meeting.classification]],
  ];
  return `| | |\n|---|---|\n${lignes.map(([k, v]) => `| **${k}** | ${cellule(v)} |`).join("\n")}`;
}

function emargement(meeting: MeetingInfo, a: Analyse, signature = false): string {
  const parts = meeting.participants;
  if (!parts.length) {
    const noms = a.intervenants.map((i) => i.nom).filter((n) => n !== "Intervenant non identifié");
    return noms.length
      ? `Participants non renseignés ; intervenants entendus : ${noms.join(", ")}.`
      : "_Participants non renseignés — à préciser._";
  }
  const head = signature ? "| Nom | Fonction | Organisation | Présence | Signature |\n|---|---|---|---|---|" : "| Nom | Fonction | Organisation | Présence |\n|---|---|---|---|";
  return `${head}\n${parts
    .map((p) => `| ${cellule(p.name)} | ${cellule(p.role ?? "")} | ${cellule(p.organisation ?? "")} | ${PRESENCE_LABELS[p.presence]} |${signature ? " |" : ""}`)
    .join("\n")}`;
}

function tableauActions(a: Analyse, colonnes: "cr" | "rd" | "tbm"): string {
  if (!a.actions.length) return "_Aucune action détectée — à préciser._";
  if (colonnes === "tbm") {
    return `| Action | Responsable | Échéance |\n|---|---|---|\n${a.actions
      .map((x) => `| ${cellule(x.phrase.text)} ${ts(x.phrase)} | ${cellule(x.responsable)} | ${cellule(x.echeance)} |`)
      .join("\n")}`;
  }
  const last = colonnes === "cr" ? "Statut" : "Priorité";
  return `| N° | Action | Responsable | Échéance | ${last} |\n|---|---|---|---|---|\n${a.actions
    .map(
      (x, i) =>
        `| ${i + 1} | ${cellule(x.phrase.text)} ${ts(x.phrase)} | ${cellule(x.responsable)} | ${cellule(x.echeance)} | ${colonnes === "cr" ? "À lancer" : x.priorite} |`,
    )
    .join("\n")}`;
}

function piecesJointes(a: Analyse): string {
  if (!a.piecesJointes.length) return "";
  return `\n\n## Documents joints — extraits essentiels\n\n${a.piecesJointes
    .map((d) => `### ${d.nom}\n\n${liste(d.extraits.map((e) => `« ${e} »`))}`)
    .join("\n\n")}`;
}

/** Propos sans contenu (« Oui. », « Merci. ») écartés des résumés. */
const significatif = (p: Phrase) => p.kind !== "speech" || (mots(p.text).length >= 2 && !RE_REMPLISSAGE.test(normaliser(p.text))) || mots(p.text).length >= 4;

function resumePoint(pt: { titre: string; phrases: Phrase[] }, max: number): string[] {
  return dedoublonner([...pt.phrases].filter(significatif).sort((x, y) => y.score - x.score), (p) => p.text)
    .slice(0, max)
    .sort((x, y) => x.t - y.t)
    .map(cite);
}

const MENTION =
  "\n\n---\n\n_Document établi automatiquement sur l'appareil par MonMeeting (mode autonome : extraction des propos, sans IA générative ni envoi de données). Les passages cités sont horodatés pour vérification — à relire, compléter et valider avant diffusion._";

function pied(meeting: MeetingInfo) {
  return `${MENTION}\n\n**${CLASSIFICATION_LABELS[meeting.classification]}**`;
}

function niveau(p: Phrase): string {
  const n = normaliser(p.text);
  if (/\bcritique\b/.test(n)) return "Critique";
  if (/\b(eleve|fort|forte|grave|serieu)/.test(n)) return "Élevé";
  if (/\b(modere|moyen)/.test(n)) return "Modéré";
  if (/\b(faible|limite)\b/.test(n)) return "Faible";
  return "À évaluer";
}

function mesureAssociee(a: Analyse, risque: Phrase): string {
  const i = a.phrases.indexOf(risque);
  const proche = a.phrases
    .slice(i, i + 4)
    .find((p) => /\b(mesure|consigne|protection|prevention|il faut|doit|escorte|renforc|eviter|interdi|limiter)/.test(normaliser(p.text)));
  return proche ? `${cellule(proche.text)} ${ts(proche)}` : "À préciser";
}

export function redigerSansIA(req: GenerateRequest, analyse?: Analyse): string {
  const a = analyse ?? analyser(req);
  const m = req.meeting;
  const doc = getDocument(req.type);
  const titre = `# ${doc.label} — ${m.title || "Réunion"}\n\n**${CLASSIFICATION_LABELS[m.classification]}**`;
  const agenda = m.agenda.filter((x) => x.trim());
  const consignesRedacteur = req.instructions?.trim()
    ? `\n\n> Consignes du rédacteur (à appliquer lors de la relecture) : ${req.instructions.trim()}`
    : "";
  const decisions = numerotee(a.decisions.map(cite));
  const suspens = liste(a.suspens.map(cite), "_Aucun point en suspens détecté._");
  const risques = liste(a.risques.map(cite), "_Aucun risque ou menace détecté dans les échanges._");

  const corps: Record<DocumentType, () => string> = {
    pv: () =>
      [
        titre,
        entete(m, a, [["Secrétaire de séance", "À désigner"]]),
        `## 1. Liste d'émargement\n\n${emargement(m, a)}`,
        `## 2. Ordre du jour\n\n${numerotee(agenda, "_Non renseigné._")}`,
        `## 3. Déroulé de la séance\n\n${a.points
          .filter((pt) => pt.phrases.length)
          .map((pt, i) => `### 3.${i + 1}. ${pt.titre}\n\n${liste(resumePoint(pt, 8))}`)
          .join("\n\n") || "_Aucun échange enregistré._"}`,
        `## 4. Décisions et résolutions\n\n${decisions}`,
        `## 5. Questions diverses et points en suspens\n\n${suspens}`,
        `## 6. Clôture\n\nFin de l'enregistrement après ${a.dureeMs ? duree(a.dureeMs) : "une durée non déterminée"}.\n\n| Le/La Président(e) de séance | Le/La Secrétaire de séance |\n|---|---|\n| ${m.organiser || " "} | |`,
      ].join("\n\n"),

    compte_rendu: () =>
      [
        titre,
        entete(m, a, [["Rédacteur", "À préciser"]]),
        `**Participants** : ${m.participants.length ? m.participants.map((p) => p.name).join(", ") : a.intervenants.map((i) => i.nom).join(", ") || "à préciser"}`,
        `## 1. Objectifs de la réunion\n\n${agenda.length ? liste(agenda) : `Thèmes principaux abordés : ${a.themes.join(", ") || "à préciser"}.`}`,
        `## 2. Synthèse des échanges\n\n${a.points
          .filter((pt) => pt.phrases.length)
          .map((pt) => {
            const dec = a.decisions.filter((d) => pt.phrases.includes(d));
            const sus = a.suspens.filter((d) => pt.phrases.includes(d));
            return [
              `### ${pt.titre}`,
              `**Principaux échanges**\n\n${liste(resumePoint(pt, 6))}`,
              dec.length ? `**Points d'accord / décisions**\n\n${liste(dec.map(cite))}` : "",
              sus.length ? `**En suspens**\n\n${liste(sus.map(cite))}` : "",
            ]
              .filter(Boolean)
              .join("\n\n");
          })
          .join("\n\n") || "_Aucun échange enregistré._"}`,
        `## 3. Décisions prises\n\n${decisions}`,
        `## 4. Plan d'actions\n\n${tableauActions(a, "cr")}`,
        `## 5. Prochaine réunion\n\n${a.prochaineReunion ? cite(a.prochaineReunion) : "À préciser."}`,
        a.intervenants.length
          ? `## Annexe — Temps de parole\n\n| Intervenant | Temps | Interventions |\n|---|---|---|\n${a.intervenants
              .map((i) => `| ${cellule(i.nom)} | ${duree(i.tempsMs)} | ${i.interventions} |`)
              .join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),

    note_synthese: () => {
      const essentiel = dedoublonner(
        [...a.decisions, ...a.risques, ...a.pointsCles].sort((x, y) => y.score - x.score),
        (p) => p.text,
      )
        .slice(0, 5)
        .sort((x, y) => x.t - y.t);
      return [
        titre,
        `| | |\n|---|---|\n| **DESTINATAIRE** | À préciser |\n| **OBJET** | ${cellule(m.title || "À préciser")} |\n| **DATE** | ${formatDate(m.date, m.timeZone)} |\n| **CLASSIFICATION** | ${CLASSIFICATION_LABELS[m.classification]} |`,
        `## L'essentiel\n\n${liste(essentiel.map(cite))}`,
        `## Contexte\n\nRéunion de ${a.dureeMs ? duree(a.dureeMs) : "durée non déterminée"}${m.location ? ` (${m.location})` : ""}, ${m.participants.length || a.intervenants.length} participant(s). Thèmes dominants : ${a.themes.join(", ") || "à préciser"}.`,
        `## Analyse — risques et points de vigilance\n\n${risques}`,
        `## Décisions prises\n\n${decisions}`,
        `## Arbitrages attendus\n\n${suspens}`,
        `## Prochaines étapes\n\n${liste(a.actions.map((x) => `${couper(x.phrase.text)} ${ts(x.phrase)} — **${x.responsable}**, échéance : ${x.echeance}`))}`,
      ].join("\n\n");
    },

    tbm: () =>
      [
        titre,
        entete(m, a, [
          ["Thème", m.title || "À préciser"],
          ["Animateur", m.organiser || "À préciser"],
          ["Nombre de participants", String(m.participants.filter((p) => p.presence !== "absent" && p.presence !== "excuse").length || a.intervenants.length || "À préciser")],
        ]),
        `## 1. Objectif du TBM\n\n${agenda.length ? liste(agenda) : "À préciser."}`,
        `## 2. Contexte\n\n${liste(a.pointsCles.slice(0, 4).map(cite))}`,
        `## 3. Risques et menaces identifiés\n\n${
          a.risques.length
            ? `| Risque / menace | Situation concernée | Niveau | Mesures de prévention / protection |\n|---|---|---|---|\n${a.risques
                .map((r) => `| ${cellule(extraitOriginal(r.text, RE_RISQUE) ?? "Risque")} | ${cellule(r.text)} ${ts(r)} | ${niveau(r)} | ${mesureAssociee(a, r)} |`)
                .join("\n")}`
            : "_Aucun risque détecté dans les échanges — à compléter._"
        }`,
        `## 4. Consignes et règles clés rappelées\n\n${liste(a.consignes.map(cite))}`,
        `## 5. Retours d'expérience, incidents ou presque-accidents\n\n${liste(a.retours.map(cite), "_Aucun retour d'expérience détecté._")}`,
        `## 6. Questions et réponses\n\n${liste(
          a.questions.map((q) => `${cite(q.question)}${q.reponse ? `\n  - Réponse : ${cite(q.reponse)}` : "\n  - Réponse : à préciser"}`),
          "_Aucune question détectée._",
        )}`,
        `## 7. Engagements et actions\n\n${tableauActions(a, "tbm")}`,
        `## 8. Émargement\n\n${emargement(m, a, true)}`,
      ].join("\n\n"),

    releve_decisions: () =>
      [
        titre,
        entete(m, a),
        `**Participants** : ${m.participants.length ? m.participants.map((p) => p.name).join(", ") : a.intervenants.map((i) => i.nom).join(", ") || "à préciser"}`,
        `## 1. Décisions\n\n${
          a.decisions.length
            ? `| N° | Décision | Point de l'ordre du jour | Porteur |\n|---|---|---|---|\n${a.decisions
                .map((d, i) => `| ${i + 1} | ${cellule(d.text)} ${ts(d)} | ${cellule(a.points[d.point]?.titre ?? "—")} | ${cellule(d.kind === "speech" ? d.speaker : "À préciser")} |`)
                .join("\n")}`
            : "_Aucune décision détectée — à préciser._"
        }`,
        `## 2. Actions\n\n${tableauActions(a, "rd")}`,
        `## 3. Points en suspens nécessitant un arbitrage\n\n${suspens}`,
      ].join("\n\n"),
  };

  return `${corps[req.type]()}${consignesRedacteur}${piecesJointes(a)}${pied(m)}`;
}

// ------------------------------------------------------------------ Questions sans IA

/** Réponse à une question par recherche dans la réunion (aucune IA). */
export function repondreSansIA(req: Pick<AskRequest, "meeting" | "transcript" | "notes" | "attachments" | "question">): string {
  const a = analyser(req);
  const q = normaliser(req.question);
  const titreListe = (t: string, items: string[], vide: string) => (items.length ? `**${t}**\n\n${liste(items)}` : vide);

  if (/\b(e-?mail|courriel|message de suivi|mail)\b/.test(q)) {
    return [
      `**Objet : Suivi — ${req.meeting.title || "réunion"} du ${formatDate(req.meeting.date, req.meeting.timeZone)}**`,
      "Bonjour à toutes et à tous,",
      "Merci pour votre participation. Voici les principaux éléments à retenir :",
      `**Décisions**\n\n${liste(a.decisions.map((d) => couper(d.text)))}`,
      `**Actions**\n\n${liste(a.actions.map((x) => `${couper(x.phrase.text)} — ${x.responsable} (échéance : ${x.echeance})`))}`,
      a.suspens.length ? `**Points restant à arbitrer**\n\n${liste(a.suspens.map((s) => couper(s.text)))}` : "",
      "Bien cordialement,",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (/\bdecision|decide|valide|arbitre[^r]/.test(q) && !/suspens|arbitrer|arbitrage/.test(q)) {
    return titreListe("Décisions repérées", a.decisions.map(cite), "Aucune décision explicite n'a été repérée dans la réunion.");
  }
  if (/\b(action|responsable|echeance|qui fait|a faire|taches?)\b/.test(q)) {
    return a.actions.length
      ? `**Actions repérées**\n\n${tableauActions(a, "rd")}`
      : "Aucune action explicite n'a été repérée dans la réunion.";
  }
  if (/\b(risque|menace|securit|surete|danger|vigilance|incident)/.test(q)) {
    return titreListe("Risques et menaces évoqués", a.risques.map(cite), "Aucun risque ou menace n'a été évoqué explicitement.");
  }
  if (/\b(suspens|arbitr|ouvert|en attente|desaccord)/.test(q)) {
    return titreListe("Points en suspens", a.suspens.map(cite), "Aucun point en suspens n'a été repéré.");
  }
  if (/\b(position|chaque intervenant|qui a dit|intervenants?|temps de parole)\b/.test(q)) {
    return a.intervenants
      .map((i) => {
        const siennes = dedoublonner(
          a.phrases.filter((p) => p.speaker === i.nom && p.kind === "speech").sort((x, y) => y.score - x.score),
          (p) => p.text,
        )
          .slice(0, 3)
          .sort((x, y) => x.t - y.t);
        return `**${i.nom}** (${duree(i.tempsMs)} de parole, ${i.interventions} interventions)\n\n${liste(siennes.map((p) => `${ts(p)} ${couper(p.text)}`))}`;
      })
      .join("\n\n") || "Aucun intervenant identifié.";
  }
  if (/\b(resum|synthes|essentiel|retenir|points? cles?)/.test(q)) {
    return `**Points clés** (thèmes : ${a.themes.join(", ") || "—"})\n\n${liste(a.pointsCles.map(cite))}`;
  }

  // Recherche plein texte : passages contenant le plus de termes de la question.
  const termes = new Set(mots(req.question).map(racine));
  if (!termes.size) return "Précisez votre question avec quelques mots-clés (lieu, personne, sujet…).";
  const trouves = a.phrases
    .map((p) => {
      const r = new Set(mots(p.text).map(racine));
      let n = 0;
      termes.forEach((x) => r.has(x) && n++);
      return { p, n };
    })
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n || y.p.score - x.p.score)
    .slice(0, 6)
    .sort((x, y) => x.p.t - y.p.t);
  const docs = a.piecesJointes.flatMap((d) =>
    d.extraits.filter((e) => mots(e).some((w) => termes.has(racine(w)))).map((e) => `« ${e} » (${d.nom})`),
  );
  if (!trouves.length && !docs.length) return "Ce point ne semble pas avoir été abordé : aucun passage de la réunion ne correspond à ces termes.";
  return [
    trouves.length ? `**Passages correspondants**\n\n${liste(trouves.map((x) => cite(x.p)))}` : "",
    docs.length ? `**Dans les documents joints**\n\n${liste(docs)}` : "",
    "_Réponse obtenue par recherche dans la réunion (mode autonome, sans IA)._",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Version condensée de la réunion (fiche d'analyse) pour une IA locale à mémoire réduite. */
export function ficheAnalyse(req: GenerateRequest): string {
  const a = analyser(req);
  const bloc = (t: string, items: string[]) => (items.length ? `${t} :\n${items.map((x) => `- ${x}`).join("\n")}` : `${t} : aucun`);
  const ligne = (p: Phrase) => `[${formatTimestamp(p.t)}] ${p.kind === "speech" ? p.speaker : "Note"} : ${couper(p.text, 240)}`;
  return [
    `Thèmes dominants : ${a.themes.join(", ") || "—"}`,
    ...a.points
      .filter((pt) => pt.phrases.length)
      .map((pt) =>
        bloc(
          `Point « ${pt.titre} »`,
          dedoublonner([...pt.phrases].sort((x, y) => y.score - x.score), (p) => p.text)
            .slice(0, 8)
            .sort((x, y) => x.t - y.t)
            .map(ligne),
        ),
      ),
    bloc("Décisions", a.decisions.map(ligne)),
    bloc("Actions", a.actions.map((x) => `${ligne(x.phrase)} (responsable : ${x.responsable} ; échéance : ${x.echeance})`)),
    bloc("Risques et menaces", a.risques.map(ligne)),
    bloc("Points en suspens", a.suspens.map(ligne)),
    bloc("Consignes", a.consignes.slice(0, 8).map(ligne)),
    bloc("Retours d'expérience", a.retours.map(ligne)),
  ].join("\n\n");
}
