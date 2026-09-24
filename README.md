# MonMeeting

Application web (installable sur ordinateur et mobile) pour **enregistrer fidèlement vos réunions**
et en tirer des documents professionnels en français : **procès-verbal, compte rendu, note de
synthèse, TBM (Tool Box Meeting / causerie sûreté) et relevé de décisions**.

Pensée pour les responsables sûreté, institutions internationales et organisations qui suivent des
situations sécuritaires : mention de classification sur chaque document, données conservées dans
le navigateur, rédaction qui n'invente rien et signale les passages à vérifier.

## Fonctionnalités

| Étape | Ce que fait MonMeeting |
|---|---|
| **Enregistrer** | Micro (réunion en salle) ou micro + audio de l'onglet (Teams, Zoom, Meet). Sauvegarde toutes les 5 s (une coupure ne fait pas perdre la réunion), pause/reprise, écran maintenu allumé, choix du micro, vumètre. |
| **Annoter** | Notes horodatées et marque-pages ★ en un clic pendant la réunion ; intervenant en cours sélectionnable. |
| **Transcrire** | Aperçu en direct (reconnaissance vocale du navigateur, gratuite), puis **transcription haute fidélité avec séparation des voix** (diarisation, 10 langues, vocabulaire métier : noms, sigles, lieux). Import des transcriptions Teams/Zoom/Meet (`.vtt`, `.srt`, `.txt`). |
| **Relire** | Association « Locuteur N → participant », lecture synchronisée (clic sur l'horodatage), correction du texte, recherche, temps de parole par intervenant. |
| **Rédiger** | PV, compte rendu, note de synthèse (BLUF), TBM, relevé de décisions — diffusés en direct, modifiables, consignes complémentaires possibles. |
| **Exporter** | Word (.docx avec bandeau de classification et numéros de page), PDF (impression), Markdown, transcription texte, audio. |
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
| Transcription | Aperçu en direct du navigateur (Chrome/Edge) · import des transcriptions générées par Teams, Zoom ou Meet | `GLADIA_API_KEY` — transcription de l'audio complet avec séparation des voix (Gladia, société française, hébergement UE ; consultez leur offre gratuite éventuelle) |
| Rédaction des documents et questions | Bouton **« Mode gratuit (Claude.ai) »** : la demande complète est copiée, vous la collez dans votre compte Claude.ai gratuit et recollez le document obtenu dans MonMeeting | `ANTHROPIC_API_KEY` — rédaction directement dans l'application (facturation à l'usage, de l'ordre de quelques dizaines de centimes par document pour une réunion d'une heure) |

L'hébergement reste gratuit tant que l'application tourne sur votre propre ordinateur.

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
src/       Interface React (enregistreur, transcription, documents, questions)
server/    Serveur Express : /api/generate, /api/ask (flux SSE), /api/transcribe, /api/health
shared/    Types, modèles de documents, prompts et outils de transcription communs
tests/     Tests unitaires (npm test)
```

Commandes utiles : `npm run typecheck`, `npm test`, `npm run build`.
