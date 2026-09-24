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

export const LANGUAGES: { code: string; label: string; speech: string }[] = [
  { code: "fr", label: "Français", speech: "fr-FR" },
  { code: "en", label: "Anglais", speech: "en-GB" },
  { code: "ar", label: "Arabe", speech: "ar-SA" },
  { code: "es", label: "Espagnol", speech: "es-ES" },
  { code: "pt", label: "Portugais", speech: "pt-PT" },
  { code: "de", label: "Allemand", speech: "de-DE" },
  { code: "it", label: "Italien", speech: "it-IT" },
  { code: "ru", label: "Russe", speech: "ru-RU" },
  { code: "uk", label: "Ukrainien", speech: "uk-UA" },
  { code: "zh", label: "Chinois", speech: "zh-CN" },
];
