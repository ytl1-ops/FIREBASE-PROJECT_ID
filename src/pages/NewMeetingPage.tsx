import { useState } from "react";
import { navigate } from "../App.tsx";
import { MeetingInfoForm } from "../components/MeetingInfoForm.tsx";
import { createMeeting, saveMeeting } from "../lib/db.ts";
import { defaultMeetingInfo } from "../lib/meeting.ts";

export function NewMeetingPage() {
  const [info, setInfo] = useState(defaultMeetingInfo);

  async function create(tab: string) {
    const meeting = createMeeting({
      ...info,
      title: info.title.trim() || "Réunion sans titre",
      participants: info.participants.filter((p) => p.name.trim()),
      agenda: info.agenda.filter((a) => a.trim()),
    });
    await saveMeeting(meeting);
    navigate(`/reunion/${meeting.id}?onglet=${tab}`);
  }

  return (
    <div className="card">
      <h1>Nouvelle réunion</h1>
      <p className="muted small">
        Tous les champs sont facultatifs, mais renseigner les participants et l'ordre du jour
        améliore nettement l'identification des intervenants et la qualité des documents.
      </p>
      <MeetingInfoForm info={info} onChange={setInfo} />
      <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
        <button onClick={() => navigate("/")}>Annuler</button>
        <button onClick={() => void create("transcription")}>Créer sans enregistrer</button>
        <button className="primary" onClick={() => void create("enregistrement")}>
          ● Créer et enregistrer
        </button>
      </div>
    </div>
  );
}
