# MonMeeting

### ▶ [Ouvrir l'application](https://ytl1-ops.github.io/FIREBASE-PROJECT_ID/) — https://ytl1-ops.github.io/FIREBASE-PROJECT_ID/

Aucun compte ni installation : ouvrez le lien dans Chrome, Edge ou Safari (ordinateur ou
téléphone). Sur téléphone, « Ajouter à l'écran d'accueil » installe l'application.
Vos réunions restent enregistrées dans votre propre navigateur.

Application web (installable sur ordinateur et mobile) pour **enregistrer fidèlement vos réunions**
et en tirer des documents professionnels en français : **procès-verbal, compte rendu, note de
synthèse, TBM (Tool Box Meeting / causerie sûreté) et relevé de décisions**.

Pensée pour les responsables sûreté, institutions internationales et organisations qui suivent des
situations sécuritaires : mention de classification sur chaque document, données conservées dans
le navigateur, rédaction qui n'invente rien et signale les passages à vérifier.

## Fonctionnalités

| Étape | Ce que fait MonMeeting |
|---|---|
| **Enregistrer** | Audio : micro (réunion en salle) ou micro + son de l'onglet (Teams, Zoom, Meet). **Film** : caméra + micro, ou écran partagé + micro + son. Sauvegarde toutes les 5 s (une coupure ne fait pas perdre la réunion), pause/reprise, écran maintenu allumé, choix du micro, vumètre. |
| **Annoter** | Notes horodatées et marque-pages ★ en un clic pendant la réunion ; intervenant en cours sélectionnable. |
| **Transcrire** | Aperçu en direct (reconnaissance vocale du navigateur), puis **transcription complète avec séparation des voix** : soit **sur l'appareil, gratuitement et hors ligne** (Whisper + empreintes vocales WavLM, l'audio ne quitte pas l'ordinateur), soit via le service Gladia. Import des transcriptions Teams/Zoom/Meet (`.vtt`, `.srt`, `.txt`). |
| **Relire** | Association « Locuteur N → participant », lecture synchronisée (clic sur l'horodatage), correction du texte, recherche, temps de parole par intervenant. |
| **Synthétiser des fichiers** | PDF (lus avec leur mise en page), Word (.docx) et texte, joints à une réunion ou seuls (« Synthétiser des fichiers » sur l'accueil). |
| **Rédiger** | PV, compte rendu, note de synthèse (BLUF), TBM, relevé de décisions — diffusés en direct, modifiables, consignes complémentaires possibles. |
| **Exporter** | Word (.docx avec bandeau de classification et numéros de page), PDF (impression), Markdown, transcription texte, audio. |
| **Partager** | Fichier de réunion complète `.monmeeting` (chiffrement AES-256 facultatif par mot de passe) à importer dans le MonMeeting d'un collègue ; partage des documents Word, de la transcription et de l'audio via le menu de partage de l'appareil (Mail, Signal, WhatsApp, Teams…). Aucun stockage en ligne. |
| **Demander** | « Demandez à votre réunion » : questions libres avec réponses sourcées par horodatage (décisions, actions, risques, e-mail de suivi…). |

## Démarrage rapide (usage personnel, sur votre ordinateur)

Prérequis : [Node.js](https://nodejs.org) 22 ou plus récent.

```bash
npm install
cp .env.example .env      # puis renseignez les clés souhaitées (toutes facultatives)
npm run dev               # http://localhost:5173
```

Pour une version optimisée : `npm run build && npm start` (http://localhost:8787).

Utilisez **Chrome ou Edge** pour bénéficier de l'aperçu de transcription en direct et de la
capture audio des visioconférences.

## Utiliser MonMeeting gratuitement

Toutes les fonctions d'enregistrement, d'annotation, d'import, de relecture et d'export sont
gratuites et fonctionnent **sans aucune clé**. Seuls deux services externes sont optionnels :

| Besoin | Option gratuite | Option payante (qualité maximale) |
|---|---|---|
| Transcription | **Sur cet appareil** (Whisper, identification des voix, hors ligne après le premier téléchargement du modèle) · aperçu en direct · import Teams/Zoom/Meet | `GLADIA_API_KEY` — transcription de l'audio complet avec séparation des voix (Gladia, société française, hébergement UE ; consultez leur offre gratuite éventuelle) |
| Rédaction des documents et questions | Bouton **« Mode gratuit (Claude.ai) »** : la demande complète est copiée, vous la collez dans votre compte Claude.ai gratuit et recollez le document obtenu dans MonMeeting | `ANTHROPIC_API_KEY` — rédaction directement dans l'application (facturation à l'usage, de l'ordre de quelques dizaines de centimes par document pour une réunion d'une heure) |

L'hébergement reste gratuit : sur votre ordinateur, ou en ligne en version autonome (voir ci-dessous).

## Version web et application téléphone

| Version | Comment l'obtenir |
|---|---|
| **Web** | Publiée sur Netlify (ci-dessous). Sur téléphone, menu du navigateur → « Ajouter à l'écran d'accueil » : l'application s'installe et fonctionne hors ligne. |
| **Android** | `npm run build:web && npx cap sync android && npx cap open android`, puis dans Android Studio : *Build → Generate Signed App Bundle / APK*. L'APK s'installe directement sur les téléphones du cercle. |
| **iOS** | Sur un Mac : `npm run build:web && npx cap sync ios && npx cap open ios`, puis Xcode (compte Apple Developer requis ; diffusion au cercle via TestFlight). |

Dans l'application téléphone, micro, caméra et partage passent par les fonctions natives
(feuille de partage Android/iOS).

## Mise à jour du lien GitHub Pages

Le site est publié depuis la branche `gh-pages` (GitHub Pages activé sur cette branche). Après une
modification du code : `npm run build:pages`, puis publiez le contenu de `docs/` sur `gh-pages`
(par exemple `git subtree push --prefix docs origin gh-pages`).

## Partager l'application avec un cercle restreint

La **version autonome** (sans serveur) se publie gratuitement sur Netlify grâce au fichier
`netlify.toml` fourni : transcription sur l'appareil, rédaction via Claude.ai, partage par fichiers.
Chaque utilisateur conserve ses réunions dans son propre navigateur ; l'hébergeur ne reçoit aucune
donnée de réunion. Le site n'est pas référencé par les moteurs de recherche (`noindex`) : ne
diffusez l'adresse qu'à votre cercle.

1. Le projet Netlify **monmeeting-7k3q** est déjà créé
   ([tableau de bord](https://app.netlify.com/projects/monmeeting-7k3q)). Dans *Project configuration →
   Build & deploy → Link repository*, reliez ce dépôt GitHub et sa branche : les réglages de build
   sont lus dans `netlify.toml`, et chaque mise à jour du dépôt republie le site.
   (Ou, depuis votre ordinateur : `npm install && npm run build:web && npx netlify-cli deploy --prod --dir dist --site monmeeting-7k3q`.)
2. Partagez l'adresse obtenue. Chacun peut « installer » l'application depuis son navigateur.

Pour la rédaction automatique partagée (clé API côté serveur), hébergez plutôt le serveur Node
(`npm run build && npm start`) sur une machine ou un service qui accepte les réponses longues.

## Configuration (`.env`)

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | Rédaction des documents et « Demandez à votre réunion ». |
| `GLADIA_API_KEY` | Transcription haute fidélité avec diarisation. |
| `MONMEETING_MODEL` | Modèle de rédaction (défaut : `claude-opus-5`). |
| `PORT` | Port du serveur (défaut : 8787). |

## Confidentialité

- Audio, transcriptions et documents sont stockés **uniquement dans le navigateur** (IndexedDB).
- Le serveur ne conserve rien : l'audio envoyé pour transcription est supprimé dès la fin du
  traitement ; les textes ne transitent vers les services de transcription et de rédaction qu'au
  moment où vous le demandez.
- Pour des réunions classifiées, n'activez pas les services externes : utilisez l'enregistrement,
  les notes et la saisie manuelle.

## Architecture

```
src/       Interface React (enregistreur, transcription, documents, questions, partage)
src/lib/local/  Transcription locale (Whisper + WavLM dans un Web Worker)
server/    Serveur Express : /api/generate, /api/ask (flux SSE), /api/transcribe, /api/health
shared/    Types, modèles de documents, prompts et outils de transcription communs
tests/     Tests unitaires (npm test)
```

Commandes utiles : `npm run typecheck`, `npm test`, `npm run build`.
