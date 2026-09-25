#!/bin/sh
# Démarre MonMeeting sur ce Mac / Linux : interface, transcription et rédaction 100 % locales,
# plus une adresse https temporaire pour les téléphones. Prérequis : Docker.
set -eu
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo "Installez Docker : https://www.docker.com/products/docker-desktop/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Démarrez Docker puis relancez."; exit 1; }

if [ ! -f .env ]; then
  echo "MONMEETING_API_TOKEN=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')" > .env
  chmod 600 .env
fi
TOKEN=$(sed -n 's/^MONMEETING_API_TOKEN=//p' .env)

echo "Démarrage (le premier lancement télécharge plusieurs Go)…"
docker compose --profile partage up -d --build

URL=""
for _ in $(seq 1 60); do
  URL=$(docker compose logs tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
  [ -n "$URL" ] && break
  sleep 2
done
echo
echo "MonMeeting est prêt — sur cet ordinateur : http://localhost:8787"
if [ -n "$URL" ]; then
  echo "Sur les téléphones : $URL/#/reglages?jeton=$TOKEN"
  echo "$URL/#/reglages?jeton=$TOKEN" > lien-telephone.txt
fi
