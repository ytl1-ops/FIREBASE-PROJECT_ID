import { useEffect, useMemo, useRef, useState } from "react";
import { formatTimestamp, parseTranscriptFile, speakerName } from "../../shared/transcript.ts";
import type { TranscriptSegment } from "../../shared/types.ts";
import { transcribeAudio, type Health } from "../lib/api.ts";
import { getAudio, newId, type Meeting } from "../lib/db.ts";
import { exportAudio, exportTranscript } from "../lib/export.ts";
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
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (recording) return;
    let url: string | null = null;
    void getAudio(meeting).then((blob) => {
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
  }, [meeting.id, meeting.audioChunks, recording]);

  const participants = meeting.info.participants;
  const participantIds = new Set(participants.map((p) => p.id));

  /** Étiquettes de locuteurs issues de la diarisation ou d'un import, pas encore rattachées. */
  const unmapped = useMemo(() => {
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

  async function runTranscription() {
    if (!audio) return;
    const hasSpeech = meeting.transcript.some((s) => (s.kind ?? "speech") === "speech");
    if (
      hasSpeech &&
      !window.confirm(
        "La transcription existante (hors notes et marque-pages) sera remplacée par la transcription haute fidélité. Continuer ?",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo("Transcription en cours… comptez environ 1 minute pour 30 minutes d'audio.");
    try {
      const result = await transcribeAudio(audio, {
        languages,
        speakers: Number(speakers) || undefined,
        vocabulary: vocabulary.split(/[,\n;]/),
      });
      const segments: TranscriptSegment[] = result.segments.map((s) => ({
        id: newId("s-"),
        start: s.start,
        end: s.end,
        speakerId: s.speaker,
        text: s.text,
        kind: "speech",
      }));
      setSegments((old) => sortSegments([...old.filter((s) => s.kind === "note" || s.kind === "bookmark"), ...segments]));
      const distinct = new Set(result.segments.map((s) => s.speaker)).size;
      setInfo(
        `Transcription terminée : ${segments.length} interventions, ${distinct} voix distinctes. Associez chaque voix à un participant ci-dessous.`,
      );
    } catch (err) {
      setInfo(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert info">{info}</div>}

      <div className="card">
        {audioUrl ? (
          <audio
            ref={player}
            src={audioUrl}
            controls
            style={{ width: "100%" }}
            onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
            onLoadedMetadata={(e) => {
              // Les WebM de MediaRecorder n'annoncent pas leur durée : on force son calcul.
              const el = e.currentTarget;
              if (el.duration === Infinity) {
                el.currentTime = 1e9;
                el.addEventListener("durationchange", () => (el.currentTime = 0), { once: true });
              }
            }}
          />
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            {recording ? "Enregistrement en cours…" : "Aucun audio pour cette réunion."}
          </p>
        )}

        {audio && !recording && (
          <details style={{ marginTop: 14 }} open={!meeting.transcript.some((s) => s.end !== undefined)}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>
              Transcription haute fidélité avec identification des intervenants
            </summary>
            {!health?.transcriptionConfigured && (
              <div className="alert warn" style={{ marginTop: 10 }}>
                Service non configuré sur le serveur (variable GLADIA_API_KEY). Vous pouvez
                néanmoins utiliser l'aperçu en direct ou importer une transcription.
              </div>
            )}
            <div className="grid-3" style={{ marginTop: 10 }}>
              <div>
                <label>Langue(s) parlée(s)</label>
                <div className="row" style={{ gap: 4 }}>
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      className={`chip ${languages.includes(l.code) ? "active" : ""}`}
                      onClick={() =>
                        setLanguages((cur) =>
                          cur.includes(l.code) ? cur.filter((c) => c !== l.code) : [...cur, l.code],
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
                <p className="muted small">Le préciser améliore la séparation des voix.</p>
              </div>
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
            </div>
            <button
              className="primary"
              disabled={busy || !health?.transcriptionConfigured}
              onClick={() => void runTranscription()}
            >
              {busy ? "Transcription en cours…" : "Lancer la transcription"}
            </button>
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
            <button disabled={!audio} onClick={() => audio && void exportAudio(meeting, audio)}>
              ⤓ Audio
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
