import { describe, expect, it } from "vitest";
import { analyser, normaliser, redigerSansIA, repondreSansIA } from "../shared/extraction.ts";
import type { GenerateRequest, TranscriptSegment } from "../shared/types.ts";

const t = (start: number, speakerId: string, text: string, kind?: TranscriptSegment["kind"]): TranscriptSegment => ({
  id: `s${start}`,
  start: start * 1000,
  end: start * 1000 + 8000,
  speakerId,
  text,
  kind,
});

const req: GenerateRequest = {
  type: "compte_rendu",
  meeting: {
    title: "Point sûreté Sahel",
    date: "2026-09-24T08:00:00.000Z",
    location: "Abidjan",
    organiser: "Awa Koné",
    agenda: ["Situation sécuritaire à Bamako", "Convois logistiques"],
    participants: [
      { id: "p1", name: "Awa Koné", role: "Directrice sûreté", presence: "present" },
      { id: "p2", name: "Marc Dupont", role: "Responsable logistique", presence: "distanciel" },
    ],
    classification: "diffusion_restreinte",
  },
  transcript: [
    t(0, "p1", "Bonjour à tous, on commence par la situation sécuritaire à Bamako."),
    t(10, "p1", "Le niveau de menace reste élevé à Bamako avec un risque d'enlèvement accru pour les expatriés."),
    t(20, "p2", "Oui."),
    t(30, "p2", "Il y a eu un braquage la semaine dernière sur la route de l'aéroport de Bamako."),
    t(40, "p1", "On a décidé de suspendre les déplacements de nuit à Bamako jusqu'à nouvel ordre."),
    t(50, "", "Déplacements de nuit suspendus", "bookmark"),
    t(60, "p2", "Pour les convois logistiques, je vais mettre à jour le plan de convoi d'ici vendredi."),
    t(70, "p1", "Il faut renforcer l'escorte des convois logistiques, c'est urgent."),
    t(80, "p2", "Est-ce qu'on maintient le convoi vers Gao ?"),
    t(90, "p1", "Ce point reste à arbitrer par la direction, on en reparlera à la prochaine réunion."),
  ],
  notes: "Vérifier l'assurance rapatriement.",
};

describe("normaliser", () => {
  it("retire accents et majuscules en gardant la longueur", () => {
    const s = "Sûreté À Évaluer";
    expect(normaliser(s)).toBe("surete a evaluer");
    expect(normaliser(s)).toHaveLength(s.length);
  });
});

describe("analyse autonome", () => {
  const a = analyser(req);
  it("repère décisions, actions, risques et points en suspens", () => {
    expect(a.decisions.map((d) => d.text).join(" ")).toContain("suspendre les déplacements de nuit");
    const plan = a.actions.find((x) => x.phrase.text.includes("plan de convoi"));
    expect(plan?.responsable).toBe("Marc Dupont");
    expect(plan?.echeance).toBe("d'ici vendredi");
    expect(a.actions.find((x) => x.phrase.text.includes("escorte"))?.priorite).toBe("Haute");
    expect(a.risques.some((r) => r.text.includes("enlèvement"))).toBe(true);
    expect(a.suspens.some((s) => s.text.includes("arbitrer"))).toBe(true);
    expect(a.questions[0].reponse?.text).toContain("arbitrer");
  });
  it("rattache les propos à l'ordre du jour", () => {
    expect(a.points[0].phrases.some((p) => p.text.includes("braquage"))).toBe(true);
    expect(a.points[1].phrases.some((p) => p.text.includes("plan de convoi"))).toBe(true);
  });
  it("écarte les propos de remplissage des points clés", () => {
    expect(a.pointsCles.some((p) => p.text === "Oui.")).toBe(false);
  });
});

describe("rédaction autonome", () => {
  it("produit chacun des cinq documents en français, horodaté", () => {
    for (const type of ["pv", "compte_rendu", "note_synthese", "tbm", "releve_decisions"] as const) {
      const doc = redigerSansIA({ ...req, type });
      expect(doc).toContain("Diffusion restreinte");
      expect(doc).toContain("[00:40]");
      expect(doc).toContain("sans IA générative");
    }
    const rd = redigerSansIA({ ...req, type: "releve_decisions" });
    expect(rd).toMatch(/\| 1 \| .*suspendre les déplacements de nuit.* \| Situation sécuritaire à Bamako \| Awa Koné \|/);
    const tbm = redigerSansIA({ ...req, type: "tbm" });
    expect(tbm).toContain("| Élevé |");
    expect(tbm).toContain("| Signature |");
  });
  it("fonctionne sans transcription, à partir des pièces jointes", () => {
    const doc = redigerSansIA({
      ...req,
      type: "note_synthese",
      transcript: [],
      notes: "",
      attachments: [{ id: "a", name: "rapport.txt", size: 1, kind: "text", text: "La menace terroriste progresse dans le nord du pays. Les axes routiers secondaires sont déconseillés aux convois." }],
    });
    expect(doc).toContain("### rapport.txt");
    expect(doc).toContain("La menace terroriste progresse");
  });
});

describe("questions sans IA", () => {
  it("répond aux questions types et par recherche", () => {
    expect(repondreSansIA({ ...req, question: "Quelles décisions ont été prises ?" })).toContain("suspendre les déplacements");
    expect(repondreSansIA({ ...req, question: "Liste les actions avec leur responsable" })).toContain("Marc Dupont");
    expect(repondreSansIA({ ...req, question: "Que s'est-il passé sur la route de l'aéroport ?" })).toContain("braquage");
    expect(repondreSansIA({ ...req, question: "Parle-t-on de météorologie ?" })).toContain("pas avoir été abordé");
  });
});
