@echo off
REM Double-cliquez pour demarrer MonMeeting sur ce PC (Docker Desktop requis).
chcp 65001 >nul
cd /d "%~dp0"
if not exist "scripts\demarrer-monmeeting.ps1" (
  echo.
  echo  [!] Dossier incomplet : le fichier ZIP n'a pas ete decompresse.
  echo      1. Clic droit sur le fichier ZIP telecharge ^> "Extraire tout..."
  echo      2. Ouvrez le dossier extrait
  echo      3. Double-cliquez a nouveau sur demarrer-monmeeting.bat
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demarrer-monmeeting.ps1"
echo.
echo  Journal complet : %~dp0demarrage.log
echo  (envoyez une capture de cette fenetre en cas de probleme)
pause
