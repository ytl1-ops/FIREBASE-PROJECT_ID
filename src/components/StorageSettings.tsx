import { useEffect, useRef, useState } from "react";
import {
  backupAllToFolder,
  chooseBackupFolder,
  exportFullBackup,
  folderBackupSupported,
  folderReady,
  forgetBackupFolder,
  getBackupFolder,
  importFullBackup,
  requestPersistentStorage,
  storageStatus,
  type StorageStatus,
} from "../lib/backup.ts";
import { PasswordRequiredError } from "../lib/share.ts";

/** Réglages « Stockage sur cet appareil » : persistance, dossier de sauvegarde, sauvegarde complète. */
export function StorageSettings() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [folder, setFolder] = useState<{ name: string; ready: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    setStatus(await storageStatus());
    const dir = await getBackupFolder();
    setFolder(dir ? { name: dir.name, ready: await folderReady(dir) } : null);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await action() });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <div className="stack">
      <div>
        <h2>Stockage sur cet appareil</h2>
        <p className="muted small">
          Vos réunions sont enregistrées uniquement sur ce téléphone ou cet ordinateur, jamais sur
          un serveur.
        </p>
      </div>

      {status && (
        <p className="small" style={{ margin: 0 }}>
          Espace utilisé : <strong>{status.usedMo} Mo</strong> sur {status.quotaMo.toLocaleString("fr-FR")} Mo
          disponibles ·{" "}
          {status.persisted ? (
            <span className="badge green">stockage permanent</span>
          ) : (
            <span className="badge orange">peut être effacé si l'appareil manque de place</span>
          )}
        </p>
      )}
      {status && !status.persisted && (
        <div>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () =>
                (await requestPersistentStorage())
                  ? "Stockage permanent activé : le navigateur n'effacera plus vos réunions."
                  : "Le navigateur a refusé pour l'instant. Installez l'application (écran d'accueil) puis réessayez ; faites aussi des sauvegardes.",
              )
            }
          >
            🔒 Rendre le stockage permanent
          </button>
        </div>
      )}

      {folderBackupSupported() && (
        <div className="card" style={{ margin: 0 }}>
          <h3>Dossier de sauvegarde automatique (ordinateur)</h3>
          <p className="muted small">
            Chaque réunion (audio, transcription, documents) est recopiée automatiquement en fichier
            .monmeeting dans le dossier choisi, par exemple Documents\MonMeeting.
          </p>
          {folder ? (
            <div className="row">
              <span>
                📁 <strong>{folder.name}</strong>{" "}
                {folder.ready ? <span className="badge green">actif</span> : <span className="badge orange">à réactiver</span>}
              </span>
              {!folder.ready && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const dir = await getBackupFolder();
                      if (!dir || !(await folderReady(dir, true))) throw new Error("Accès au dossier refusé.");
                      return "Sauvegarde automatique réactivée.";
                    })
                  }
                >
                  Réactiver
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => void run(async () => `${await backupAllToFolder()} réunion(s) copiée(s) dans le dossier.`)}
              >
                Sauvegarder tout maintenant
              </button>
              <button className="ghost" disabled={busy} onClick={() => void run(async () => (await forgetBackupFolder(), "Dossier oublié (les fichiers déjà copiés restent en place)."))}>
                Arrêter
              </button>
            </div>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await chooseBackupFolder();
                  const n = await backupAllToFolder();
                  return `Dossier choisi : ${n} réunion(s) copiée(s). Les prochaines le seront automatiquement.`;
                })
              }
            >
              📁 Choisir le dossier de sauvegarde
            </button>
          )}
        </div>
      )}

      <div className="card" style={{ margin: 0 }}>
        <h3>Sauvegarde complète (téléphone et ordinateur)</h3>
        <p className="muted small">
          Toutes vos réunions dans un seul fichier, à conserver sur l'appareil (Téléchargements,
          Fichiers) ou sur une clé USB. Pour changer de téléphone : sauvegardez, puis restaurez sur
          le nouvel appareil.
        </p>
        <div className="row">
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              const password = window.prompt("Mot de passe pour chiffrer la sauvegarde (laisser vide : non chiffrée) :");
              if (password === null) return; // annulé
              if (password !== "" && password.length < 8) {
                setMessage({ ok: false, text: "Mot de passe trop court (8 caractères minimum)." });
                return;
              }
              void run(async () => `${await exportFullBackup(password || undefined)} réunion(s) sauvegardée(s).`);
            }}
          >
            ⤓ Sauvegarder toutes les réunions
          </button>
          <button disabled={busy} onClick={() => restoreInput.current?.click()}>
            ⤒ Restaurer une sauvegarde
          </button>
          <input
            ref={restoreInput}
            type="file"
            accept=".mmbackup,application/octet-stream"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void run(async () => {
                try {
                  return `${await importFullBackup(file)} réunion(s) restaurée(s).`;
                } catch (err) {
                  if (!(err instanceof PasswordRequiredError)) throw err;
                  const password = window.prompt("Sauvegarde chiffrée. Mot de passe :");
                  if (!password) throw new Error("Restauration annulée.");
                  return `${await importFullBackup(file, password)} réunion(s) restaurée(s).`;
                }
              });
            }}
          />
        </div>
      </div>

      {message && <div className={`alert ${message.ok ? "info" : "error"}`}>{message.text}</div>}
    </div>
  );
}
