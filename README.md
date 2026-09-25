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

## API d'IA gratuites : rédiger et transcrire sans serveur ni Claude

Réglages (⚙) → « API d'IA gratuite » : choisissez un fournisseur, créez une clé gratuite (lien
fourni) et collez-la. « Rédiger », « Demander » et la transcription fonctionnent alors
directement depuis le téléphone ou le PC.

| Fournisseur | Gratuit | Remarque |
|---|---|---|
| **Groq** (recommandé) | Rédaction (Llama 3.3 70B) + transcription Whisper large-v3 (≈ 8 h/jour) | Sans carte bancaire, très rapide |
| Google Gemini | Modèles Flash | Idéal pour les très longues réunions ; données du palier gratuit utilisées par Google |
| Mistral AI | Palier « Experiment » | Bon français ; entraînement sur vos données exigé |
| OpenRouter | Modèles « :free » (≈ 50 requêtes/jour) | Grand choix |

Les longues réunions sont découpées automatiquement pour respecter les quotas gratuits, et
l'application patiente puis réessaie si le quota par minute est atteint. Le texte et l'audio
partent chez le fournisseur choisi : à éviter pour les réunions confidentielles (fonction
retirée en mode entreprise).

## « Mon API » : tout en local, sans dépendre d'un service d'IA

« Mon API » fait tourner la transcription (faster-whisper + identification des voix sherpa-onnx)
et la rédaction (modèle libre via Ollama : Qwen 2.5, Mistral…) **sur votre propre machine**.
Aucune donnée ne part chez un tiers ; aucun abonnement.

**Sans serveur, votre PC suffit** (16 Go de RAM conseillés) :

1. Installez [Docker Desktop](https://www.docker.com/products/docker-desktop/) et démarrez-le.
2. Téléchargez ce dépôt, puis double-cliquez sur **`demarrer-monmeeting.bat`**
   (Mac/Linux : `scripts/demarrer-monmeeting.sh`). Le premier lancement télécharge les modèles
   (plusieurs Go, 10 à 30 min).
3. Le script affiche un **lien pour les téléphones** (adresse https temporaire + jeton) : ouvrez-le
   sur chaque téléphone, l'application se connecte automatiquement. Il est aussi enregistré dans
   `lien-telephone.txt` et change à chaque redémarrage.

Le PC doit rester allumé pendant l'utilisation. Pour un service permanent, installez la même
pile sur un serveur (voir [SECURITE.md](SECURITE.md), section 5).

| Composant | Rôle |
|---|---|
| `server/` | API et interface : rédaction (`/api/generate`, `/api/ask`), transcription par tâches (`/api/transcribe`) |
| `asr/` | Service Python de transcription et d'identification des voix |
| `docker-compose.yml` | Pile complète : interface + API, ASR, Ollama, tunnel https facultatif |

## Développement

Prérequis : Node.js 22+. `npm install`, `cp .env.example .env`, puis `npm run dev`
(http://localhost:5173). Tests : `npm test` et `cd asr && python -m pytest`.

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
(par exemple `npx gh-pages -d docs --dotfiles`).

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

Voir [`.env.example`](.env.example) : jeton d'API, origines autorisées, modèle Ollama, modèle
Whisper. Claude (Anthropic) et Gladia restent disponibles en option, jamais par défaut.

## Sécurité et usage professionnel

Revue complète, risques résiduels et configuration recommandée : **[SECURITE.md](SECURITE.md)**.
Build « entreprise » (aucune fonction ne transmet de données hors de l'organisation) :
`npm run build:entreprise`.

## Poids des fichiers

Réglage « Taille des fichiers » à l'enregistrement (mesures réelles, par heure) :

| Réglage | Audio | Vidéo caméra |
|---|---|---|
| **Économe** (par défaut) | ≈ 2 à 4 Mo | ≈ 20 à 60 Mo |
| Standard | ≈ 5 à 7 Mo | ≈ 55 à 150 Mo |
| Haute qualité | ≈ 10 à 15 Mo | ≈ 285 Mo |

Réunions partagées `.monmeeting` : compressées, à peine plus lourdes que l'enregistrement.

## Où sont stockées les données

**Sur votre téléphone ou votre ordinateur, jamais sur un serveur.** Réglages (⚙) → « Stockage
sur cet appareil » :
- **stockage permanent** : le navigateur ne peut plus effacer les réunions faute de place ;
- **dossier de sauvegarde automatique** (ordinateur, Chrome/Edge) : chaque réunion est recopiée
  en fichier dans le dossier choisi ;
- **sauvegarde complète** en un fichier `.mmbackup` (chiffrement facultatif) et **restauration**,
  par exemple pour changer de téléphone.

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
