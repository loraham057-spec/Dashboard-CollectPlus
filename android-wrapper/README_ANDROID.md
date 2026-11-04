# Préparer l'APK Android CollectPlus

Ce dossier contient le conteneur natif Android basé sur Capacitor. Le fichier `app-debug.apk` n'est pas précompilé dans l'archive. Pour éviter une installation locale complète d'Android Studio, le dépôt inclut le workflow GitHub Actions `.github/workflows/build-apk.yml` qui construit et publie l'APK comme artefact téléchargeable.

## Prérequis

- Node.js 22 ou plus récent.
- Android Studio 2025.2.1 ou plus récent pour Capacitor 8.
- Un SDK Android installé depuis Android Studio (plateforme/API 36 recommandée par la documentation consultée).
- Une adresse de serveur CollectPlus accessible par le téléphone. Pour une utilisation durable, utilisez un serveur HTTPS.

Documentation officielle : https://capacitorjs.com/docs/getting-started/environment-setup et https://capacitorjs.com/docs/getting-started.

## Génération du projet Android

1. Installez et démarrez le serveur CollectPlus depuis le dossier principal.
2. Dans `android-wrapper`, lancez `build_android_windows.bat`.
3. Android Studio s'ouvre sur le projet natif. Attendez la synchronisation de Gradle.
4. Dans Android Studio, sélectionnez **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5. Le fichier de test est normalement généré dans `android-wrapper/android/app/build/outputs/apk/debug/app-debug.apk`.
6. Installez l’APK debug sur un téléphone Android pour les tests.

## Connexion au serveur

Dans l'application, ouvrez **Paramètres > Adresse du serveur API** et indiquez l'adresse de l'API, par exemple `https://collectplus.votredomaine.org`. Enregistrez les préférences. Le serveur doit rester accessible pour la synchronisation des soumissions.

Un APK compilé n'intègre pas à lui seul le serveur Python et sa base SQLite : l'API doit fonctionner sur un ordinateur/serveur accessible, ou être hébergée. Il est recommandé de déployer l'API en HTTPS et d'activer l'authentification avant d'utiliser de vraies données de santé.

## Compilation de production

L'APK debug est destiné aux tests. Pour distribuer une version de production, configurez une signature Android de release, testez la restauration hors ligne, la synchronisation et la compatibilité des formulaires importés, puis produisez un APK/AAB signé.
