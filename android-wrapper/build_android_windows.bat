@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22+ est requis. & pause & exit /b 1)
echo Installation des dependances Capacitor...
call npm install
if errorlevel 1 goto error
call npm run copy-web
if errorlevel 1 goto error
if not exist "android\settings.gradle" if not exist "android\settings.gradle.kts" (
  echo Creation du projet natif Android...
  call npx cap add android
  if errorlevel 1 goto error
)
echo Synchronisation du projet Android...
call npx cap sync android
if errorlevel 1 goto error
echo Ouverture du projet dans Android Studio...
call npx cap open android
if errorlevel 1 goto error
echo.
echo Dans Android Studio : Build ^> Build Bundle(s) / APK(s) ^> Build APK(s).
echo APK debug attendu sous android\app\build\outputs\apk\debug\app-debug.apk.
goto end
:error
echo Echec de la preparation. Verifiez Node.js, Android Studio et la connexion Internet.
pause
:end
endlocal
