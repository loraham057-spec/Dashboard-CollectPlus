@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Lancez run_windows.bat au moins une fois pour installer les dependances.
  pause
  exit /b 1
)
echo CollectPlus sera accessible sur le reseau local via http://ADRESSE-IP-DE-CET-ORDINATEUR:8000
echo Autorisez Python dans le pare-feu Windows si necessaire.
echo Pour telephones et tablettes : utilisez le meme reseau Wi-Fi.
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
