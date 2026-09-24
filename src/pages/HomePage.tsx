import { useEffect, useRef, useState } from "react";
import { DOCUMENTS } from "../../shared/documents.ts";
import { formatTimestamp } from "../../shared/transcript.ts";
import { CLASSIFICATION_LABELS } from "../../shared/types.ts";
import { navigate } from "../App.tsx";
import { appendAudioChunk, createMeeting, listMeetings, saveMeeting, type Meeting } from "../lib/db.ts";
import { ACCEPTED_FILES, readAttachment } from "../lib/attachments.ts";
import { defaultMeetingInfo } from "../lib/meeting.ts";
import { importMeetingPackage, PasswordRequiredError } from "../lib/share.ts";

function audioDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    };
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}

export function HomePage() {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const packageInput = useRef<HTMLInputElement>(null);
  const docsInput = useRef<HTMLInputElement>(null);

  /** Synthèse documentaire : nouvelle « réunion » sans enregistrement, alimentée par des fichiers. */
  async function synthesizeFiles(files: FileList) {
    setError(null);
    try {
      const attachments = await Promise.all(Array.from(files).map(readAttachment));
      const info = defaultMeetingInfo();
      info.title =
        attachments.length === 1
          ? `Synthèse — ${attachments[0].name.replace(/\.[^.]+$/, "")}`
          : `Synthèse de ${attachments.length} documents`;
      const meeting = createMeeting(info);
      meeting.attachments = attachments;
      await saveMeeting(meeting);
      navigate(`/reunion/${meeting.id}?onglet=documents`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  const [error, setError] = useState<string | null>(null);

  async function importPackage(file: File) {
    setError(null);
    try {
      let meeting;
      try {
        meeting = await importMeetingPackage(file);
      } catch (err) {
        if (!(err instanceof PasswordRequiredError)) throw err;
        const password = window.prompt("Ce fichier est chiffré. Mot de passe :");
        if (!password) return;
        meeting = await importMeetingPackage(file, password);
      }
      navigate(`/reunion/${meeting.id}?onglet=transcription`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void listMeetings().then(setMeetings);
  }, []);

  async function importAudio(file: File) {
    const info = defaultMeetingInfo();
    info.title = file.name.replace(/\.[^.]+$/, "");
    info.date = new Date(file.lastModified || Date.now()).toISOString();
    const meeting = createMeeting(info);
    meeting.audioMime = file.type || "audio/mpeg";
    meeting.audioChunks = 1;
    meeting.durationMs = await audioDuration(file);
    await appendAudioChunk(meeting.id, 0, file);
    await saveMeeting(meeting);
    navigate(`/reunion/${meeting.id}?onglet=transcription`);
  }

  const q = query.trim().toLowerCase();
  const filtered = (meetings ?? []).filter(
    (m) =>
      !q ||
      m.info.title.toLowerCase().includes(q) ||
      m.transcript.some((s) => s.text.toLowerCase().includes(q)) ||
      m.info.participants.some((p) => p.name.toLowerCase().includes(q)),
  );

  return (
    <>
      <div className="card">
        <div className="row between">
          <div>
            <h1>Mes réunions</h1>
            <p className="muted small" style={{ margin: 0 }}>
              Enregistrez (audio ou vidéo), transcrivez avec identification des intervenants,
              ajoutez vos documents, puis générez PV, comptes rendus, notes de synthèse et TBM.
            </p>
          </div>
          <div className="row">
            <button onClick={() => docsInput.current?.click()}>✦ Synthétiser des fichiers</button>
            <input
              ref={docsInput}
              type="file"
              multiple
              accept={ACCEPTED_FILES}
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void synthesizeFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button onClick={() => packageInput.current?.click()}>⤒ Importer une réunion</button>
            <button onClick={() => fileInput.current?.click()}>⤒ Importer un audio / une vidéo</button>
            <input
              ref={packageInput}
              type="file"
              accept=".monmeeting,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importPackage(file);
                e.target.value = "";
              }}
            />
            <button className="primary" onClick={() => navigate("/nouvelle")}>
              ● Nouvelle réunion
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,video/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importAudio(file);
              }}
            />
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <input
          type="search"
          placeholder="Rechercher un titre, un participant, un mot prononcé…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        {meetings === null ? (
          <p className="muted">Chargement…</p>
        ) : filtered.length === 0 ? (
          <p className="muted">
            {meetings.length === 0
              ? "Aucune réunion pour l'instant. Lancez un premier enregistrement."
              : "Aucun résultat."}
          </p>
        ) : (
          <ul className="meeting-list">
            {filtered.map((m) => {
              const docs = DOCUMENTS.filter((d) => m.documents[d.type]?.content.trim());
              return (
                <li key={m.id}>
                  <a href={`#/reunion/${m.id}`}>
                    <div className="grow">
                      <div className="title">{m.info.title || "Réunion sans titre"}</div>
                      <div className="muted small">
                        {new Date(m.info.date).toLocaleString("fr-FR", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {m.durationMs ? ` · ${formatTimestamp(m.durationMs)}` : ""}
                        {m.info.participants.length
                          ? ` · ${m.info.participants.length} participant(s)`
                          : ""}
                      </div>
                    </div>
                    {docs.map((d) => (
                      <span key={d.type} className="badge green" title={d.label}>
                        {d.short}
                      </span>
                    ))}
                    {m.info.classification !== "non_protege" && (
                      <span className="badge red">{CLASSIFICATION_LABELS[m.info.classification]}</span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="muted small">
        🔒 Les enregistrements et transcriptions sont conservés uniquement dans ce navigateur.
        Seules les données nécessaires à la transcription et à la rédaction sont transmises au
        serveur au moment où vous les demandez.
      </p>
    </>
  );
}
