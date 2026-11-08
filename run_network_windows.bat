@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Lancez run_windows.bat au moins une fois pour installer les dependances.
  pause
  exit /b 1
)
if "%COLLECTPLUS_ADMIN_USERNAME%"=="" set /p COLLECTPLUS_ADMIN_USERNAME=Identifiant administrateur [admin]:
if "%COLLECTPLUS_ADMIN_USERNAME%"=="" set COLLECTPLUS_ADMIN_USERNAME=admin
if "%COLLECTPLUS_ADMIN_PASSWORD%"=="" for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s=Read-Host 'Mot de passe administrateur (obligatoire)' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}"`) do set "COLLECTPLUS_ADMIN_PASSWORD=%%P"
if "%COLLECTPLUS_ADMIN_PASSWORD%"=="" (echo Mot de passe obligatoire. & pause & exit /b 1)
echo CollectPlus sera accessible sur le reseau local via http://ADRESSE-IP-DE-CET-ORDINATEUR:8000
echo IMPORTANT : le Basic Auth est actif mais HTTP sur LAN ne chiffre pas les identifiants. Pour un reseau non fiable, utiliser HTTPS/VPN.
echo Pour telephones et tablettes : utilisez le meme reseau Wi-Fi.
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
