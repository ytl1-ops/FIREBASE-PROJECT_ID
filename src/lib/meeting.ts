import type { MeetingInfo, Participant } from "../../shared/types.ts";
import { newId } from "./db.ts";

/** Date locale au format attendu par <input type="datetime-local">. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultMeetingInfo(): MeetingInfo {
  return {
    title: "",
    date: new Date().toISOString(),
    location: "",
    organiser: "",
    agenda: [],
    participants: [],
    classification: "diffusion_restreinte",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function newParticipant(name = ""): Participant {
  return { id: newId("p-"), name, presence: "present" };
}

/** `whisper` : nom de langue attendu par Whisper pour la transcription locale. */
export const LANGUAGES: { code: string; label: string; speech: string; whisper: string }[] = [
  { code: "fr", whisper: "french", label: "Français", speech: "fr-FR" },
  { code: "en", whisper: "english", label: "Anglais", speech: "en-GB" },
  { code: "ar", whisper: "arabic", label: "Arabe", speech: "ar-SA" },
  { code: "es", whisper: "spanish", label: "Espagnol", speech: "es-ES" },
  { code: "pt", whisper: "portuguese", label: "Portugais", speech: "pt-PT" },
  { code: "de", whisper: "german", label: "Allemand", speech: "de-DE" },
  { code: "it", whisper: "italian", label: "Italien", speech: "it-IT" },
  { code: "ru", whisper: "russian", label: "Russe", speech: "ru-RU" },
  { code: "uk", whisper: "ukrainian", label: "Ukrainien", speech: "uk-UA" },
  { code: "zh", whisper: "chinese", label: "Chinois", speech: "zh-CN" },
];
