import { useRef, useState } from "react";
import { DOCUMENTS, getDocument } from "../../shared/documents.ts";
import { buildManualPrompt } from "../../shared/prompts.ts";
import type { DocumentType } from "../../shared/types.ts";
import { generateDocument, type Health } from "../lib/api.ts";
import type { Meeting } from "../lib/db.ts";
import { exportDocx, exportMarkdown, printDocument } from "../lib/export.ts";
import { markdownToHtml } from "../lib/markdown.ts";
import type { UpdateMeeting } from "../pages/MeetingPage.tsx";

export function DocumentsPanel({
  meeting,
  update,
  health,
}: {
  meeting: Meeting;
  update: UpdateMeeting;
  health: Health | null;
}) {
  const [selected, setSelected] = useState<DocumentType>(
    () => DOCUMENTS.find((d) => meeting.documents[d.type])?.type ?? "compte_rendu",
  );
  const [instructions, setInstructions] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const def = getDocument(selected);
  const saved = meeting.documents[selected];
  const content = streaming ?? saved?.content ?? "";
  const hasMaterial = meeting.transcript.some((s) => s.text.trim()) || meeting.notes.trim();
  const unmappedVoices = meeting.transcript.some(
    (s) => s.speakerId?.startsWith("Locuteur ") && !meeting.info.participants.some((p) => p.id === s.speakerId),
  );

  async function generate() {
    if (saved && !window.confirm(`Remplacer le ${def.label.toLowerCase()} existant ?`)) return;
    setError(null);
    setNotice(null);
    setEditing(false);
    setStreaming("");
    abort.current = new AbortController();
    try {
      const result = await generateDocument(
        {
          type: selected,
          meeting: meeting.info,
          transcript: meeting.transcript,
          notes: meeting.notes,
          instructions,
        },
        setStreaming,
        abort.current.signal,
      );
      update((m) => ({
        ...m,
        documents: {
          ...m.documents,
          [selected]: { content: result.text, generatedAt: new Date().toISOString(), model: result.model },
        },
      }));
      if (result.truncated) setNotice("Le document a atteint la longueur maximale et peut être incomplet.");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setStreaming(null);
      abort.current = null;
    }
  }

  function saveEdit(text: string) {
    update((m) => ({
      ...m,
      documents: {
        ...m.documents,
        [selected]: { ...(m.documents[selected] ?? { generatedAt: new Date().toISOString() }), content: text, edited: true },
      },
    }));
  }

  /** Mode gratuit : la demande complète est copiée pour être collée dans Claude.ai. */
  async function copyPrompt() {
    await navigator.clipboard.writeText(
      buildManualPrompt({
        type: selected,
        meeting: meeting.info,
        transcript: meeting.transcript,
        notes: meeting.notes,
        instructions,
      }),
    );
    window.open("https://claude.ai/new", "_blank", "noopener");
    setEditing(true);
    setNotice(
      "Demande copiée. Collez-la dans Claude.ai (compte gratuit), puis collez la réponse obtenue dans l'éditeur ci-dessous : elle sera enregistrée avec la réunion.",
    );
  }

  async function copy() {
    await navigator.clipboard.writeText(content);
    setNotice("Document copié dans le presse-papiers (Markdown).");
  }

  return (
    <>
      <div className="doc-types">
        {DOCUMENTS.map((d) => (
          <button
            key={d.type}
            className={`doc-type ${selected === d.type ? "active" : ""}`}
            onClick={() => {
              if (streaming !== null) return;
              setSelected(d.type);
              setEditing(false);
              setError(null);
              setNotice(null);
            }}
          >
            <div className="row between">
              <span className="name">{d.label}</span>
              {meeting.documents[d.type]?.content.trim() && <span className="badge green">prêt</span>}
            </div>
            <div className="desc">{d.description}</div>
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert info">{notice}</div>}
      {!hasMaterial && (
        <div className="alert warn">
          Aucune transcription ni note : enregistrez ou importez la réunion avant de rédiger.
        </div>
      )}
      {hasMaterial && unmappedVoices && (
        <div className="alert warn">
          Certaines voix ne sont pas encore associées à un participant (onglet Transcription) :
          les propos leur seront attribués sous la forme « Locuteur N ».
        </div>
      )}
      {health && !health.apiKeyConfigured && (
        <div className="alert warn">
          Rédaction indisponible : la clé ANTHROPIC_API_KEY n'est pas configurée sur le serveur.
        </div>
      )}

      <div className="card no-print">
        <label htmlFor="instructions">Consignes complémentaires (facultatif)</label>
        <textarea
          id="instructions"
          rows={2}
          value={instructions}
          placeholder="Ex. : destinataire = Directeur sûreté groupe ; insister sur la situation à Bamako ; format court…"
          onChange={(e) => setInstructions(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          {streaming === null ? (
            <button
              className="primary"
              disabled={!hasMaterial || health?.apiKeyConfigured === false}
              onClick={() => void generate()}
            >
              ✦ {saved ? "Régénérer" : "Rédiger"} le {def.label.toLowerCase()}
            </button>
          ) : (
            <button onClick={() => abort.current?.abort()}>■ Arrêter la rédaction</button>
          )}
          {streaming === null && (
            <button
              disabled={!hasMaterial}
              onClick={() => void copyPrompt()}
              title="Sans clé API : copiez la demande dans votre compte Claude.ai gratuit"
            >
              ⧉ Mode gratuit (Claude.ai)
            </button>
          )}
          {content && streaming === null && (
            <>
              <button onClick={() => setEditing((e) => !e)}>{editing ? "Aperçu" : "✎ Modifier"}</button>
              <button onClick={() => void exportDocx(content, meeting, def.short)}>⤓ Word</button>
              <button onClick={() => printDocument(content, meeting)}>⎙ PDF</button>
              <button onClick={() => exportMarkdown(content, meeting, def.short)}>⤓ Markdown</button>
              <button onClick={() => void copy()}>⧉ Copier</button>
            </>
          )}
        </div>
        {saved && streaming === null && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Généré le {new Date(saved.generatedAt).toLocaleString("fr-FR")}
            {saved.edited ? " · modifié manuellement" : ""}. Relisez et validez avant diffusion.
          </p>
        )}
      </div>

      {editing && streaming === null ? (
        <textarea
          className="doc-editor"
          value={content}
          placeholder="Collez ici le document rédigé par Claude.ai…"
          onChange={(e) => saveEdit(e.target.value)}
        />
      ) : content ? (
        <article className="document" dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }} />
      ) : (
        streaming !== null && <p className="muted">Rédaction en cours…</p>
      )}
    </>
  );
}
