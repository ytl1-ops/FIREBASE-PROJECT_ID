/** Guide de prise en main, pensé d'abord pour le téléphone. */
const STEPS: { icon: string; title: string; body: string[] }[] = [
  {
    icon: "📲",
    title: "Installer l'application",
    body: [
      "Android (Chrome) : menu ⋮ → « Ajouter à l'écran d'accueil » → « Installer ».",
      "iPhone (Safari) : bouton Partager ⬆︎ → « Sur l'écran d'accueil ».",
      "Ouvrez ensuite MonMeeting depuis son icône : plein écran, utilisable hors ligne.",
      "Évitez d'ouvrir le lien depuis Telegram ou WhatsApp : leurs navigateurs intégrés sont limités.",
    ],
  },
  {
    icon: "🎙️",
    title: "Enregistrer une réunion",
    body: [
      "« Nouvelle réunion » → titre et participants (facultatif mais utile) → « Créer et enregistrer ».",
      "Autorisez le micro quand le téléphone le demande.",
      "Posez le téléphone au centre de la table, écran vers le haut ; gardez l'application ouverte.",
      "Pendant la réunion : ✎ Noter une décision, ★ Marquer un moment important.",
      "Vidéo : choisissez « Vidéo — caméra + microphone » dans « Source audio ».",
    ],
  },
  {
    icon: "📝",
    title: "Transcrire",
    body: [
      "Après « Terminer » → onglet Transcription → « Lancer la transcription ».",
      "« Mon API » (si configurée) : rapide et précis. « Sur cet appareil » : gratuit, choisissez la qualité « Rapide » ; le premier lancement télécharge le modèle (Wi-Fi conseillé).",
      "Indiquez le nombre d'intervenants, puis associez chaque « Locuteur » à un participant.",
      "Touchez un horodatage pour réécouter ; touchez un texte pour le corriger.",
    ],
  },
  {
    icon: "📄",
    title: "Rédiger PV, compte rendu, note, TBM",
    body: [
      "Onglet Documents → choisissez le type → « Rédiger ».",
      "Ajoutez si besoin des fichiers (PDF, Word) à synthétiser avec la réunion.",
      "Sans serveur ni clé : le mode autonome rédige directement sur le téléphone (extraction des décisions, actions, risques), sans rien envoyer.",
      "Option « IA locale » (PC récent) : un modèle d'IA téléchargé une fois rédige hors ligne.",
      "Relisez, modifiez (✎), puis exportez en Word.",
    ],
  },
  {
    icon: "📤",
    title: "Partager",
    body: [
      "Onglet Partager → un document Word, la transcription, l'audio ou la réunion complète (.monmeeting).",
      "Pour une réunion sensible, cochez « Chiffrer » et transmettez le mot de passe par un autre canal.",
      "Votre collègue ouvre le fichier avec « Importer une réunion » sur l'accueil.",
    ],
  },
  {
    icon: "🔒",
    title: "Bonnes pratiques",
    body: [
      "Informez les participants avant d'enregistrer et respectez la classification de la réunion.",
      "Les réunions restent dans ce téléphone : supprimez-les (Informations → Supprimer) quand elles ne sont plus utiles.",
      "Pensez à exporter ce qui doit être conservé : effacer les données du navigateur efface les réunions.",
    ],
  },
];

export function GuidePage() {
  return (
    <>
      <div className="card">
        <h1>Prise en main</h1>
        <p className="muted" style={{ margin: 0 }}>
          De l'installation sur téléphone au procès-verbal partagé, en six étapes.
        </p>
      </div>
      {STEPS.map((step, i) => (
        <details key={step.title} className="card guide-step" open={i === 0}>
          <summary>
            <span aria-hidden>{step.icon}</span> {i + 1}. {step.title}
          </summary>
          <ul>
            {step.body.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ))}
      <p style={{ textAlign: "center" }}>
        <a className="btn" href="#/">
          Commencer
        </a>
      </p>
    </>
  );
}
