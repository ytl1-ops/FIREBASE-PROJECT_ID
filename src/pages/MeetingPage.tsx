import { useCallback, useEffect, useRef, useState } from "react";
import { formatTimestamp } from "../../shared/transcript.ts";
import { CLASSIFICATION_LABELS } from "../../shared/types.ts";
import { navigate } from "../App.tsx";
import { AskPanel } from "../components/AskPanel.tsx";
import { DocumentsPanel } from "../components/DocumentsPanel.tsx";
import { MeetingInfoForm } from "../components/MeetingInfoForm.tsx";
import { RecorderPanel } from "../components/RecorderPanel.tsx";
import { SharePanel } from "../components/SharePanel.tsx";
import { TranscriptPanel } from "../components/TranscriptPanel.tsx";
import type { Health } from "../lib/api.ts";
import { countAudioChunks, deleteMeeting, getMeeting, saveMeeting, type Meeting } from "../lib/db.ts";
import { setRecordingActive } from "../lib/recordingGuard.ts";
import { backupMeetingToFolder, requestPersistentStorage } from "../lib/backup.ts";

const TABS = [
  { id: "enregistrement", label: "● Enregistrement" },
  { id: "transcription", label: "Transcription" },
  { id: "documents", label: "Documents" },
  { id: "questions", label: "Demander" },
  { id: "partager", label: "Partager" },
  { id: "informations", label: "Informations" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export type UpdateMeeting = (fn: (m: Meeting) => Meeting) => void;

export function MeetingPage({
  id,
  initialTab,
  health,
}: {
  id: string;
  initialTab?: string;
  health: Health | null;
}) {
  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [tab, setTab] = useState<TabId>(
    TABS.some((t) => t.id === initialTab) ? (initialTab as TabId) : "transcription",
  );
  const [recording, setRecording] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    void getMeeting(id).then(async (m) => {
      // Réparation : fragments audio présents mais compteur non enregistré (coupure en cours
      // d'enregistrement) — l'audio redevient visible.
      if (m && !m.audioChunks) {
        const count = await countAudioChunks(m.id);
        if (count) m = await saveMeeting({ ...m, audioChunks: count });
      }
      setMeeting(m ?? null);
    });
  }, [id]);

  // Sauvegarde automatique, groupée ; jamais perdue en quittant la page ou l'onglet.
  const latest = useRef<Meeting | null>(null);
  latest.current = meeting ?? null;
  useEffect(() => {
    if (!meeting || !dirty.current) return;
    const timer = window.setTimeout(() => {
      dirty.current = false;
      void saveMeeting(meeting);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [meeting]);
  // Copie automatique dans le dossier de sauvegarde (PC), 15 s après la dernière modification
  // et jamais pendant un enregistrement.
  useEffect(() => {
    if (!meeting || recording) return;
    const timer = window.setTimeout(() => void backupMeetingToFolder(meeting).catch(() => {}), 15_000);
    return () => window.clearTimeout(timer);
  }, [meeting, recording]);

  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  useEffect(() => {
    const flush = () => {
      if (dirty.current && latest.current) {
        dirty.current = false;
        void saveMeeting(latest.current);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const update: UpdateMeeting = useCallback((fn) => {
    dirty.current = true;
    setMeeting((prev) => (prev ? fn(prev) : prev));
  }, []);

  useEffect(() => {
    setRecordingActive(recording);
    if (!recording) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);

  if (meeting === undefined) return <p className="muted">Chargement…</p>;
  if (meeting === null)
    return (
      <div className="card">
        <p>Réunion introuvable.</p>
        <a href="#/">Retour à la liste</a>
      </div>
    );

  async function remove() {
    if (!meeting) return;
    if (!window.confirm("Supprimer définitivement cette réunion, son audio et ses documents ?")) return;
    await deleteMeeting(meeting.id);
    navigate("/");
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{meeting.info.title || "Réunion sans titre"}</h1>
          <div className="muted small">
            {new Date(meeting.info.date).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}
            {meeting.durationMs ? ` · ${formatTimestamp(meeting.durationMs)} d'enregistrement` : ""}
            {" · "}
            <span className={meeting.info.classification === "non_protege" ? "badge" : "badge red"}>
              {CLASSIFICATION_LABELS[meeting.info.classification]}
            </span>
          </div>
        </div>
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.id === "enregistrement" && recording ? (
              <>
                <span className="rec-dot" />
                En cours
              </>
            ) : (
              t.label
            )}
          </button>
        ))}
      </nav>

      {/* L'enregistreur reste monté pour ne pas interrompre la capture en changeant d'onglet. */}
      <div hidden={tab !== "enregistrement"}>
        <RecorderPanel
          meeting={meeting}
          update={update}
          onRecordingChange={setRecording}
          onFinished={() => setTab("transcription")}
        />
      </div>
      {tab === "transcription" && (
        <TranscriptPanel meeting={meeting} update={update} health={health} recording={recording} />
      )}
      {tab === "documents" && <DocumentsPanel meeting={meeting} update={update} health={health} />}
      {tab === "questions" && <AskPanel meeting={meeting} health={health} />}
      {tab === "partager" && <SharePanel meeting={meeting} />}
      {tab === "informations" && (
        <div className="card">
          <MeetingInfoForm info={meeting.info} onChange={(info) => update((m) => ({ ...m, info }))} />
          <hr style={{ margin: "20px 0", border: "none", borderTop: "1px solid var(--border)" }} />
          <button className="danger" disabled={recording} onClick={() => void remove()}>
            Supprimer la réunion
          </button>
        </div>
      )}
    </>
  );
}
