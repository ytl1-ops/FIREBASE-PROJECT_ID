# Démarre MonMeeting sur ce PC (Windows) : interface, transcription et rédaction 100 % locales,
# plus une adresse https temporaire pour les téléphones. Prérequis : Docker Desktop.
# « Continue » : Docker écrit sa progression sur la sortie d'erreur, ce qui interromprait
# Windows PowerShell 5.1 en mode « Stop ». Les échecs sont testés via $LASTEXITCODE.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)
# Journal de tout ce qui s'affiche, pour le diagnostic (demarrage.log, à côté du .bat).
try { Start-Transcript -Path (Join-Path (Get-Location) "demarrage.log") -Force | Out-Null } catch { }
trap {
  Write-Host ""
  Write-Host "ERREUR : $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Envoyez une capture de cette fenêtre (ou le fichier demarrage.log)."
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}

Write-Host "=== MonMeeting : démarrage ===" -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker Desktop n'est pas installé : https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
  Start-Process "https://www.docker.com/products/docker-desktop/"
  Write-Host "Installez-le, redémarrez le PC, puis relancez demarrer-monmeeting.bat."
  exit 1
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Démarrez Docker Desktop (icône de la baleine), attendez qu'il soit prêt, puis relancez." -ForegroundColor Yellow
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

# Modèles adaptés à la mémoire du PC (Docker Desktop en utilise environ la moitié).
if (-not (Select-String -Path ".env" -Pattern "^OLLAMA_MODEL=" -Quiet)) {
  $ramGo = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
  if ($ramGo -ge 24) { $llm = "qwen2.5:7b"; $whisper = "small" }
  elseif ($ramGo -ge 12) { $llm = "qwen2.5:3b"; $whisper = "small" }
  else { $llm = "qwen2.5:1.5b"; $whisper = "base" }
  Add-Content -Path ".env" -Encoding ascii -Value "OLLAMA_MODEL=$llm"
  Add-Content -Path ".env" -Encoding ascii -Value "WHISPER_MODEL=$whisper"
  Write-Host "Mémoire détectée : $ramGo Go -> rédaction $llm, transcription Whisper $whisper"
}

Write-Host "Construction et démarrage (le premier lancement télécharge plusieurs Go : 10 à 30 min)..."
docker compose --profile partage up -d --build
if ($LASTEXITCODE -ne 0) {
  Write-Host "Échec du démarrage de Docker (voir les messages ci-dessus)." -ForegroundColor Red
  exit 1
}

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
Write-Host "Vous pouvez fermer cette fenêtre : MonMeeting continue de fonctionner."
try { Stop-Transcript | Out-Null } catch { }
