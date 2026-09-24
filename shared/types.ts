// Types partagés entre l'interface et le serveur.

export type Classification =
  | "non_protege"
  | "diffusion_restreinte"
  | "confidentiel"
  | "secret";

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  non_protege: "Non protégé",
  diffusion_restreinte: "Diffusion restreinte",
  confidentiel: "Confidentiel",
  secret: "Secret",
};

export interface Participant {
  id: string;
  name: string;
  role?: string;
  organisation?: string;
  presence: "present" | "absent" | "excuse" | "distanciel";
}

export interface TranscriptSegment {
  id: string;
  /** Millisecondes depuis le début de l'enregistrement. */
  start: number;
  end?: number;
  speakerId?: string;
  text: string;
  /** Segment ajouté manuellement (note, marque-page) plutôt que dicté. */
  kind?: "speech" | "note" | "bookmark";
}

export interface MeetingInfo {
  title: string;
  date: string; // ISO
  location?: string;
  organiser?: string;
  agenda: string[];
  participants: Participant[];
  classification: Classification;
  /** Fuseau horaire IANA de la réunion (ex. « Africa/Abidjan »). */
  timeZone?: string;
}

export type DocumentType =
  | "pv"
  | "compte_rendu"
  | "note_synthese"
  | "tbm"
  | "releve_decisions";

/** Fichier source joint à la réunion (compte rendu précédent, note, rapport…) à synthétiser. */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  kind: "text" | "pdf";
  /** Texte extrait (Word, texte, Markdown). */
  text?: string;
  /** Contenu PDF en base64 (lu directement par le modèle, mise en page comprise). */
  data?: string;
}

export interface GenerateRequest {
  type: DocumentType;
  meeting: MeetingInfo;
  transcript: TranscriptSegment[];
  notes?: string;
  attachments?: Attachment[];
  instructions?: string;
}

export interface AskMessage {
  role: "user" | "assistant";
  content: string;
}

/** Question posée à la réunion (« Demandez à votre réunion »). */
export interface AskRequest {
  meeting: MeetingInfo;
  transcript: TranscriptSegment[];
  notes?: string;
  attachments?: Attachment[];
  history: AskMessage[];
  question: string;
}

/** Réponse du service de transcription haute fidélité (diarisation incluse). */
export interface TranscriptionResponse {
  segments: { start: number; end: number; speaker: string; text: string }[];
  languages: string[];
}
