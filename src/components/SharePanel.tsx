import { useState } from "react";
import { DOCUMENTS } from "../../shared/documents.ts";
import { getAudio, type Meeting } from "../lib/db.ts";
import { audioFileName, docxBlob, fileSlug, transcriptBlob } from "../lib/export.ts";
import { buildMeetingPackage, canShareFiles, shareOrDownload } from "../lib/share.ts";

export function SharePanel({ meeting }: { meeting: Meeting }) {
  const [withAudio, setWithAudio] = useState(true);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nativeShare = canShareFiles();
  const verb = nativeShare ? "Partager" : "Télécharger";

  async function run(label: string, build: () => Promise<{ blob: Blob; name: string }>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      const { blob, name } = await build();
      const outcome = await shareOrDownload(blob, name, meeting.info.title);
      if (outcome === "downloaded") {
        setMessage(`« ${name} » téléchargé : transmettez-le par le canal de votre choix.`);
      } else if (outcome === "shared") {
        setMessage(`« ${name} » partagé.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const passwordOk = !encrypt || (password.length >= 8 && password === confirm);
  const docs = DOCUMENTS.filter((d) => meeting.documents[d.type]?.content.trim());

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert info">{message}</div>}

      <div className="card">
        <h2>Partager la réunion complète</h2>
        <p className="muted small">
          Crée un fichier <strong>.monmeeting</strong> (informations, transcription, notes, documents
          {withAudio ? ", audio" : ""}) que vos collègues ouvrent avec « Importer une réunion » sur
          l'accueil de leur MonMeeting. Aucun serveur n'intervient : le fichier circule par le canal
          que vous choisissez.
        </p>
        <div className="stack">
          <label className="row" style={{ fontWeight: 400, color: "var(--text)" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={withAudio}
              disabled={!meeting.audioChunks}
              onChange={(e) => setWithAudio(e.target.checked)}
            />
            Inclure l'enregistrement audio {meeting.audioChunks ? "" : "(aucun audio)"}
          </label>
          <label className="row" style={{ fontWeight: 400, color: "var(--text)" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={encrypt}
              onChange={(e) => setEncrypt(e.target.checked)}
            />
            Chiffrer le fichier (facultatif, recommandé pour les réunions sensibles)
          </label>
          {encrypt && (
            <div className="grid-2">
              <div>
                <label htmlFor="pkg-pass">Mot de passe du fichier (8 caractères minimum)</label>
                <input
                  id="pkg-pass"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="pkg-confirm">Confirmation</label>
                <input
                  id="pkg-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <p className="muted small" style={{ gridColumn: "1 / -1", margin: 0 }}>
                Chiffrement AES-256 effectué sur votre appareil. Communiquez le mot de passe par un
                autre canal que le fichier. Il ne peut pas être récupéré en cas d'oubli.
              </p>
            </div>
          )}
          <div>
            <button
              className="primary"
              disabled={busy !== null || !passwordOk}
              onClick={() =>
                void run("package", async () => {
                  const audio = withAudio ? await getAudio(meeting) : null;
                  return {
                    blob: await buildMeetingPackage(meeting, audio, encrypt ? password : undefined),
                    name: encrypt
                      ? `${new Date().toISOString().slice(0, 10)}_reunion-chiffree.monmeeting`
                      : `${fileSlug(meeting, "reunion")}.monmeeting`,
                  };
                })
              }
            >
              {busy === "package" ? "Préparation…" : `⇪ ${verb} la réunion`}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Partager un fichier</h2>
        <p className="muted small">
          {nativeShare
            ? "Ouvre le menu de partage de l'appareil (Mail, Signal, WhatsApp, Teams…)."
            : "Ce navigateur ne propose pas de menu de partage : le fichier est téléchargé pour que vous le transmettiez."}
        </p>
        <div className="stack">
          {docs.map((d) => (
            <div key={d.type} className="row between">
              <span>{d.label} (Word)</span>
              <button
                disabled={busy !== null}
                onClick={() =>
                  void run(d.type, async () => ({
                    blob: await docxBlob(meeting.documents[d.type]!.content, meeting),
                    name: `${fileSlug(meeting, d.short)}.docx`,
                  }))
                }
              >
                {busy === d.type ? "…" : `⇪ ${verb}`}
              </button>
            </div>
          ))}
          <div className="row between">
            <span>Transcription (texte)</span>
            <button
              disabled={busy !== null || !meeting.transcript.length}
              onClick={() =>
                void run("transcript", async () => ({
                  blob: transcriptBlob(meeting),
                  name: `${fileSlug(meeting, "transcription")}.txt`,
                }))
              }
            >
              {busy === "transcript" ? "…" : `⇪ ${verb}`}
            </button>
          </div>
          <div className="row between">
            <span>Enregistrement audio</span>
            <button
              disabled={busy !== null || !meeting.audioChunks}
              onClick={() =>
                void run("audio", async () => {
                  const audio = await getAudio(meeting);
                  if (!audio) throw new Error("Aucun audio pour cette réunion.");
                  return { blob: audio, name: audioFileName(meeting, audio) };
                })
              }
            >
              {busy === "audio" ? "…" : `⇪ ${verb}`}
            </button>
          </div>
          {docs.length === 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              Les documents rédigés (PV, compte rendu…) apparaîtront ici.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
