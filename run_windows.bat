@echo off
setlocal
cd /d "%~dp0"
echo.
echo  CollectPlus - lancement local
echo  =========================
where py >nul 2>nul
if %errorlevel%==0 (set PY=py) else (set PY=python)
if not exist ".venv\Scripts\python.exe" (
  echo Creation de l'environnement Python...
  %PY% -m venv .venv
  if errorlevel 1 goto error
)
echo Verification des dependances...
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto error
echo.
echo CollectPlus demarre sur http://127.0.0.1:8000
echo Gardez cette fenetre ouverte pendant l'utilisation.
start "CollectPlus - navigateur" http://127.0.0.1:8000
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
if errorlevel 1 goto error
goto end
:error
echo.
echo Une erreur est survenue. Verifiez Python et votre connexion Internet pour installer les dependances.
pause
:end
endlocal
