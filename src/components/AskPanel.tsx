import { useRef, useState } from "react";
import { buildAskManualPrompt } from "../../shared/prompts.ts";
import type { AskMessage } from "../../shared/types.ts";
import { askMeeting, type Health } from "../lib/api.ts";
import type { Meeting } from "../lib/db.ts";
import { markdownToHtml } from "../lib/markdown.ts";

const SUGGESTIONS = [
  "Quelles décisions ont été prises ?",
  "Liste les actions avec leur responsable et leur échéance.",
  "Quels risques ou menaces sécuritaires ont été évoqués ?",
  "Quels points restent en suspens ou sans arbitrage ?",
  "Rédige un e-mail de suivi aux participants.",
  "Résume la position de chaque intervenant.",
];

export function AskPanel({ meeting, health }: { meeting: Meeting; health: Health | null }) {
  const [history, setHistory] = useState<AskMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const busy = answer !== null;
  const [copied, setCopied] = useState(false);

  // Sans clé API (mode autonome) : on copie la réunion pour l'interroger dans Claude.ai.
  if (!health?.apiKeyConfigured) {
    return (
      <div className="card">
        <h2>Demandez à votre réunion</h2>
        <p className="muted">
          Mode gratuit : copiez la réunion, collez-la dans une conversation Claude.ai, puis posez
          vos questions. Exemples :
        </p>
        <ul className="small">
          {SUGGESTIONS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <button
          className="primary"
          onClick={() => {
            void navigator.clipboard
              .writeText(
                buildAskManualPrompt({ meeting: meeting.info, transcript: meeting.transcript, notes: meeting.notes }),
              )
              .then(() => {
                setCopied(true);
                window.open("https://claude.ai/new", "_blank", "noopener");
              });
          }}
        >
          ⧉ Copier la réunion et ouvrir Claude.ai
        </button>
        {copied && <p className="muted small">Copié : collez (Ctrl+V) dans Claude.ai.</p>}
      </div>
    );
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setQuestion("");
    setError(null);
    setAnswer("");
    abort.current = new AbortController();
    try {
      const result = await askMeeting(
        {
          meeting: meeting.info,
          transcript: meeting.transcript,
          notes: meeting.notes,
          history,
          question: q,
        },
        setAnswer,
        abort.current.signal,
      );
      setHistory((h) => [...h, { role: "user", content: q }, { role: "assistant", content: result.text }]);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setQuestion(q);
    } finally {
      setAnswer(null);
    }
  }

  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Demandez à votre réunion</h2>
        {history.length > 0 && (
          <button className="ghost small" onClick={() => setHistory([])} disabled={busy}>
            Nouvelle conversation
          </button>
        )}
      </div>
      <p className="muted small">
        Les réponses s'appuient uniquement sur la transcription et citent l'horodatage des passages.
      </p>

      {history.length === 0 && !busy && (
        <div className="row" style={{ gap: 6, marginBottom: 14 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="chat">
        {history.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="bubble user">
              {m.content}
            </div>
          ) : (
            <div key={i} className="bubble assistant" dangerouslySetInnerHTML={{ __html: markdownToHtml(m.content) }} />
          ),
        )}
        {busy && (
          <div
            className="bubble assistant"
            dangerouslySetInnerHTML={{ __html: answer ? markdownToHtml(answer) : "<em>Analyse de la réunion…</em>" }}
          />
        )}
      </div>

      {error && (
        <div className="alert error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      <form
        className="row"
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          style={{ flex: 1 }}
          placeholder="Posez une question sur la réunion…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()}>
            ■ Arrêter
          </button>
        ) : (
          <button className="primary" type="submit" disabled={!question.trim()}>
            Envoyer
          </button>
        )}
      </form>
    </div>
  );
}
