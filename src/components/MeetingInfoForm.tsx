import { CLASSIFICATION_LABELS, type Classification, type MeetingInfo, type Participant } from "../../shared/types.ts";
import { newParticipant, toLocalInput } from "../lib/meeting.ts";

const PRESENCES: { value: Participant["presence"]; label: string }[] = [
  { value: "present", label: "Présent(e)" },
  { value: "distanciel", label: "À distance" },
  { value: "excuse", label: "Excusé(e)" },
  { value: "absent", label: "Absent(e)" },
];

export function MeetingInfoForm({
  info,
  onChange,
}: {
  info: MeetingInfo;
  onChange: (info: MeetingInfo) => void;
}) {
  const set = <K extends keyof MeetingInfo>(key: K, value: MeetingInfo[K]) =>
    onChange({ ...info, [key]: value });

  const setParticipant = (id: string, patch: Partial<Participant>) =>
    set(
      "participants",
      info.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );

  return (
    <div className="stack">
      <div className="grid-2">
        <div>
          <label htmlFor="title">Intitulé de la réunion</label>
          <input
            id="title"
            value={info.title}
            placeholder="Comité sûreté mensuel — Sahel"
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="date">Date et heure</label>
          <input
            id="date"
            type="datetime-local"
            value={toLocalInput(info.date)}
            onChange={(e) => e.target.value && set("date", new Date(e.target.value).toISOString())}
          />
        </div>
        <div>
          <label htmlFor="location">Lieu / canal</label>
          <input
            id="location"
            value={info.location ?? ""}
            placeholder="Salle de crise, Teams…"
            onChange={(e) => set("location", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="organiser">Organisateur / président(e) de séance</label>
          <input
            id="organiser"
            value={info.organiser ?? ""}
            onChange={(e) => set("organiser", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="classification">Classification</label>
          <select
            id="classification"
            value={info.classification}
            onChange={(e) => set("classification", e.target.value as Classification)}
          >
            {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="agenda">Ordre du jour (un point par ligne)</label>
        <textarea
          id="agenda"
          rows={4}
          value={info.agenda.join("\n")}
          placeholder={"Point de situation sécuritaire\nRevue des incidents\nMesures à adopter"}
          onChange={(e) => set("agenda", e.target.value.split("\n"))}
        />
      </div>

      <div>
        <label>Participants</label>
        <table className="participants-table">
          <tbody>
            {info.participants.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    aria-label="Nom"
                    placeholder="Nom"
                    value={p.name}
                    onChange={(e) => setParticipant(p.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label="Fonction"
                    placeholder="Fonction"
                    value={p.role ?? ""}
                    onChange={(e) => setParticipant(p.id, { role: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label="Organisation"
                    placeholder="Organisation"
                    value={p.organisation ?? ""}
                    onChange={(e) => setParticipant(p.id, { organisation: e.target.value })}
                  />
                </td>
                <td style={{ width: 130 }}>
                  <select
                    aria-label="Présence"
                    value={p.presence}
                    onChange={(e) =>
                      setParticipant(p.id, { presence: e.target.value as Participant["presence"] })
                    }
                  >
                    {PRESENCES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ width: 40 }}>
                  <button
                    className="ghost danger"
                    title="Retirer"
                    onClick={() =>
                      set("participants", info.participants.filter((x) => x.id !== p.id))
                    }
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          style={{ marginTop: 6 }}
          onClick={() => set("participants", [...info.participants, newParticipant()])}
        >
          + Ajouter un participant
        </button>
      </div>
    </div>
  );
}
