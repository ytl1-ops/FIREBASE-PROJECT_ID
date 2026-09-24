import type { DocumentType } from "./types.ts";

export interface DocumentDefinition {
  type: DocumentType;
  label: string;
  short: string;
  description: string;
  /** Consignes de rédaction propres au type de document. */
  guidelines: string;
}

export const DOCUMENTS: DocumentDefinition[] = [
  {
    type: "pv",
    label: "Procès-verbal",
    short: "PV",
    description: "Trace officielle et fidèle des débats, décisions et votes.",
    guidelines: `Rédige un PROCÈS-VERBAL de réunion, document à valeur officielle.
Structure attendue :
1. En-tête : intitulé, date, heure, lieu, président(e) de séance / organisateur, secrétaire de séance (« à désigner » si inconnu), mention de classification.
2. Liste d'émargement : présents, représentés/distanciel, excusés, absents (avec fonction et organisation).
3. Ordre du jour.
4. Déroulé de la séance, point par point, au passé composé et à la troisième personne : exposé, principaux échanges attribués à leurs auteurs, positions exprimées.
5. Décisions et résolutions, numérotées, avec le résultat des votes lorsqu'il est mentionné.
6. Questions diverses.
7. Clôture (heure de fin si connue) et blocs de signature (Président(e) de séance / Secrétaire de séance).
Le ton est neutre, factuel, exhaustif sur les décisions. N'interprète pas.`,
  },
  {
    type: "compte_rendu",
    label: "Compte rendu",
    short: "CR",
    description: "Restitution structurée des échanges par point de l'ordre du jour.",
    guidelines: `Rédige un COMPTE RENDU de réunion.
Structure attendue :
1. En-tête (objet, date, lieu, participants, rédacteur, classification).
2. Objectifs de la réunion.
3. Pour chaque point de l'ordre du jour (ou thème abordé si l'ordre du jour est absent) : contexte, synthèse des échanges, points d'accord, points de désaccord ou en suspens.
4. Décisions prises.
5. Plan d'actions sous forme de tableau Markdown : N° | Action | Responsable | Échéance | Statut.
6. Prochaine réunion (date/objet si évoqués).
Style clair et synthétique, phrases courtes, attribution des propos aux intervenants lorsque c'est utile.`,
  },
  {
    type: "note_synthese",
    label: "Note de synthèse",
    short: "NS",
    description: "Note courte pour décideur : l'essentiel en une à deux pages.",
    guidelines: `Rédige une NOTE DE SYNTHÈSE à destination d'un décideur (une à deux pages maximum).
Structure attendue :
1. Bloc d'en-tête : DESTINATAIRE (« à préciser »), OBJET, DATE, CLASSIFICATION.
2. « L'essentiel » : 3 à 5 puces qui résument ce qu'il faut retenir (principe BLUF — la conclusion d'abord).
3. Contexte (bref).
4. Analyse : enjeux, risques et points de vigilance identifiés pendant la réunion, notamment en matière de sûreté/sécurité.
5. Décisions prises et arbitrages attendus du destinataire (clairement distingués).
6. Recommandations / prochaines étapes.
Style : dense, analytique, sans redite, sans verbatim.`,
  },
  {
    type: "tbm",
    label: "TBM (Tool Box Meeting)",
    short: "TBM",
    description: "Fiche de causerie sûreté/sécurité : risques, consignes, engagements.",
    guidelines: `Rédige une fiche de TBM (Tool Box Meeting / causerie sûreté-sécurité).
Structure attendue :
1. En-tête : thème du TBM, date, lieu/site, animateur, nombre de participants, classification.
2. Objectif du TBM.
3. Rappel du contexte (activité, situation sécuritaire ou opérationnelle évoquée).
4. Risques et menaces identifiés : tableau Markdown Risque/Menace | Situation concernée | Niveau (faible/modéré/élevé/critique, uniquement si exprimé ou clairement déductible, sinon « à évaluer ») | Mesures de prévention/protection.
5. Consignes et règles clés rappelées (liste courte, formulée à l'impératif).
6. Retours d'expérience, incidents ou presque-accidents partagés.
7. Questions/remarques des participants et réponses apportées.
8. Engagements et actions : tableau Action | Responsable | Échéance.
9. Liste des participants (émargement) avec colonne « Signature » vide.
Style opérationnel, concret, compréhensible par des équipes terrain.`,
  },
  {
    type: "releve_decisions",
    label: "Relevé de décisions",
    short: "RD",
    description: "Uniquement les décisions et le plan d'actions, sans les débats.",
    guidelines: `Rédige un RELEVÉ DE DÉCISIONS ET PLAN D'ACTIONS.
Structure attendue :
1. En-tête (réunion, date, participants, classification).
2. Tableau des décisions : N° | Décision | Point de l'ordre du jour | Porteur.
3. Tableau des actions : N° | Action | Responsable | Échéance | Priorité.
4. Points en suspens nécessitant un arbitrage.
Ne restitue pas les débats. Sois exhaustif sur les décisions et les actions.`,
  },
];

export function getDocument(type: DocumentType): DocumentDefinition {
  const doc = DOCUMENTS.find((d) => d.type === type);
  if (!doc) throw new Error(`Type de document inconnu : ${type}`);
  return doc;
}
