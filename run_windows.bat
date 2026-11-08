@echo off
setlocal
cd /d "%~dp0"
echo.
echo  CollectPlus - lancement local securise
 echo ================================
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
if "%COLLECTPLUS_ADMIN_USERNAME%"=="" set /p COLLECTPLUS_ADMIN_USERNAME=Identifiant administrateur [admin]: 
if "%COLLECTPLUS_ADMIN_USERNAME%"=="" set COLLECTPLUS_ADMIN_USERNAME=admin
if "%COLLECTPLUS_ADMIN_PASSWORD%"=="" for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s=Read-Host 'Mot de passe administrateur (obligatoire)' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}"`) do set "COLLECTPLUS_ADMIN_PASSWORD=%%P"
if "%COLLECTPLUS_ADMIN_PASSWORD%"=="" (echo Mot de passe obligatoire. & goto error)
set COLLECTPLUS_ADMIN_USERNAME=%COLLECTPLUS_ADMIN_USERNAME%
set COLLECTPLUS_ADMIN_PASSWORD=%COLLECTPLUS_ADMIN_PASSWORD%
if "%COLLECTPLUS_PUBLIC_BASE_URL%"=="" set COLLECTPLUS_PUBLIC_BASE_URL=http://127.0.0.1:8000
echo.
echo CollectPlus demarre sur http://127.0.0.1:8000
echo A l'ouverture du navigateur, saisissez les identifiants admin.
echo Gardez cette fenetre ouverte.
start "CollectPlus - navigateur" http://127.0.0.1:8000
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
if errorlevel 1 goto error
goto end
:error
echo.
echo Une erreur est survenue. Verifiez Python, les dependances et le mot de passe.
pause
:end
endlocal
