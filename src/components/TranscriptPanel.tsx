import { useEffect, useMemo, useRef, useState } from "react";
import { formatTimestamp, parseTranscriptFile, speakerName } from "../../shared/transcript.ts";
import type { TranscriptSegment } from "../../shared/types.ts";
import { getModelHost, transcribeAudio, type Health } from "../lib/api.ts";
import { getAudio, newId, type Meeting } from "../lib/db.ts";
import { exportAudio, exportTranscript } from "../lib/export.ts";
import { decodeAudio, runLocalTranscription, type LocalJob } from "../lib/local/index.ts";
import { defaultLocalModel, LOCAL_MODELS } from "../lib/local/protocol.ts";
import { LANGUAGES, newParticipant } from "../lib/meeting.ts";
import type { UpdateMeeting } from "../pages/MeetingPage.tsx";

function sortSegments(segments: TranscriptSegment[]) {
  return [...segments].sort((a, b) => a.start - b.start);
}

export function TranscriptPanel({
  meeting,
  update,
  health,
  recording,
}: {
  meeting: Meeting;
  update: UpdateMeeting;
  health: Health | null;
  recording: boolean;
}) {
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [query, setQuery] = useState("");
  const [languages, setLanguages] = useState<string[]>(["fr"]);
  const presentCount = meeting.info.participants.filter(
    (p) => p.presence === "present" || p.presence === "distanciel",
  ).length;
  const [speakers, setSpeakers] = useState<string>(presentCount ? String(presentCount) : "");
  const [vocabulary, setVocabulary] = useState(() =>
    [
      ...new Set(
        meeting.info.participants.flatMap((p) => [p.name, p.organisation ?? ""]).filter((v) => v.trim()),
      ),
    ].join(", "),
  );
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<"local" | "server">(() =>
    health?.transcription.available ? "server" : "local",
  );
  const [localModel, setLocalModel] = useState<string>(defaultLocalModel);
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null);
  const job = useRef<LocalJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const player = useRef<HTMLMediaElement>(null);
  const isVideo = (meeting.audioMime ?? "").startsWith("video/");
  const fileInput = useRef<HTMLInputElement>(null);

  // Rechargé seulement quand l'enregistrement change (pas à chaque correction de texte).
  const { id: meetingId, audioChunks, audioMime } = meeting;
  useEffect(() => {
    if (recording) return;
    let url: string | null = null;
    void getAudio({ id: meetingId, audioChunks, audioMime } as Meeting).then((blob) => {
      setAudio(blob);
      if (blob) {
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
    // Recharger uniquement quand le nombre de fragments change.
  }, [meetingId, audioChunks, audioMime, recording]);

  const participants = meeting.info.participants;

  // Sous-titres (WebVTT) générés depuis la transcription, pour le lecteur audio/vidéo.
  const captionsUrl = useMemo(() => {
    const speech = meeting.transcript.filter((seg) => (seg.kind ?? "speech") === "speech");
    if (!speech.length) return null;
    const ts = (ms: number) => new Date(ms).toISOString().slice(11, 23);
    const cues = speech.map((seg, i) => {
      const end = seg.end ?? speech[i + 1]?.start ?? seg.start + 4000;
      const who = speakerName(participants, seg.speakerId);
      return `${ts(seg.start)} --> ${ts(Math.max(end, seg.start + 500))}\n<v ${who.replace(/[<>]/g, "")}>${seg.text.replace(/[<>&]/g, " ")}`;
    });
    return URL.createObjectURL(new Blob([`WEBVTT\n\n${cues.join("\n\n")}\n`], { type: "text/vtt" }));
  }, [meeting.transcript, participants]);
  useEffect(() => () => void (captionsUrl && URL.revokeObjectURL(captionsUrl)), [captionsUrl]);

  /** Étiquettes de locuteurs issues de la diarisation ou d'un import, pas encore rattachées. */
  const unmapped = useMemo(() => {
    const participantIds = new Set(participants.map((p) => p.id));
    const labels = new Map<string, number>();
    for (const s of meeting.transcript) {
      if (s.speakerId && !participantIds.has(s.speakerId)) {
        labels.set(s.speakerId, (labels.get(s.speakerId) ?? 0) + 1);
      }
    }
    return [...labels.entries()];
  }, [meeting.transcript, participants]);

  const talkTime = useMemo(() => {
    const totals = new Map<string, number>();
    const speech = meeting.transcript.filter((s) => s.kind !== "note" && s.kind !== "bookmark");
    speech.forEach((s, i) => {
      const end = s.end ?? speech[i + 1]?.start ?? s.start + s.text.length * 60;
      const key = s.speakerId ?? "";
      totals.set(key, (totals.get(key) ?? 0) + Math.max(0, end - s.start));
    });
    const sum = [...totals.values()].reduce((a, b) => a + b, 0) || 1;
    return [...totals.entries()]
      .map(([id, ms]) => ({ id, ms, pct: (ms / sum) * 100 }))
      .sort((a, b) => b.ms - a.ms);
  }, [meeting.transcript]);

  function setSegments(fn: (segments: TranscriptSegment[]) => TranscriptSegment[]) {
    update((m) => ({ ...m, transcript: fn(m.transcript) }));
  }

  function mapSpeaker(label: string, target: string) {
    if (target === "__new__") {
      const p = newParticipant(label.startsWith("Locuteur") ? "" : label);
      const name = window.prompt(`Nom de l'intervenant « ${label} » :`, p.name);
      if (!name?.trim()) return;
      p.name = name.trim();
      update((m) => ({
        ...m,
        info: { ...m.info, participants: [...m.info.participants, p] },
        transcript: m.transcript.map((s) => (s.speakerId === label ? { ...s, speakerId: p.id } : s)),
      }));
      return;
    }
    setSegments((segs) => segs.map((s) => (s.speakerId === label ? { ...s, speakerId: target } : s)));
  }

  function seek(ms: number) {
    if (!player.current) return;
    player.current.currentTime = ms / 1000;
    void player.current.play();
  }

  function applyTranscription(result: { start: number; end: number; speaker: string; text: string }[]) {
    if (result.length === 0) {
      setInfo(null);
      setError(
        "Aucune parole détectée dans l'enregistrement. Vérifiez qu'il contient bien des voix (réécoutez-le), que le micro n'était pas couvert, puis réessayez en précisant la langue.",
      );
      return;
    }
    const segments: TranscriptSegment[] = result.map((seg) => ({
      id: newId("s-"),
      start: seg.start,
      end: seg.end,
      speakerId: seg.speaker,
      text: seg.text,
      kind: "speech",
    }));
    setSegments((old) =>
      sortSegments([...old.filter((x) => x.kind === "note" || x.kind === "bookmark"), ...segments]),
    );
    const distinct = new Set(result.map((x) => x.speaker)).size;
    setInfo(
      `Transcription terminée : ${segments.length} interventions, ${distinct} voix distincte(s).${
        distinct > 1 ? " Associez chaque voix à un participant ci-dessous." : ""
      }`,
    );
  }

  async function runTranscription() {
    if (!audio) return;
    const hasSpeech = meeting.transcript.some((s) => (s.kind ?? "speech") === "speech");
    if (
      hasSpeech &&
      !window.confirm(
        "La transcription existante (hors notes et marque-pages) sera remplacée. Continuer ?",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (engine === "server") {
        setInfo("Transcription sur « Mon API » : vous pouvez continuer à utiliser l'application pendant le traitement.");
        const controller = new AbortController();
        job.current = { result: Promise.resolve({ segments: [], device: "" }), cancel: () => controller.abort() };
        const result = await transcribeAudio(
          audio,
          {
            languages,
            speakers: Number(speakers) || undefined,
            vocabulary: vocabulary.split(/[,\n;]/),
          },
          (p) => setProgress({ label: p.label, value: p.progress }),
          controller.signal,
        );
        applyTranscription(result.segments);
      } else {
        setInfo(
          "Transcription sur cet appareil : le premier usage télécharge le modèle (une seule fois). Gardez cet onglet ouvert.",
        );
        setProgress({ label: "Préparation de l'audio", value: 0 });
        const samples = await decodeAudio(audio);
        const lang = LANGUAGES.find((l) => l.code === languages[0]);
        job.current = runLocalTranscription(
          samples,
          {
            model: localModel,
            language: lang?.whisper,
            speakers: Number(speakers) || undefined,
            diarize: Number(speakers) !== 1,
            modelHost: getModelHost() || undefined,
          },
          (msg) => {
            if (msg.type === "progress") setProgress({ label: msg.label, value: msg.progress });
          },
        );
        const { segments, device, warning } = await job.current.result;
        applyTranscription(
          segments.map((x) => ({
            start: Math.round(x.start * 1000),
            end: Math.round(x.end * 1000),
            speaker: `Locuteur ${x.speaker + 1}`,
            text: x.text,
          })),
        );
        if (warning) setError(warning);
        if (device === "wasm") {
          setInfo((cur) => `${cur ?? ""} (Calcul sur processeur : activez WebGPU dans Chrome/Edge pour aller plus vite.)`);
        }
      }
    } catch (err) {
      setInfo(null);
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
      setProgress(null);
      job.current = null;
    }
  }

  // Arrête le moteur local si l'on quitte l'onglet.
  useEffect(() => () => job.current?.cancel(), []);

  async function importFile(file: File) {
    const { segments } = parseTranscriptFile(await file.text());
    if (!segments.length) {
      setError("Aucune réplique reconnue dans ce fichier (formats acceptés : .vtt, .srt, .txt).");
      return;
    }
    // Rattache automatiquement les noms déjà présents dans la liste des participants.
    const byName = new Map(participants.map((p) => [p.name.trim().toLowerCase(), p.id]));
    const mapped = segments.map((s) => ({
      ...s,
      speakerId: s.speakerId ? (byName.get(s.speakerId.toLowerCase()) ?? s.speakerId) : undefined,
    }));
    setSegments((old) => sortSegments([...old, ...mapped]));
    setInfo(`${segments.length} répliques importées depuis « ${file.name} ».`);
  }

  const q = query.trim().toLowerCase();
  const visible = q ? meeting.transcript.filter((s) => s.text.toLowerCase().includes(q)) : meeting.transcript;
  const activeId = [...meeting.transcript].reverse().find((s) => s.start <= currentMs)?.id;

  const highlight = (text: string) => {
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"));
    return parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
  };

  return (
    <>
      {error && (
        <div className="alert error">
          {error}
          <div style={{ marginTop: 8 }}>
            <button
              className="chip"
              onClick={() => {
                const nav = navigator as Navigator & { deviceMemory?: number };
                const report = [
                  `MonMeeting — diagnostic de transcription (${new Date().toISOString()})`,
                  `Erreur : ${error}`,
                  `Moteur : ${engine === "local" ? `sur l'appareil (${localModel})` : "Mon API"}`,
                  `Enregistrement : ${meeting.audioMime ?? "?"}, ${meeting.audioChunks} fragment(s), ${formatTimestamp(meeting.durationMs)}`,
                  `Navigateur : ${navigator.userAgent}`,
                  `Mémoire : ${nav.deviceMemory ?? "?"} Go · WebGPU : ${"gpu" in navigator ? "présent" : "absent"} · Isolation : ${self.crossOriginIsolated}`,
                ].join("\n");
                void navigator.clipboard.writeText(report).then(() => setInfo("Diagnostic copié : collez-le dans votre message."));
              }}
            >
              ⧉ Copier le diagnostic
            </button>
          </div>
        </div>
      )}
      {info && <div className="alert info">{info}</div>}

      <div className="card">
        {audioUrl ? (
          (() => {
            const props = {
              src: audioUrl,
              controls: true,
              style: { width: "100%", maxHeight: 420, borderRadius: 10 },
              onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) =>
                setCurrentMs(e.currentTarget.currentTime * 1000),
              onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => {
                // Les WebM de MediaRecorder n'annoncent pas leur durée : on force son calcul.
                const el = e.currentTarget;
                if (el.duration === Infinity) {
                  el.currentTime = 1e9;
                  el.addEventListener("durationchange", () => (el.currentTime = 0), { once: true });
                }
              },
            };
            const track = captionsUrl ? (
              <track kind="captions" src={captionsUrl} srcLang="fr" label="Transcription" default />
            ) : null;
            return isVideo ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption -- sous-titres ajoutés dès qu'une transcription existe
              <video ref={player as React.RefObject<HTMLVideoElement>} playsInline {...props}>
                {track}
              </video>
            ) : (
              // eslint-disable-next-line jsx-a11y/media-has-caption -- sous-titres ajoutés dès qu'une transcription existe
              <audio ref={player} {...props}>
                {track}
              </audio>
            );
          })()
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            {recording ? "Enregistrement en cours…" : "Aucun enregistrement pour cette réunion."}
          </p>
        )}

        {audio && !recording && (
          <details style={{ marginTop: 14 }} open={!meeting.transcript.some((s) => s.end !== undefined)}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>
              Transcription complète avec identification des intervenants
            </summary>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className={`chip ${engine === "local" ? "active" : ""}`}
                onClick={() => setEngine("local")}
                disabled={busy}
              >
                Sur cet appareil — gratuit, hors ligne
              </button>
              <button
                className={`chip ${engine === "server" ? "active" : ""}`}
                onClick={() => setEngine("server")}
                disabled={busy}
              >
                Mon API — serveur MonMeeting
              </button>
            </div>
            {engine === "local" ? (
              <p className="muted small">
                🔒 L'audio ne quitte pas votre appareil. Le modèle Whisper est téléchargé au premier
                usage puis conservé par le navigateur. Durée indicative : de l'ordre du temps réel sur
                processeur, bien plus rapide avec une carte graphique (Chrome/Edge).
              </p>
            ) : (
              <>
                <p className="muted small">
                  🔒 Transcription par votre propre serveur (Whisper + identification des voix) :
                  plus rapide et plus précise qu'un téléphone, sans service tiers.
                </p>
                {!health?.transcription.available && (
                  <div className="alert warn" style={{ marginTop: 10 }}>
                    « Mon API » n'est pas connectée ou pas prête. Renseignez son adresse dans les
                    Réglages (⚙), ou utilisez la transcription sur cet appareil.
                  </div>
                )}
              </>
            )}
            <div className="grid-3" style={{ marginTop: 10 }}>
              <div>
                <label>Langue{engine === "server" ? "(s)" : ""} parlée{engine === "server" ? "(s)" : ""}</label>
                <div className="row" style={{ gap: 4 }}>
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      className={`chip ${languages.includes(l.code) ? "active" : ""}`}
                      onClick={() =>
                        setLanguages((cur) =>
                          engine === "local"
                            ? cur[0] === l.code
                              ? []
                              : [l.code]
                            : cur.includes(l.code)
                              ? cur.filter((c) => c !== l.code)
                              : [...cur, l.code],
                        )
                      }
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <p className="muted small">Aucune sélection = détection automatique.</p>
              </div>
              <div>
                <label htmlFor="speakers">Nombre d'intervenants</label>
                <input
                  id="speakers"
                  type="number"
                  min={1}
                  max={30}
                  value={speakers}
                  placeholder="Automatique"
                  onChange={(e) => setSpeakers(e.target.value)}
                />
                <p className="muted small">Le préciser améliore nettement la séparation des voix.</p>
              </div>
              {engine === "local" ? (
                <div>
                  <label htmlFor="local-model">Qualité</label>
                  <select id="local-model" value={localModel} onChange={(e) => setLocalModel(e.target.value)}>
                    {LOCAL_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} — {m.detail}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label htmlFor="vocab">Vocabulaire spécifique</label>
                  <textarea
                    id="vocab"
                    rows={3}
                    value={vocabulary}
                    placeholder="Noms, sigles, lieux : OSCE, Tombouctou, JNIM…"
                    onChange={(e) => setVocabulary(e.target.value)}
                  />
                </div>
              )}
            </div>
            {progress && (
              <div style={{ margin: "8px 0" }}>
                <div className="small muted">
                  {progress.label} — {Math.round(progress.value * 100)} %
                </div>
                <div className="meter" style={{ maxWidth: "none", margin: "4px 0" }}>
                  <div style={{ width: `${progress.value * 100}%`, background: "var(--accent)" }} />
                </div>
              </div>
            )}
            <div className="row">
              <button
                className="primary"
                disabled={busy || (engine === "server" && !health?.transcription.available)}
                onClick={() => void runTranscription()}
              >
                {busy ? "Transcription en cours…" : "Lancer la transcription"}
              </button>
              {busy && <button onClick={() => job.current?.cancel()}>Annuler</button>}
            </div>
          </details>
        )}
      </div>

      {unmapped.length > 0 && (
        <div className="card">
          <h3>Qui parle ?</h3>
          <p className="muted small">
            Associez chaque voix détectée à un participant. Cliquez sur un horodatage pour écouter.
          </p>
          <div className="stack">
            {unmapped.map(([label, count]) => {
              const first = meeting.transcript.find((s) => s.speakerId === label);
              return (
                <div key={label} className="row">
                  <strong style={{ minWidth: 110 }}>{label}</strong>
                  <span className="muted small" style={{ minWidth: 120 }}>
                    {count} intervention(s)
                  </span>
                  {first && audioUrl && (
                    <button className="chip" onClick={() => seek(first.start)}>
                      ▶ {formatTimestamp(first.start)}
                    </button>
                  )}
                  <select
                    style={{ maxWidth: 260 }}
                    value=""
                    onChange={(e) => e.target.value && mapSpeaker(label, e.target.value)}
                  >
                    <option value="">Associer à…</option>
                    {participants.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    <option value="__new__">+ Nouveau participant…</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Transcription</h2>
          <div className="row">
            <button onClick={() => fileInput.current?.click()} title="Teams, Zoom, Meet : .vtt / .srt / .txt">
              ⤒ Importer
            </button>
            <button disabled={!meeting.transcript.length} onClick={() => exportTranscript(meeting)}>
              ⤓ Texte
            </button>
            <button disabled={!audio} onClick={() => audio && exportAudio(meeting, audio)}>
              ⤓ {isVideo ? "Vidéo" : "Audio"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".vtt,.srt,.txt,text/plain,text/vtt"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {talkTime.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>
              Temps de parole
            </div>
            <div className="row" style={{ gap: 12 }}>
              {talkTime.map((t) => (
                <span key={t.id} className="small">
                  <strong>{speakerName(participants, t.id || undefined)}</strong> {Math.round(t.pct)} %
                </span>
              ))}
            </div>
          </div>
        )}

        <input
          type="search"
          placeholder="Rechercher dans la transcription…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 8 }}
        />

        {visible.length === 0 ? (
          <p className="muted">
            {meeting.transcript.length
              ? "Aucun résultat."
              : "Pas encore de transcription. Enregistrez la réunion, lancez la transcription haute fidélité ou importez un fichier."}
          </p>
        ) : (
          <div className="segments">
            {visible.map((s) => (
              <div
                key={s.id}
                className={`segment ${s.kind ?? ""}`}
                style={s.id === activeId && audioUrl ? { background: "var(--surface-2)" } : undefined}
              >
                <button className="ts" onClick={() => seek(s.start)} disabled={!audioUrl}>
                  {formatTimestamp(s.start)}
                </button>
                <div>
                  <div className="tools">
                    {s.kind === "bookmark" ? (
                      <span className="who">★ Marque-page</span>
                    ) : s.kind === "note" ? (
                      <span className="who">✎ Note</span>
                    ) : (
                      <select
                        aria-label="Intervenant"
                        value={s.speakerId ?? ""}
                        onChange={(e) =>
                          setSegments((segs) =>
                            segs.map((x) => (x.id === s.id ? { ...x, speakerId: e.target.value || undefined } : x)),
                          )
                        }
                      >
                        <option value="">Non identifié</option>
                        {participants.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                        {unmapped.map(([label]) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                    <span style={{ flex: 1 }} />
                    <button
                      className="ghost small"
                      title="Supprimer ce segment"
                      onClick={() => setSegments((segs) => segs.filter((x) => x.id !== s.id))}
                    >
                      ✕
                    </button>
                  </div>
                  {q ? (
                    <div className="text">{highlight(s.text)}</div>
                  ) : (
                    <div
                      className="text"
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const text = e.currentTarget.textContent ?? "";
                        if (text !== s.text) {
                          setSegments((segs) => segs.map((x) => (x.id === s.id ? { ...x, text } : x)));
                        }
                      }}
                    >
                      {s.text}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <label htmlFor="notes">Notes du rédacteur (prises en compte dans les documents)</label>
        <textarea
          id="notes"
          rows={5}
          value={meeting.notes}
          placeholder="Contexte, éléments hors enregistrement, points à souligner…"
          onChange={(e) => update((m) => ({ ...m, notes: e.target.value }))}
        />
      </div>
    </>
  );
}
