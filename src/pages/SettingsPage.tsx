import { useEffect, useState } from "react";
import { fetchHealth, getApiSettings, saveApiSettings, type Health } from "../lib/api.ts";

export function SettingsPage({ onSaved }: { onSaved: (health: Health | null) => void }) {
  const initial = getApiSettings();
  // Lien de connexion généré par le lanceur : #/reglages?jeton=…(&api=…)
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const [url, setUrl] = useState(params.get("api") ?? (params.has("jeton") ? "" : initial.url));
  const [token, setToken] = useState(params.get("jeton") ?? initial.token);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function test() {
    const clean = url.trim().replace(/\/+$/, "");
    if (clean && !/^https:\/\//.test(clean) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(clean)) {
      setStatus({ ok: false, text: "L'adresse doit commencer par https:// (connexion chiffrée obligatoire)." });
      return;
    }
    setTesting(true);
    saveApiSettings(clean, token);
    const health = await fetchHealth();
    setTesting(false);
    onSaved(health);
    if (!health) {
      setStatus({
        ok: false,
        text: "Connexion impossible. Vérifiez l'adresse, que le serveur est démarré et que cette application figure dans ALLOWED_ORIGINS.",
      });
      return;
    }
    const parts = [
      `rédaction ${health.generation.available ? `disponible (${health.generation.model})` : "indisponible"}`,
      `transcription ${health.transcription.available ? "disponible" : "indisponible"}`,
    ];
    setStatus({ ok: health.generation.available || health.transcription.available, text: `Connecté : ${parts.join(", ")}.` });
  }

  useEffect(() => {
    if (params.has("jeton")) {
      void test().then(() => {
        // Retire le jeton de l'adresse (historique, captures d'écran).
        window.history.replaceState(null, "", "#/reglages");
      });
    }
  }, []);

  return (
    <div className="card stack">
      <h1>Réglages</h1>
      <div>
        <h2>Mon API (serveur MonMeeting)</h2>
        <p className="muted small">
          Votre serveur auto-hébergé transcrit (Whisper) et rédige (modèle libre via Ollama) sans
          service tiers. Laissez vide si l'application est servie par ce serveur lui-même.
        </p>
      </div>
      <div>
        <label htmlFor="api-url">Adresse de l'API</label>
        <input
          id="api-url"
          type="url"
          inputMode="url"
          placeholder="https://monmeeting.mon-entreprise.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="api-token">Jeton d'API (si le serveur en exige un)</label>
        <input
          id="api-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <p className="muted small">Conservé uniquement dans ce navigateur.</p>
      </div>
      <div className="row">
        <button className="primary" onClick={() => void test()} disabled={testing}>
          {testing ? "Test…" : "Enregistrer et tester"}
        </button>
        <a className="btn" href="#/">
          Retour
        </a>
      </div>
      {status && <div className={`alert ${status.ok ? "info" : "error"}`}>{status.text}</div>}
    </div>
  );
}
