import { useRef, useState } from "react";
import { buildAskManualPrompt } from "../../shared/prompts.ts";
import type { AskMessage } from "../../shared/types.ts";
import { askMeeting, type Health } from "../lib/api.ts";
import { cloudAsk, getCloudSettings, withPdfText } from "../lib/cloud.ts";
import { repondreSansIA } from "../../shared/extraction.ts";
import { ENTERPRISE_MODE } from "../lib/config.ts";
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
  // Questions : « Mon API » si connectée, sinon l'API gratuite configurée dans les Réglages.
  const cloud = health?.generation.available ? null : getCloudSettings();
  const canAsk = Boolean(health?.generation.available || cloud);

  // Sans API ni clé : mode autonome, réponses par recherche dans la réunion (sur l'appareil).
  const local = !canAsk;

  function copyForClaude() {
    void navigator.clipboard
      .writeText(
        buildAskManualPrompt({
          meeting: meeting.info,
          transcript: meeting.transcript,
          notes: meeting.notes,
          attachments: meeting.attachments,
        }),
      )
      .then(() => {
        setCopied(true);
        window.open("https://claude.ai/new", "_blank", "noopener");
      });
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setQuestion("");
    setError(null);
    setAnswer("");
    if (local) {
      const attachments = await withPdfText(meeting.attachments);
      const text = repondreSansIA({ meeting: meeting.info, transcript: meeting.transcript, notes: meeting.notes, attachments, question: q });
      setHistory((h) => [...h, { role: "user", content: q }, { role: "assistant", content: text }]);
      setAnswer(null);
      return;
    }
    abort.current = new AbortController();
    try {
      const request = {
        meeting: meeting.info,
        transcript: meeting.transcript,
        notes: meeting.notes,
        attachments: meeting.attachments,
        history,
        question: q,
      };
      const result = cloud
        ? await cloudAsk(cloud, request, setAnswer, abort.current.signal)
        : await askMeeting(request, setAnswer, abort.current.signal);
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
        {local
          ? "Mode autonome : les réponses sont trouvées sur l'appareil, par recherche dans la réunion (sans IA ni envoi de données), avec l'horodatage des passages."
          : "Les réponses s'appuient uniquement sur la transcription et citent l'horodatage des passages."}
      </p>
      {local && !ENTERPRISE_MODE && (
        <p className="muted small">
          Pour des réponses rédigées : ajoutez une clé d'API gratuite dans les Réglages (⚙), ou{" "}
          <button className="ghost small" onClick={copyForClaude}>
            ⧉ copiez la réunion vers Claude.ai
          </button>
          {copied && " — copié, collez-la dans Claude.ai."}
        </p>
      )}

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
