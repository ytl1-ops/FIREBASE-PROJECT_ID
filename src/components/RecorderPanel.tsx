import { useEffect, useRef, useState } from "react";
import { formatTimestamp, speakerName } from "../../shared/transcript.ts";
import type { TranscriptSegment } from "../../shared/types.ts";
import { appendAudioChunk, clearAudio, newId, type Meeting } from "../lib/db.ts";
import { LANGUAGES } from "../lib/meeting.ts";
import {
  deviceErrorMessage,
  isVideoMode,
  MeetingRecorder,
  recordingSupported,
  type CaptureMode,
} from "../lib/recorder.ts";
import { LiveSpeech, liveSpeechSupported } from "../lib/speech.ts";
import type { UpdateMeeting } from "../pages/MeetingPage.tsx";

type Status = "idle" | "recording" | "paused" | "stopping";

export function RecorderPanel({
  meeting,
  update,
  onRecordingChange,
  onFinished,
}: {
  meeting: Meeting;
  update: UpdateMeeting;
  onRecordingChange: (recording: boolean) => void;
  onFinished: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<CaptureMode>("micro");
  const [lang, setLang] = useState("fr-FR");
  const [livePreview, setLivePreview] = useState(liveSpeechSupported());
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState("");
  const [speaker, setSpeaker] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justStopped, setJustStopped] = useState(false);

  const recorder = useRef<MeetingRecorder | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const live = useRef<LiveSpeech | null>(null);
  const clock = useRef({ startedAt: 0, pausedAt: 0, pausedTotal: 0 });
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;

  const active = status === "recording" || status === "paused";

  useEffect(() => onRecordingChange(active), [active, onRecordingChange]);

  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => setDevices(list.filter((d) => d.kind === "audioinput" && d.deviceId)));
  }, [status]);

  function now(): number {
    const c = clock.current;
    const pausedNow = c.pausedAt ? Date.now() - c.pausedAt : 0;
    return Date.now() - c.startedAt - c.pausedTotal - pausedNow;
  }

  useEffect(() => {
    if (status !== "recording") return;
    const timer = window.setInterval(() => setElapsed(now()), 250);
    return () => window.clearInterval(timer);
  }, [status]);

  // Arrêt propre si le composant est démonté (navigation) pendant l'enregistrement.
  useEffect(
    () => () => {
      live.current?.stop();
      void recorder.current?.stop();
    },
    [],
  );

  function addSegment(seg: Omit<TranscriptSegment, "id" | "start">) {
    const segment: TranscriptSegment = { id: newId("s-"), start: now(), ...seg };
    update((m) => ({ ...m, transcript: [...m.transcript, segment] }));
  }

  async function start() {
    setError(null);
    setJustStopped(false);
    if (meeting.audioChunks > 0) {
      const ok = window.confirm(
        "Cette réunion contient déjà un enregistrement. Le remplacer par un nouvel enregistrement ? (la transcription et les notes sont conservées)",
      );
      if (!ok) return;
      await clearAudio(meeting.id);
      update((m) => ({ ...m, audioChunks: 0, durationMs: 0 }));
    }

    const rec = new MeetingRecorder({
      onChunk: (chunk, index) => {
        void appendAudioChunk(meeting.id, index, chunk).then(() =>
          update((m) => ({
            ...m,
            audioChunks: Math.max(m.audioChunks, index + 1),
            audioMime: rec.mimeType,
          })),
        );
      },
      onLevel: setLevel,
      onError: setError,
    });

    try {
      await rec.start(mode, deviceId || undefined);
    } catch (err) {
      setError(deviceErrorMessage(err, mode));
      await rec.stop();
      return;
    }

    recorder.current = rec;
    setHasVideo(Boolean(rec.videoStream));
    if (preview.current && rec.videoStream) {
      preview.current.srcObject = rec.videoStream;
      void preview.current.play().catch(() => {});
    }
    clock.current = { startedAt: Date.now(), pausedAt: 0, pausedTotal: 0 };
    setElapsed(0);
    setStatus("recording");

    // L'aperçu en direct n'écoute que le micro : inutile pour le son d'un onglet.
    if (livePreview && liveSpeechSupported() && mode !== "onglet" && rec.micStream) {
      live.current = new LiveSpeech(lang, {
        onFinal: (text) => addSegment({ text, speakerId: speakerRef.current, kind: "speech" }),
        onInterim: setInterim,
        onError: setError,
      });
      live.current.start();
    }
  }

  function togglePause() {
    const c = clock.current;
    if (status === "recording") {
      recorder.current?.pause();
      live.current?.stop();
      c.pausedAt = Date.now();
      setStatus("paused");
      addSegment({ text: "Pause de l'enregistrement", kind: "bookmark" });
    } else if (status === "paused") {
      c.pausedTotal += Date.now() - c.pausedAt;
      c.pausedAt = 0;
      recorder.current?.resume();
      live.current?.start();
      setStatus("recording");
    }
  }

  async function stop() {
    setStatus("stopping");
    live.current?.stop();
    live.current = null;
    const duration = now();
    await recorder.current?.stop();
    recorder.current = null;
    if (preview.current) preview.current.srcObject = null;
    setHasVideo(false);
    update((m) => ({ ...m, durationMs: duration }));
    setStatus("idle");
    setLevel(0);
    setJustStopped(true);
  }

  function bookmark() {
    addSegment({ text: note.trim() || "Moment important", kind: "bookmark" });
    setNote("");
  }

  function addNote() {
    if (!note.trim()) return;
    addSegment({ text: note.trim(), kind: "note" });
    setNote("");
  }

  if (!recordingSupported()) {
    return (
      <div className="alert error">
        Ce navigateur ne permet pas l'enregistrement audio. Utilisez une version récente de Chrome,
        Edge, Firefox ou Safari, ou importez un fichier audio depuis l'accueil.
      </div>
    );
  }

  const speakers = meeting.info.participants.filter(
    (p) => p.presence === "present" || p.presence === "distanciel",
  );
  const recent = meeting.transcript.slice(-6);

  return (
    <div className="card recorder">
      {error && <div className="alert error">{error}</div>}

      {status === "idle" && (
        <div className="grid-3" style={{ textAlign: "left", marginBottom: 16 }}>
          <div>
            <label htmlFor="mode">Source audio</label>
            <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as CaptureMode)}>
              <option value="micro">Audio — réunion en salle (microphone)</option>
              <option value="visio">Audio — visioconférence (micro + son de l'onglet)</option>
              <option value="onglet">Audio — son de l'ordinateur ou d'un onglet (émission, vidéo, sans micro)</option>
              <option value="camera">Vidéo — caméra + microphone</option>
              <option value="ecran">Vidéo — écran partagé + micro + son (visio, présentation)</option>
            </select>
            {isVideoMode(mode) && (
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                Environ 450 Mo par heure, stockés dans ce navigateur. La transcription et les
                documents utilisent la piste audio.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="device">Microphone</label>
            <select id="device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">Par défaut</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Microphone"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lang">Langue de l'aperçu en direct</label>
            <select id="lang" value={lang} onChange={(e) => setLang(e.target.value)} disabled={!livePreview}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.speech}>
                  {l.label}
                </option>
              ))}
            </select>
            <label className="small" style={{ display: "flex", gap: 6, marginTop: 6, fontWeight: 400 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={livePreview}
                disabled={!liveSpeechSupported()}
                onChange={(e) => setLivePreview(e.target.checked)}
              />
              Transcription en direct {liveSpeechSupported() ? "" : "(non disponible sur ce navigateur)"}
            </label>
          </div>
        </div>
      )}

      <video
        ref={preview}
        muted
        playsInline
        hidden={!hasVideo}
        style={{ width: "100%", maxWidth: 480, borderRadius: 10, background: "#000", marginBottom: 8 }}
      />

      <div className="timer">
        {status === "recording" && <span className="rec-dot" />}
        {formatTimestamp(active || status === "stopping" ? elapsed : meeting.durationMs)}
      </div>
      <div className="meter" aria-hidden>
        <div style={{ width: `${Math.min(100, level * 140)}%` }} />
      </div>

      <div className="row" style={{ justifyContent: "center" }}>
        {status === "idle" && (
          <button className="record" onClick={() => void start()}>
            ● {meeting.audioChunks > 0 ? "Nouvel enregistrement" : isVideoMode(mode) ? "Démarrer le film" : "Démarrer l'enregistrement"}
          </button>
        )}
        {active && (
          <>
            <button onClick={togglePause}>{status === "paused" ? "▶ Reprendre" : "❚❚ Pause"}</button>
            <button className="record" onClick={() => void stop()}>
              ■ Terminer
            </button>
          </>
        )}
        {status === "stopping" && <span className="muted">Finalisation de l'audio…</span>}
      </div>

      {justStopped && (
        <div className="alert info" style={{ marginTop: 16, textAlign: "left" }}>
          Enregistrement sauvegardé ({formatTimestamp(meeting.durationMs)}).{" "}
          <button className="primary" onClick={onFinished}>
            Transcrire et identifier les intervenants →
          </button>
        </div>
      )}

      {active && (
        <>
          {speakers.length > 0 && (
            <>
              <p className="muted small" style={{ marginBottom: 0 }}>
                Intervenant en cours (facultatif, pour l'aperçu en direct) :
              </p>
              <div className="speakers">
                <button
                  className={`chip ${speaker === undefined ? "active" : ""}`}
                  onClick={() => setSpeaker(undefined)}
                >
                  Non identifié
                </button>
                {speakers.map((p) => (
                  <button
                    key={p.id}
                    className={`chip ${speaker === p.id ? "active" : ""}`}
                    onClick={() => setSpeaker(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="row" style={{ maxWidth: 640, margin: "8px auto" }}>
            <input
              style={{ flex: 1 }}
              placeholder="Note horodatée (décision, action, point de vigilance…)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNote()}
            />
            <button onClick={addNote} disabled={!note.trim()}>
              ✎ Noter
            </button>
            <button onClick={bookmark} title="Marquer ce moment comme important">
              ★ Marquer
            </button>
          </div>

          <div className="segments" style={{ textAlign: "left", maxHeight: 260, marginTop: 12 }}>
            {recent.map((s) => (
              <div key={s.id} className={`segment ${s.kind ?? ""}`}>
                <span className="ts">{formatTimestamp(s.start)}</span>
                <div>
                  <div className="who">
                    {s.kind === "bookmark"
                      ? "★ Marque-page"
                      : s.kind === "note"
                        ? "✎ Note"
                        : speakerName(meeting.info.participants, s.speakerId)}
                  </div>
                  <div>{s.text}</div>
                </div>
              </div>
            ))}
            {interim && <p className="interim">{interim}…</p>}
          </div>
        </>
      )}

      {status === "idle" && !justStopped && (
        <p className="muted small" style={{ marginTop: 18 }}>
          L'audio est sauvegardé toutes les 5 secondes dans ce navigateur : une coupure n'entraîne
          pas la perte de la réunion. Gardez cet onglet ouvert pendant l'enregistrement.
        </p>
      )}
    </div>
  );
}
