import { getDocument } from "./documents.ts";
import { formatTranscript } from "./transcript.ts";
import {
  CLASSIFICATION_LABELS,
  type AskRequest,
  type Attachment,
  type GenerateRequest,
  type MeetingInfo,
  type TranscriptSegment,
} from "./types.ts";

/** Prompt système stable (mis en cache) : ne dépend d'aucune donnée de la réunion. */
export const SYSTEM_PROMPT = `Tu es le secrétaire de séance de MonMeeting, spécialiste de la rédaction administrative et institutionnelle en français, au service de responsables sûreté, d'institutions internationales et d'organisations qui suivent des situations sécuritaires.

Ta mission : transformer la transcription d'une réunion et/ou les documents sources qui te sont joints en un document professionnel, fidèle et directement exploitable. Lorsqu'il n'y a pas de transcription, le document porte sur la synthèse des pièces jointes.

Règles de fidélité (impératives) :
- N'invente rien. Chaque fait, chiffre, nom, décision, échéance ou responsable doit provenir de la transcription, des pièces jointes, des notes du rédacteur ou des informations de la réunion. Cite la pièce jointe d'origine quand c'est utile (« selon le rapport X »).
- Si une information attendue par la structure du document manque, écris « à préciser » plutôt que de la supposer.
- Si un passage de la transcription est ambigu, incohérent ou manifestement mal reconnu par la dictée automatique, restitue le sens le plus probable et signale-le par « [à vérifier – mm:ss] » avec l'horodatage de la source.
- Distingue clairement ce qui a été DÉCIDÉ de ce qui a seulement été PROPOSÉ ou DISCUTÉ.
- Attribue les propos aux bons intervenants ; si l'intervenant n'est pas identifié, ne lui prête pas d'identité.
- Les notes du rédacteur (✎) et les marque-pages (★) signalent des moments importants : accorde-leur une attention particulière.
- Respecte la mention de classification fournie et reporte-la en tête et en pied du document.

Règles de forme :
- Rédige toujours en français, dans un registre soutenu et neutre, quelle que soit la langue de la transcription (traduis si nécessaire).
- Produis uniquement le document, en Markdown (titres #, listes, tableaux), sans préambule ni commentaire sur ta démarche.
- Dates au format « mardi 24 septembre 2026 », heures au format « 14 h 30 ».
- Termine par une ligne « Document établi avec l'assistance de MonMeeting à partir de l'enregistrement de la réunion — à relire et valider avant diffusion. »`;

export function formatDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions = { dateStyle: "full", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat("fr-FR", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("fr-FR", options).format(date);
  }
}

export const PRESENCE_LABELS = {
  present: "présent(e)",
  absent: "absent(e)",
  excuse: "excusé(e)",
  distanciel: "à distance",
} as const;

/** Bloc de contexte commun : informations de la réunion, transcription et notes. */
function attachmentsContext(attachments: Attachment[] | undefined): string[] {
  if (!attachments?.length) return [];
  const sections: string[] = [];
  const pdfs = attachments.filter((a) => a.kind === "pdf");
  if (pdfs.length) {
    sections.push(
      `<pieces_jointes_pdf>\nDocuments PDF fournis avec ce message : ${pdfs.map((p) => `« ${p.name} »`).join(", ")}.\n</pieces_jointes_pdf>`,
    );
  }
  for (const a of attachments.filter((x) => x.kind === "text")) {
    sections.push(`<piece_jointe nom="${a.name.replace(/"/g, "'")}">\n${a.text ?? ""}\n</piece_jointe>`);
  }
  return sections;
}

function meetingContext(
  meeting: MeetingInfo,
  transcript: TranscriptSegment[],
  notes: string | undefined,
  attachments?: Attachment[],
): string[] {
  const participants = meeting.participants.length
    ? meeting.participants
        .map((p) => {
          const details = [p.role, p.organisation].filter(Boolean).join(", ");
          return `- ${p.name}${details ? ` (${details})` : ""} — ${PRESENCE_LABELS[p.presence]}`;
        })
        .join("\n")
    : "- non renseignés";

  const agendaItems = meeting.agenda.filter((a) => a.trim());
  const agenda = agendaItems.length
    ? agendaItems.map((a, i) => `${i + 1}. ${a}`).join("\n")
    : "non renseigné";

  const sections = [
    `<reunion>
Intitulé : ${meeting.title || "à préciser"}
Date : ${formatDate(meeting.date, meeting.timeZone)}
Lieu : ${meeting.location || "à préciser"}
Organisateur / président(e) de séance : ${meeting.organiser || "à préciser"}
Classification : ${CLASSIFICATION_LABELS[meeting.classification]}

Participants :
${participants}

Ordre du jour :
${agenda}
</reunion>`,
    `<transcription>\n${formatTranscript(transcript, meeting.participants) || "(vide)"}\n</transcription>`,
  ];
  if (notes?.trim()) {
    sections.push(`<notes_du_redacteur>\n${notes.trim()}\n</notes_du_redacteur>`);
  }
  sections.push(...attachmentsContext(attachments));
  return sections;
}

export function buildUserPrompt(req: GenerateRequest): string {
  const doc = getDocument(req.type);
  const sections = [
    `<consignes_document>\n${doc.guidelines}\n</consignes_document>`,
    ...meetingContext(req.meeting, req.transcript, req.notes, req.attachments),
  ];
  if (req.instructions?.trim()) {
    sections.push(
      `<instructions_complementaires>\n${req.instructions.trim()}\n</instructions_complementaires>`,
    );
  }
  sections.push(`Rédige maintenant le document « ${doc.label} ».`);
  return sections.join("\n\n");
}

export const ASK_SYSTEM_PROMPT = `Tu es l'assistant de MonMeeting. Tu réponds aux questions d'un utilisateur sur UNE réunion dont la transcription et les éventuelles pièces jointes te sont fournies, dans le contexte de la sûreté et de la sécurité.

- Réponds en français, de façon concise et précise.
- Appuie chaque affirmation sur la transcription en citant l'horodatage entre crochets, par exemple [12:34], et l'intervenant.
- Si la réponse ne figure pas dans la réunion, dis-le clairement (« Ce point n'a pas été abordé ») au lieu de supposer.
- Tu peux produire des listes, tableaux Markdown, e-mails de suivi ou extraits reformulés si l'utilisateur le demande.`;

/** Le contexte de réunion est placé dans le premier message utilisateur (préfixe stable, mis en cache). */
export function buildAskContext(req: AskRequest): string {
  return [
    "Voici la réunion (et ses pièces jointes) sur laquelle porteront mes questions.",
    ...meetingContext(req.meeting, req.transcript, req.notes, req.attachments),
  ].join("\n\n");
}

function pdfReminder(attachments: Attachment[] | undefined): string {
  const pdfs = (attachments ?? []).filter((a) => a.kind === "pdf");
  return pdfs.length
    ? `\n\n(Joignez aussi à ce message les fichiers PDF : ${pdfs.map((p) => p.name).join(", ")}.)`
    : "";
}

/** Demande complète à coller dans Claude.ai (mode gratuit, sans clé API). */
export function buildManualPrompt(req: GenerateRequest): string {
  return `${SYSTEM_PROMPT}\n\n---\n\n${buildUserPrompt(req)}${pdfReminder(req.attachments)}`;
}

/** Réunion + consignes à coller dans Claude.ai pour poser ses questions (mode gratuit). */
export function buildAskManualPrompt(req: Omit<AskRequest, "history" | "question">): string {
  return `${ASK_SYSTEM_PROMPT}\n\n---\n\n${buildAskContext({ ...req, history: [], question: "" })}\n\nConfirme en une phrase que tu as bien reçu la réunion, puis attends mes questions.${pdfReminder(req.attachments)}`;
}
