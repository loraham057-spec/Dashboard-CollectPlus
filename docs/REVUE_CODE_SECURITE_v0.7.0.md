# Rapport de revue de code et sécurité — CollectPlus v0.7.0

**Périmètre examiné :** archive source CollectPlus v0.6.2 fournie dans le contexte, application FastAPI/SQLite, JavaScript principal, formulaire participant, imports XLSForm, exports, configuration Docker/Render, wrapper Android et workflows CI.

**Méthode :** inspection des routes et contrôles, revue statique des usages HTML/JS, durcissement ciblé, puis tests d’intégration HTTP sur une base SQLite temporaire. Cette revue ne constitue ni un audit externe indépendant ni une certification sécurité.

## 1. Résumé exécutif

La version initiale 0.6.2 était insuffisamment protégée pour une exposition internet avec données nominatives : les endpoints d’administration et les exports ne nécessitaient pas d’authentification, le CORS était wildcard, les soumissions publiques n’avaient pas de limitation de fréquence, les validations serveur des réponses étaient faibles et le QR code envoyait le lien public à un service tiers.

La version 0.7.0 corrige ces points au niveau du socle applicatif. **Le risque d’accès administratif non authentifié est réduit**, mais l’application ne doit pas encore être considérée comme prête à traiter des données de santé sensibles en production : les comptes individuels/RBAC/MFA, audit métier, chiffrement applicatif des données et protection du stockage local restent à compléter.

## 2. Registre des constats initiaux

| ID | Gravité initiale | Constat | Correctif 0.7.0 | Vérification |
|---|---|---|---|---|
| CP-01 | Critique | Routes admin et exports sans authentification | HTTP Basic exigé sur SPA et endpoints admin; secret en variables d’environnement; fail-closed sans secret | Test HTTP : accès sans credentials 401, mot de passe faux 401, sans config 503 |
| CP-02 | Critique | Soumissions personnelles/GPS/photos lisibles via API admin sans protection | API soumissions et exports désormais protégées par le contrôle admin | Test des endpoints admin sans credentials |
| CP-03 | Élevée | CORS `*` | CORS same-origin par défaut, liste d’origines explicite configurable | Revue de config; absence du wildcard dans le code |
| CP-04 | Élevée | Soumission publique sans throttling | Limiteur de fenêtre 60 s, 12 POST par IP et token, compteur stocké dans SQLite avec IP hashée | Test de charge fonctionnel : obtention de 429 |
| CP-05 | Élevée | Validation des données insuffisante | Contrôle des noms/champs inconnus, types, options, requis, GPS, numériques, images | Tests d’intégration avec cas valides et invalides |
| CP-06 | Élevée | Import XLSX sans limites anti-abus suffisantes | Limite 5 Mo, ratio de compression et taille décompressée, limites lignes survey/choices/settings | Test upload trop volumineux 413; revue de contrôles ZIP |
| CP-07 | Élevée | Images validées principalement côté client | Limite 6 Mo, MIME et signature, décodage Pillow, dimension et nombre de pixels bornés | Test soumission image JPEG décodable |
| CP-08 | Moyenne | Export CSV/Excel vulnérable à l’injection de formules | Préfixe apostrophe pour valeurs textuelles commençant par caractères formule | Test export CSV et XLSX avec valeur `=1+1` |
| CP-09 | Moyenne | QR code généré via service tiers, divulgation du token URL | QR PNG généré côté serveur; endpoint admin authentifié | Test réponse PNG; inspection front pour suppression URL QR tierce |
| CP-10 | Moyenne | Headers de sécurité absents | CSP, nosniff, frame deny, referrer policy, permissions policy, HSTS HTTPS | Test headers HTTP sur réponse SPA |
| CP-11 | Moyenne | Robustesse SQLite limitée | WAL, busy timeout, synchronous FULL; gestion tokens lors de suppression formulaire | Tests de parcours; test suppression avec lien actif |
| CP-12 | Moyenne | Dépendances peu reproductibles | Dépendances directes épinglées et Dependabot ajouté | Revue requirements/workflow |
| CP-13 | Moyenne | Import XLSForm GPS/photo converti en texte | Préservation des types `geopoint` et `image` lors de l’import | Test XLSX de fixture qui vérifie les types importés |

## 3. Checklist de vérification règle par règle

| Règle de sécurité/qualité | État 0.7.0 | Éléments de preuve / remarque |
|---|---|---|
| Aucun endpoint admin sensible sans authentification | **PASS au niveau API** | HTTP Basic sur toutes les routes non explicitement participant/public/santé/ressources |
| Les participants peuvent ouvrir un formulaire public sans compte | **PASS** | Routes `/public/{token}` et `/api/public/{token}` exemptées |
| Aucun secret administrateur codé en dur | **PASS** | Variables d’environnement; fail-closed si mot de passe absent |
| Validation côté serveur (pas seulement navigateur) | **PASS ciblé** | validate_form_sections + validate_submission_data; règles des types couverts |
| GPS borné latitude -90/+90 et longitude -180/+180 | **PASS** | Précision finie et bornée aussi |
| Photos bornées, MIME/signature/décodage vérifiés | **PASS ciblé** | JPEG/PNG/WebP, 6 Mo, dimension et pixel count limités |
| Limite des fichiers importés | **PASS** | 5 Mo; limites de l’archive XLSX |
| Throttling participant public | **PASS sur instance SQLite unique** | 12/min IP-token; fonctionne avec workers partageant le même DB SQLite |
| CORS restrictif | **PASS par défaut** | Origines supplémentaires explicitement configurées |
| Protection contre injection Excel | **PASS** | Tests CSV et XLSX avec formule test |
| QR code ne divulgue pas le token à un tiers | **PASS** | Génération PNG locale et authentification admin sur endpoint |
| Headers HTTP de sécurité | **PASS ciblé** | CSP, nosniff, anti-frame, referrer, permissions, HSTS si HTTPS |
| Sauvegarde SQLite cohérente et contrôle d’intégrité | **PASS outil fourni** | `scripts/backup_sqlite.py` testé sur DB de test; l’ordonnancement et le chiffrement restent à configurer |
| Base vierge sans formulaire prédéfini | **PASS** | `default-forms.json` contient un tableau vide; smoke test attend bibliothèque vide |
| GPS et photo visibles dans le menu de l’éditeur | **PASS code** | Vérification des libellés/valeurs dans `app.js` et test statique CI |
| Recherche globale et actions rapides présentes dans l’interface | **PASS code** | Assertions statiques CI sur `globalSearch` et `cp-quick-actions`; gestion Enter et click ajoutée dans `app.js` |
| Dashboard/design visualisé dans navigateur réel | **NON VALIDÉ dans cet environnement** | Chromium Playwright a retourné `ERR_BLOCKED_BY_ADMINISTRATOR`; CSS/JS syntaxiquement validés mais pas capture browser de la version finale |
| Docker image build local | **NON EXÉCUTÉ** | Docker CLI absent de l’environnement; job Docker inclus dans GitHub Actions |

## 4. Tests réellement exécutés

La suite `tests/security_api_smoke.py` a été exécutée contre un serveur Uvicorn local et une base temporaire, avec résultat PASS. Elle couvre :

- API santé publique et challenge Basic Auth;
- authentification valide/invalide et accès protégé;
- présence des headers CSP/nosniff;
- option GPS/photo dans le code de l’éditeur;
- rejet de questions dupliquées;
- formulaire et lien public;
- QR PNG généré localement;
- champs obligatoires, limites GPS, options non autorisées;
- validation et décodage d’une image;
- export CSV/XLSX contre injection de formule;
- import XLSForm qui conserve les types GPS/photo;
- limite de taille de fichier importé;
- limitation des soumissions publiques;
- suppression d’un formulaire sans réponses mais avec token public;
- révocation du lien public.

Autres tests : `python -m compileall -q app tests scripts`, `node --check app/static/app.js`, `node --check app/static/public.js`; parse CSS avec tinycss2 (aucune erreur de parse pour styles.css/public.css); script de sauvegarde SQLite avec `PRAGMA integrity_check = ok`. Un démarrage sans mot de passe admin a aussi été vérifié : `/api/health` retourne 200 et `/api/forms` retourne 503 (fail-closed).

La validation `pip check` de l’environnement de travail a signalé un conflit préexistant entre le paquet MoviePy installé dans cet environnement et Pillow 12.3.0. Le projet épingle Pillow 11.3.0 pour une installation cohérente, mais le téléchargement/downgrade n’a pas pu être exécuté ici faute de résolution DNS vers l’index pip. Les tests de traitement d’image ont néanmoins réussi avec Pillow 12.3.0 déjà installé.

## 5. Failles et risques résiduels (non clos)

| ID | Gravité résiduelle | Risque | Action recommandée avant production sensible |
|---|---|---|---|
| R-01 | Élevée | HTTP Basic est un compte admin partagé, sans RBAC ni MFA; l’attribution d’actions à un utilisateur individuel est impossible | Développer comptes individuels, RBAC, MFA, session/refresh, rotation et révocation |
| R-02 | Élevée | SQLite stocke données et photos sans chiffrement applicatif; les caches et la file hors ligne browser peuvent contenir des données personnelles en localStorage | Chiffrement du volume et backups, évaluer SQLCipher; revoir stockage local, verrouillage et purge appareil |
| R-03 | Élevée | Aucun journal d’audit métier complet (qui a créé, modifié, exporté, révoqué) | Journal d’audit immuable et politique de revue |
| R-04 | Élevée | Le rate limiter n’est pas une solution globale face à un réseau de bots/DoS distribué; reverse-proxy WAF/CDN et contrôle global non intégrés | Ajouter proxy/WAF ou Redis partagé, règles d’abus, CAPTCHA optionnel et monitoring |
| R-05 | Élevée | Données santé/nominatives : pas de mécanisme intégré de consentement, rétention, anonymisation ou suppression périodique | Politique de données, minimisation, consentement, rétention, droits et conformité applicable |
| R-06 | Moyenne-élevée | SQLite + API sans pagination sur certaines lectures peut saturer avec beaucoup de soumissions; scaling horizontal non prévu | Pagination, indexes, tests charge, puis migration PostgreSQL avant croissance |
| R-07 | Moyenne | Le wrapper Android pourrait ne pas présenter correctement le challenge HTTP Basic WebView | Tester APK sur device et implémenter un écran d’auth sécurisé/flow token adapté |
| R-08 | Moyenne | `COLLECTPLUS_PUBLIC_BASE_URL` doit être défini correctement sur Render; sans configuration en production la création de partage est bloquée | Ajouter l’URL Render en env et confirmer la construction des liens HTTPS |
| R-09 | Moyenne | XLSForm support partiel : XPath, skip logic avancée, repeat groups, constraints complexes ne sont pas un moteur ODK complet | Implémenter et tester une compatibilité formelle ou documenter un sous-ensemble supporté |
| R-10 | Moyenne | Visualisation finale responsive n’a pas pu être contrôlée via Chromium dans cet environnement | Contrôle manuel de toutes les pages sur desktop/mobile et captures de référence dans CI |

## 6. Configuration de production requise

Sur Render, définir avant de publier :

- `COLLECTPLUS_ADMIN_USERNAME`
- `COLLECTPLUS_ADMIN_PASSWORD` (secret fort unique, 24+ caractères aléatoires conseillé)
- `COLLECTPLUS_PUBLIC_BASE_URL=https://collectplus.onrender.com`
- `COLLECTPLUS_DB` sur le disque persistant, par ex. `/var/data/collectplus.db`
- disque persistant monté `/var/data`
- `COLLECTPLUS_ALLOWED_ORIGINS` vide pour le frontend même origine, ou liste précise des origines
- `COLLECTPLUS_RATE_LIMIT_SALT` secret distinct (optionnel mais recommandé)
- `.env` doit rester non versionné (le fichier `.gitignore` l’exclut; utiliser `.env.example` comme modèle)

Le site pourra répondre au health check, mais les pages/API admin renverront 503 tant que le mot de passe n’est pas configuré. Les réponses participant publiques continuent sans compte.

## 7. Conclusion

La 0.7.0 améliore substantiellement la protection des API, les validations, les importations et les exports, avec tests d’intégration reproductibles. Elle **ne satisfait pas encore l’ensemble des exigences d’une plateforme institutionnelle de collecte de données de santé sensibles** tant que les risques résiduels R-01 à R-10 ne sont pas traités et qu’un audit indépendant et une validation visuelle complète ne sont pas réalisés.
