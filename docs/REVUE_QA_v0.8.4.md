# Revue technique CollectPlus v0.8.4

Date de revue : 09 novembre 2026

## Portée
Revue du code présent dans l'archive v0.8.3, des routes FastAPI, des flux de partage public, des soumissions, des exports, de la sécurité API et des fichiers JavaScript/CSS. Version étiquetée 0.8.4 pour cette revue et la documentation QA.

## Résultats exécutés
- `node --check app/static/app.js` : PASS.
- `node --check app/static/public.js` : PASS.
- `python -m py_compile app/main.py` : PASS (le runtime d'environnement a affiché une trace d'initialisation d'un outil tiers sans invalider la compilation).
- `tests/security_api_smoke.py` avec `COLLECTPLUS_ADMIN_USERNAME=ci-admin` et `COLLECTPLUS_ADMIN_PASSWORD=ci-password-test-only` : PASS. Les cas passés comprennent authentification admin, headers sécurité, schéma formulaire, options GPS/photo, validation des réponses, décodage images, import XLSForm, QR local, protections CSV/XLSX contre injection de formule, limite upload, limitation de débit, suppression de formulaire et révocation de lien.
- Test API en mode sans secret administrateur : l'API retourne HTTP 503 sur une route admin, avec message de configuration requis. Ce comportement est intentionnel et sécurisé; il ne faut pas déployer en production sans configurer `COLLECTPLUS_ADMIN_PASSWORD`.
- Vérification API partagée : création formulaire, création lien, lecture formulaire public, génération QR et envoi valide de soumission couvert par le test smoke.

## Limites non certifiées
- Test de rendu navigateur (desktop/mobile) non réalisé : le navigateur Playwright Chromium n'est pas installé dans cet environnement.
- Pas de test sur l'instance Render de production ni sur APK Android.
- Pas de garantie absolue que chaque action de l'interface graphique a été parcourue manuellement. Les fonctions client qui dépendent de CDN, permissions mobiles, stockage navigateur ou environnement hébergé doivent être testées sur le déploiement cible.
- L'indicateur « Type d'affichage » est présent dans les paramètres et déclenche le rafraîchissement du dashboard; la confirmation de rendu visuel des trois variantes (courbe, histogramme, aire) nécessite un test navigateur.

## Configuration Render indispensable
- `COLLECTPLUS_ADMIN_USERNAME` : identifiant administrateur.
- `COLLECTPLUS_ADMIN_PASSWORD` : mot de passe robuste, obligatoire.
- `COLLECTPLUS_PUBLIC_BASE_URL` : URL publique stable (ex. domaine Render de l'app), recommandé pour générer des liens partageables stables.
- `COLLECTPLUS_ALLOWED_ORIGINS` : à définir seulement si frontend séparé.
- Persistance SQLite : configurer un disque persistant Render et `COLLECTPLUS_DB` pointant vers ce disque; sinon la base locale peut être éphémère selon la configuration d'hébergement.

## Commande de vérification
`COLLECTPLUS_ADMIN_USERNAME=ci-admin COLLECTPLUS_ADMIN_PASSWORD=ci-password-test-only python tests/security_api_smoke.py`
À exécuter après démarrage du serveur sur `http://127.0.0.1:8000`. Les identifiants de test ci-dessus sont réservés à la QA; ne pas les réutiliser en production.
