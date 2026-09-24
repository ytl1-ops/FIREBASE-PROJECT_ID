import { useRef, useState } from "react";
import type { Attachment } from "../../shared/types.ts";
import { ACCEPTED_FILES, formatSize, MAX_PDF_TOTAL, pdfTotal, readAttachment } from "../lib/attachments.ts";
import type { Meeting } from "../lib/db.ts";
import type { UpdateMeeting } from "../pages/MeetingPage.tsx";

/** Fichiers sources joints à la réunion, pris en compte dans les documents et les questions. */
export function AttachmentsCard({ meeting, update }: { meeting: Meeting; update: UpdateMeeting }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const attachments = meeting.attachments ?? [];

  async function add(files: FileList) {
    setError(null);
    setLoading(true);
    const added: Attachment[] = [];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      try {
        added.push(await readAttachment(file));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (pdfTotal([...attachments, ...added]) > MAX_PDF_TOTAL) {
      errors.push(`Les PDF joints dépassent ${formatSize(MAX_PDF_TOTAL)} au total : retirez-en ou convertissez-les en texte.`);
      added.splice(0, added.length, ...added.filter((a) => a.kind !== "pdf"));
    }
    if (added.length) update((m) => ({ ...m, attachments: [...(m.attachments ?? []), ...added] }));
    if (errors.length) setError(errors.join(" "));
    setLoading(false);
  }

  return (
    <div className="card no-print">
      <div className="row between">
        <div>
          <h3 style={{ marginBottom: 2 }}>Fichiers à synthétiser</h3>
          <p className="muted small" style={{ margin: 0 }}>
            PDF, Word (.docx) ou texte : rapports, notes, comptes rendus précédents… Ils sont pris
            en compte avec la transcription (ou seuls, pour une synthèse documentaire).
          </p>
        </div>
        <button onClick={() => input.current?.click()} disabled={loading}>
          {loading ? "Lecture…" : "⤒ Ajouter des fichiers"}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <div className="alert error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {attachments.length > 0 && (
        <ul className="meeting-list" style={{ marginTop: 8 }}>
          {attachments.map((a) => (
            <li key={a.id} className="row between" style={{ padding: "6px 0" }}>
              <span>
                {a.kind === "pdf" ? "📄" : "📝"} {a.name}{" "}
                <span className="muted small">
                  {formatSize(a.size)}
                  {a.kind === "text" && a.text ? ` · ${a.text.split(/\s+/).length} mots` : ""}
                </span>
              </span>
              <button
                className="ghost small"
                title="Retirer"
                onClick={() =>
                  update((m) => ({ ...m, attachments: (m.attachments ?? []).filter((x) => x.id !== a.id) }))
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
