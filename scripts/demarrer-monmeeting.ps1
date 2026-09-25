# Démarre MonMeeting sur ce PC (Windows) : interface, transcription et rédaction 100 % locales,
# plus une adresse https temporaire pour les téléphones. Prérequis : Docker Desktop.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "=== MonMeeting : démarrage ===" -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker Desktop n'est pas installé : https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
  Start-Process "https://www.docker.com/products/docker-desktop/"
  Read-Host "Installez-le, redémarrez le PC, puis relancez ce script. Entrée pour quitter"
  exit 1
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Démarrez Docker Desktop (icône de la baleine), attendez qu'il soit prêt, puis relancez." -ForegroundColor Yellow
  Read-Host "Entrée pour quitter"
  exit 1
}

# Jeton d'API aléatoire, généré une seule fois et conservé dans .env (jamais publié).
if (-not (Test-Path ".env")) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  "MONMEETING_API_TOKEN=$token" | Out-File -Encoding ascii ".env"
}
$token = (Select-String -Path ".env" -Pattern "^MONMEETING_API_TOKEN=(.+)$").Matches[0].Groups[1].Value

Write-Host "Construction et démarrage (le premier lancement télécharge plusieurs Go : 10 à 30 min)..."
docker compose --profile partage up -d --build
if ($LASTEXITCODE -ne 0) { Read-Host "Échec du démarrage. Entrée pour quitter"; exit 1 }

Write-Host "Recherche de l'adresse https publique..."
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 2
  $m = (docker compose logs tunnel 2>&1 | Out-String) | Select-String -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches
  if ($m) { $url = $m.Matches[-1].Value }
}

Write-Host ""
Write-Host "=== MonMeeting est prêt ===" -ForegroundColor Green
Write-Host "Sur ce PC : http://localhost:8787"
if ($url) {
  $link = "$url/#/reglages?jeton=$token"
  Write-Host "Sur les téléphones, ouvrez ce lien (il connecte l'application automatiquement) :"
  Write-Host "  $link" -ForegroundColor Yellow
  Set-Content -Path "lien-telephone.txt" -Value $link
  Write-Host "(lien également enregistré dans lien-telephone.txt ; il change à chaque redémarrage)"
} else {
  Write-Host "Adresse publique non obtenue : consultez « docker compose logs tunnel »."
}
Write-Host "Le modèle de rédaction se télécharge en arrière-plan : « docker compose logs -f ollama-init »."
Start-Process "http://localhost:8787"
Read-Host "Entrée pour fermer cette fenêtre (MonMeeting continue de fonctionner)"
