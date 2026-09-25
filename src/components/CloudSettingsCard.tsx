import { useState } from "react";
import {
  CLOUD_PROVIDERS,
  getCloudSettings,
  saveCloudSettings,
  testCloud,
  type CloudProviderId,
} from "../lib/cloud.ts";
import { ENTERPRISE_MODE } from "../lib/config.ts";

/** Réglage de l'API d'IA gratuite (clé personnelle) : rédaction et transcription sans serveur. */
export function CloudSettingsCard() {
  const initial = getCloudSettings();
  const [provider, setProvider] = useState<CloudProviderId>(initial?.provider ?? "groq");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  if (ENTERPRISE_MODE) return null;
  const def = CLOUD_PROVIDERS.find((p) => p.id === provider) ?? CLOUD_PROVIDERS[0];

  async function save() {
    const settings = apiKey.trim() ? { provider, apiKey: apiKey.trim() } : null;
    saveCloudSettings(settings);
    if (!settings) {
      setStatus({ ok: true, text: "Clé supprimée." });
      return;
    }
    setTesting(true);
    setStatus(null);
    try {
      await testCloud(settings);
      setStatus({
        ok: true,
        text: `Clé valide (${def.label}). « Rédiger » et « Demander » fonctionnent${def.transcriptionModel ? ", ainsi que la transcription rapide" : ""}.`,
      });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h2>API d'IA gratuite (sans serveur, sans Claude)</h2>
        <p className="muted small">
          Collez une clé gratuite pour rédiger (PV, compte rendu, note, TBM), interroger la réunion
          et transcrire directement depuis cet appareil. Le texte et l'audio sont envoyés au
          fournisseur choisi : à éviter pour les réunions confidentielles.
        </p>
      </div>
      <div className="grid-2">
        <div>
          <label htmlFor="cloud-provider">Fournisseur</label>
          <select id="cloud-provider" value={provider} onChange={(e) => setProvider(e.target.value as CloudProviderId)}>
            {CLOUD_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            {def.note}
          </p>
        </div>
        <div>
          <label htmlFor="cloud-key">Clé d'API</label>
          <input
            id="cloud-key"
            type="password"
            autoComplete="off"
            placeholder="Collez votre clé ici"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="small" style={{ margin: "4px 0 0" }}>
            <a href={def.keyUrl} target="_blank" rel="noopener noreferrer">
              Obtenir une clé gratuite ({def.label.replace(/ \(.*\)/, "")}) ↗
            </a>{" "}
            <span className="muted">— conservée uniquement dans ce navigateur.</span>
          </p>
        </div>
      </div>
      <div className="row">
        <button className="primary" disabled={testing} onClick={() => void save()}>
          {testing ? "Vérification…" : "Enregistrer et vérifier"}
        </button>
      </div>
      {status && <div className={`alert ${status.ok ? "info" : "error"}`}>{status.text}</div>}
    </div>
  );
}
