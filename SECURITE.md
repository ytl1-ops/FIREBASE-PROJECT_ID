# MonMeeting — Revue de sécurité pour un usage professionnel (MSC)

*Revue du 25 septembre 2026, portant sur le code de ce dépôt (application web/téléphone, API
MonMeeting, service de transcription). À faire valider par la DSI / le RSSI avant mise en
production.*

## 1. Synthèse

| Verdict | Détail |
|---|---|
| **Utilisable en pilote** | Version autonome et « Mon API » en **mode entreprise**, hébergées sur l'infrastructure de MSC, pour des réunions jusqu'à « Diffusion restreinte ». |
| **Conditions avant généralisation** | Authentification SSO devant l'API (R1), hébergement interne au lieu de GitHub Pages / tunnel public (R2), chiffrement des terminaux par MDM (R4), AIPD et information des participants (R5). |
| **À proscrire** | Réunions « Confidentiel » / « Secret » avec le mode Claude.ai ou un tunnel public ; ce mode est retiré par le build « entreprise ». |

## 2. Architecture et flux de données

```
Téléphone / PC (navigateur ou application)            Serveur MSC (« Mon API », Docker)
┌───────────────────────────────────────────┐  HTTPS  ┌──────────────────────────────────────┐
│ Enregistrement audio/vidéo                │ ──────► │ API Node (jeton, CORS, limites)       │
│ Réunions, transcriptions, documents       │         │  ├─ Rédaction : Ollama (modèle libre) │
│   → stockés dans le navigateur (IndexedDB)│ ◄────── │  └─ Transcription : faster-whisper    │
│ Transcription sur l'appareil (facultatif) │         │      + sherpa-onnx (voix)             │
└───────────────────────────────────────────┘         └──────────────────────────────────────┘
      Aucun stockage central des réunions ; le serveur ne conserve rien après traitement.
```

| Donnée | Où | Durée |
|---|---|---|
| Audio/vidéo, transcriptions, documents | Navigateur de l'utilisateur (IndexedDB) | Jusqu'à suppression par l'utilisateur |
| Audio envoyé pour transcription | Fichier temporaire du serveur | Supprimé dès la fin du traitement |
| Résultat de transcription | Mémoire du serveur | Remis une fois, sinon purgé après 6 h |
| Texte envoyé pour rédaction | Mémoire du serveur / Ollama | Durée de la requête |
| Journaux serveur | Sortie standard des conteneurs | Erreurs uniquement, **sans contenu de réunion** |

**Aucun service d'IA externe** n'est utilisé par « Mon API » (Ollama et Whisper tournent sur le
serveur). Les seules sorties vers Internet, toutes désactivables, sont :
1. le mode « Claude.ai » (copier-coller manuel) et les **API d'IA gratuites** (Groq, Gemini, Mistral, OpenRouter : texte et audio envoyés au fournisseur, clé stockée dans le navigateur) — **tous deux retirés en mode entreprise** ;
2. le téléchargement des modèles Whisper (transcription) et Qwen2.5 (« IA locale ») depuis Hugging Face pour le
   traitement *sur l'appareil* (modèles uniquement, jamais de données de réunion) — voir R3.
   Le moteur autonome « extraction » (rédaction et questions) n'utilise aucun modèle ni réseau ;
3. le fournisseur Gladia, désactivé par défaut côté serveur.

## 3. Contrôles en place (vérifiés)

| Domaine | Mesure | Vérification |
|---|---|---|
| Accès à l'API | Jeton Bearer (`MONMEETING_API_TOKEN`, 256 bits générés par le lanceur), comparaison à temps constant | Code `server/index.ts` |
| Origines | CORS restreint à `ALLOWED_ORIGINS` ; pré-requêtes refusées (403) sinon | Code |
| Exposition réseau | Conteneur lié à `127.0.0.1` ; ASR et Ollama non exposés | `docker-compose.yml` |
| Abus | Limitation à 20 requêtes/min/IP sur rédaction et transcription | Code |
| Entrées | JSON ≤ 32 Mo ; un seul fichier audio/vidéo (type MIME contrôlé) ≤ 2 Go ; nom de fichier temporaire aléatoire ; champs bornés (langues, nombre d'intervenants, vocabulaire) | Code |
| Erreurs | Messages génériques, pas de pile d'appels ni de détail interne | Code |
| En-têtes HTTP | CSP stricte, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS derrière TLS, COOP, `Permissions-Policy` | Code |
| Interface | CSP aussi injectée dans la version publiée ; aucun script tiers ; aucun `eval` ; rendu Markdown maison qui échappe tout HTML (test automatisé) | `vite.config.ts`, `tests/markdown.test.ts` |
| Moteur IA local | Moteur ONNX servi par l'application (plus de CDN jsDelivr) ; exécution validée sous CSP stricte dans Chromium | Test navigateur |
| Partage | Fichier `.monmeeting` chiffré AES-256-GCM, clé PBKDF2-SHA-256 (600 000 itérations), nom de fichier neutre ; refus si mot de passe faux ou fichier altéré | `tests/share.test.ts` |
| Dépendances | `npm audit` : 0 vulnérabilité ; `pip-audit` : 0 (python-multipart mis à jour de 0.0.20 à 0.0.32, 8 avis corrigés) | Commandes d'audit |
| Mode entreprise | `npm run build:entreprise` / `VITE_MODE_ENTREPRISE=1` : masque toute fonction transmettant des données hors de MSC | `src/lib/config.ts` |

## 4. Risques résiduels et recommandations

| # | Risque | Niveau | Recommandation |
|---|---|---|---|
| R1 | Le jeton d'API est **partagé** : il n'identifie pas l'utilisateur et ne permet ni révocation individuelle ni traçabilité. | Élevé si exposé à Internet | Publier « Mon API » **derrière le SSO MSC** (Entra ID via Azure App Proxy, ou oauth2-proxy) et la réserver au réseau interne / VPN. Conserver le jeton en seconde barrière. |
| R2 | Hébergement public : GitHub Pages (code et application accessibles par quiconque a le lien) et tunnel Cloudflare « Quick Tunnel » (adresse publique, sans SLA). | Moyen | En production : servir l'application **par « Mon API » sur un serveur interne** (même origine, aucune donnée sur GitHub). Réserver le tunnel aux essais. |
| R3 | La transcription *sur l'appareil* télécharge les modèles depuis Hugging Face (flux sortant vers un tiers, possiblement bloqué par le proxy MSC). | Faible (aucune donnée de réunion) | Réglages → « Serveur de modèles » : pointer vers un **miroir interne** des modèles ; ou privilégier la transcription par « Mon API ». |
| R4 | Les réunions sont stockées **en clair dans le navigateur** du terminal (ainsi que dans le dossier de sauvegarde automatique s'il est activé) ; une perte ou un vol de terminal non chiffré les expose. | Élevé sur terminal non géré | Terminaux gérés par **MDM** avec chiffrement et verrouillage ; dossier de sauvegarde sur un volume chiffré (BitLocker) ; sauvegardes complètes **chiffrées** ; purge régulière (Informations → Supprimer). |
| R5 | Enregistrer une réunion est un traitement de données personnelles (voix, propos) : consentement, information et finalité obligatoires (RGPD, nLPD suisse, et en France l'article 226-1 du Code pénal pour l'enregistrement de paroles à titre privé sans consentement). | Juridique | Réaliser une **AIPD**, inscrire le traitement au registre, informer les participants avant chaque enregistrement, fixer une durée de conservation. |
| R6 | Les documents générés peuvent contenir des erreurs ou omissions (IA). | Moyen | Validation humaine obligatoire (mention déjà apposée sur chaque document) ; ne pas diffuser sans relecture. |
| R7 | Injection d'instructions via une pièce jointe ou un propos (« ignore les consignes… »). | Faible | Le modèle ne dispose d'aucun outil ni accès : l'impact se limite au texte produit, relu par un humain. |
| R8 | Jeton d'API : quand l'application est servie par « Mon API », il est échangé contre un **cookie de session httpOnly SameSite=Strict** et n'est plus conservé par le navigateur. Seul le cas « application GitHub Pages + serveur distant » le garde en stockage local. | Faible | Atténué par la CSP ; en entreprise, servir l'application par « Mon API » (même origine) ou derrière le SSO (R1). |
| R9 | Limitation de débit et suivi des tâches en mémoire (une seule instance). | Faible | Suffisant pour un service interne ; derrière un répartiteur de charge, déplacer ces états dans Redis. |
| R10 | Mises à jour de sécurité des dépendances et images (Ollama, Python, Node). | Continu | Rebuild mensuel des images, `npm audit` / `pip-audit` dans la chaîne CI, abonnement aux avis de sécurité. |

## 5. Configuration recommandée pour MSC

```bash
# Serveur interne (VM Linux, 8 vCPU / 16 Go RAM minimum ; GPU conseillé pour la rédaction)
cp .env.example .env            # puis :
#   MONMEETING_API_TOKEN=<secret 64 caractères hex>
#   ALLOWED_ORIGINS=https://monmeeting.intranet.msc.example
#   OLLAMA_MODEL=qwen2.5:7b      (ou mistral-nemo, plus fidèle en français, 16 Go RAM)
docker compose build --build-arg VITE_MODE_ENTREPRISE=1 app
docker compose up -d            # sans le profil « partage » : pas de tunnel public
# Publier le port 8787 derrière le reverse proxy HTTPS + SSO de MSC.
```

## 6. Procédure de vérification rejouable

```bash
npm test && npm run typecheck                     # 29 tests (dont chiffrement, échappement HTML, moteur autonome)
(cd asr && python -m pytest -q)                   # 6 tests du service de transcription
npm audit --omit=dev && pip-audit -r asr/requirements.txt
curl -s localhost:8787/api/generate -X POST        # → 401 sans jeton
curl -s -H "Origin: https://inconnu.example" -X OPTIONS localhost:8787/api/ask -o /dev/null -w "%{http_code}"  # → 403
```

## 7. Revue selon ECC (Everything Claude Code)

Revue du 25 septembre 2026 avec les listes de contrôle d'ECC (`security-reviewer`,
`typescript-reviewer`, `react-reviewer`, `fastapi-reviewer`, `silent-failure-hunter`,
règles `web/security` et `react/security`) et les outils qu'elles préconisent.

| Outil / contrôle | Résultat |
|---|---|
| ESLint (typescript-eslint typé, `eslint-plugin-security`, `react-hooks`, `jsx-a11y`) | 23 erreurs corrigées → **0 erreur** ; avertissements restants = faux positifs vérifiés (accès `objet[clé]` typés, expressions régulières bornées testées) |
| Promesses non gérées, règles des hooks React | Aucune |
| ReDoS (expressions régulières) | 2 expressions de l'analyseur Markdown réécrites en temps linéaire ; tests d'entrées malveillantes (`tests/redos.test.ts`) |
| XSS (`dangerouslySetInnerHTML`, `document.write`) | Rendu Markdown maison qui échappe tout HTML, aucune URL générée ; titre de la fenêtre d'impression échappé |
| Jeton en `localStorage` (CRITIQUE selon ECC) | Remplacé par un cookie httpOnly en même origine (voir R8) |
| Entrées serveur | Champs multipart typés et bornés ; taille maximale aussi imposée au service Python (413) |
| Journalisation sécurité | Accès refusés, origines refusées, limites de débit journalisés (sans secret ni contenu) |
| Accessibilité | Onglets `role="tablist"` corrects, groupe « Participants » en `fieldset`, **sous-titres WebVTT** générés depuis la transcription pour les lecteurs audio/vidéo |
| Python : Ruff (`S`, `B`, `ASYNC`…) et Bandit | **0 problème** |
| Dépendances : `npm audit`, `pip-audit` | **0 vulnérabilité** |
| Secrets dans le dépôt | Aucun fichier sensible suivi (`.env` ignoré) |

Rejouer l'analyse ESLint (TypeScript 7 n'étant pas encore pris en charge par typescript-eslint,
l'outil s'installe à part) : voir `scripts/verifier-eslint.sh`.
