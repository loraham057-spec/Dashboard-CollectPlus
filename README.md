# CollectPlus v0.8.0 — Dashboard étendu et espace collaboratif (prototype local)

CollectPlus est une application de collecte et d’analyse de formulaires terrain (FastAPI, SQLite, SPA/PWA et wrapper Capacitor Android). Cette livraison reprend la version 0.6.2 et ajoute un premier niveau de protections côté API et des tests automatisés. Cette version ajoute des vues Projets, Utilisateurs & rôles et Partage & accès, alignées sur le visuel cible. Les nouvelles données collaboratives sont persistées dans le stockage local du navigateur et ne constituent pas encore un système de comptes serveur multi-utilisateurs.

## Changements v0.7.1\n\n- Refonte de la palette visuelle du tableau de bord : sidebar bleu nuit, surfaces bleu clair, accents turquoise/bleu/violet/orange/vert maîtrisés.\n- KPI et cartes rehaussés (hiérarchie typographique, ombres légères, coins arrondis, états hover).\n- Filtres dashboard harmonisés et mise en page responsive pour écrans intermédiaires et mobiles.\n- Ajustement de la hauteur de la carte et styles de la zone cartographique.\n- Les formulaires et soumissions restent issus des données réelles; aucun questionnaire ni indicateur fictif ajouté.\n- Les fonctionnalités GPS, photo, collecte hors ligne, API, partage public et wrapper Android sont conservés.\n\n## Changements v0.7.0

### Contrôle d’accès et sécurité HTTP
- Authentification HTTP Basic obligatoire sur l’interface principale et les routes d’administration/API (formulaires, soumissions, rapports, exports, partage et QR code).
- Les routes publiques participant (`/public/{token}`, `/api/public/{token}/...`) sont exemptées afin que le répondant puisse ouvrir et soumettre sans compte.
- Le endpoint santé `/api/health` et les ressources statiques restent publics.
- Credentials uniquement par variables d’environnement : `COLLECTPLUS_ADMIN_USERNAME` et `COLLECTPLUS_ADMIN_PASSWORD`. Si le mot de passe n’est pas configuré, l’accès administrateur est bloqué par défaut (HTTP 503) — aucune valeur par défaut faible.
- CORS same-origin par défaut. Les origines additionnelles doivent être explicitement listées dans `COLLECTPLUS_ALLOWED_ORIGINS`, séparées par des points-virgules.
- En-têtes de sécurité : CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS sur HTTPS.

### Validation et protections des données
- Contrôle de la structure des formulaires : nombre de sections/questions, noms de champs conformes et uniques, types autorisés, limites de taille des libellés et choix.
- Validation serveur des réponses publiques et synchronisées : champs attendus, obligatoire, valeurs des listes, limites GPS latitude/longitude/précision, valeurs numériques et images.
- Les images doivent correspondre au MIME annoncé (signature JPEG/PNG/WebP) et faire 6 Mo maximum après optimisation.
- Limite globale du corps HTTP de 10 Mo selon `Content-Length`; limite d’import XLSX/JSON à 5 Mo; contrôle du ratio et de la taille décompressée des archives XLSX; limites des lignes survey/choices/settings.
- Limitation de fréquence des soumissions publiques : 12 POST par IP et fenêtre de 60 secondes (limiteur en mémoire, adapté à une instance unique seulement).
- Neutralisation des formules dans les exports CSV/Excel (préfixe apostrophe pour les valeurs potentiellement interprétées comme formule).
- QR code généré localement par le serveur; l’URL publique n’est plus envoyée au service QR tiers.
- SQLite : WAL, `busy_timeout`, `synchronous=FULL`; suppression d’un formulaire sans soumission supprime aussi les tokens de partage qui y sont liés.

### Tests automatisés
- `tests/security_api_smoke.py` teste l’auth admin, la validation du schéma, la présence de champs obligatoires, la validation GPS, des choix, la signature d’image, la génération QR locale, la neutralisation CSV, le throttling public et la révocation des liens.
- Workflow GitHub Actions vérifie la syntaxe Python/JavaScript, lance les tests API et construit l’image Docker.
- Dependabot surveille les dépendances Python et GitHub Actions.

## Lancement Windows

1. Installer Python 3.11+.
2. Décompresser le ZIP.
3. Double-cliquer `run_windows.bat`.
4. Définir l’identifiant et le mot de passe administrateur lorsqu’ils sont demandés.
5. Le navigateur ouvre `http://127.0.0.1:8000`. Le navigateur demandera les identifiants Basic Auth.

Le script local fixe `COLLECTPLUS_PUBLIC_BASE_URL=http://127.0.0.1:8000`. Garder la console ouverte.

## Déploiement Render

Configurer ces variables d’environnement dans Render **avant** le redéploiement :

- `COLLECTPLUS_ADMIN_USERNAME` : identifiant administrateur non trivial.
- `COLLECTPLUS_ADMIN_PASSWORD` : mot de passe fort et unique (au moins 24 caractères aléatoires conseillé).
- `COLLECTPLUS_PUBLIC_BASE_URL` : `https://collectplus.onrender.com` (ou URL réelle de ton service).
- `COLLECTPLUS_DB` : chemin sur le disque persistant, par exemple `/var/data/collectplus.db`.
- `COLLECTPLUS_ALLOWED_ORIGINS` : laisser vide pour le front même origine; sinon inscrire uniquement les origines exactes séparées par `;`.

Ajouter un disque persistant Render monté sur `/var/data`. Ne pas placer la base SQLite dans le système de fichiers éphémère du conteneur. Les tokens de partage publics ne sont pas des identifiants administrateur : toute personne qui possède un lien actif peut participer.

## Docker Compose

Créer un fichier `.env` (ne jamais le committer) avec :

```env
COLLECTPLUS_ADMIN_USERNAME=admin
COLLECTPLUS_ADMIN_PASSWORD=REMPLACER_PAR_UN_SECRET_LONG_UNIQUE
COLLECTPLUS_PUBLIC_BASE_URL=http://localhost:8000
COLLECTPLUS_ALLOWED_ORIGINS=
```

Puis : `docker compose up --build`. Le volume `./data:/app/data` doit être protégé sur l’hôte.

## Sauvegarde SQLite

Une sauvegarde cohérente peut être créée par :

```bash
python scripts/backup_sqlite.py [chemin_db] [dossier_sauvegarde] [retention_jours]
```

Par défaut, sauvegarde `data/collectplus.db` vers `data/backups`, vérifie `PRAGMA integrity_check` et purge les sauvegardes de plus de 30 jours. Les sauvegardes contiennent potentiellement des informations personnelles et des photos : protéger le dossier, chiffrer le stockage et conserver une copie hors serveur. Le script n’est pas un ordonnanceur; configurer une tâche planifiée adaptée.

## Limites résiduelles — à ne pas confondre avec une certification de production

- HTTP Basic est un compte administrateur partagé, pas une gestion complète d’utilisateurs/RBAC, MFA ou révocation par personne. L’utiliser uniquement derrière HTTPS en production.
- Le rate limit est en mémoire et par processus. Pour plusieurs workers/instances, utiliser un reverse proxy ou Redis avec limitation partagée.
- SQLite convient à une instance de taille modérée; l’architecture n’est pas préparée au scaling horizontal ou à une charge élevée.
- Les données et photos ne sont pas chiffrées au niveau applicatif dans SQLite. Le chiffrement du disque/volume et des backups doit être fourni par l’infrastructure; SQLCipher n’est pas intégré.
- Pas encore de journal d’audit métier complet, d’authentification individuelle, de RBAC, de workflow de consentement, de politique de rétention automatique ni de supervision de sécurité.
- Compatibilité XLSForm partielle (pas de moteur complet XPath/skip logic/repeat groups/constraints avancées). Les formulaires importés doivent être testés.
- Les navigateurs doivent être sur HTTPS (ou localhost) pour autoriser GPS et caméra.
- Le wrapper Android peut nécessiter une adaptation de la gestion HTTP Basic sur Android WebView; tester l’authentification avec APK avant diffusion.

Ne pas traiter des données de santé identifiantes en production avant résolution des limites résiduelles et validation par le responsable sécurité/protection des données.


## Changements v0.8.0
- Ajout de vues navigationnelles dédiées aux projets, utilisateurs & rôles et partage/permissions.
- Création locale de projets avec nom, description, statut et date.
- Ajout local d'utilisateurs avec validation d'e-mail et choix de rôle (admin, analyst, collector, viewer).
- Attribution et révocation locale des accès projet avec niveaux de permission.
- Dashboard/navigation enrichis et styles professionnels cohérents avec la référence.
- Les écrans de collaboration stockent leurs données en localStorage du navigateur.

## Limitation importante — production
Les comptes, invitations, rôles et permissions v0.8.0 ci-dessus sont une interface prototype locale : ils ne sont ni synchronisés entre appareils, ni une couche d'autorisation backend. Ne pas utiliser pour des données sensibles de santé ni présenter le partage comme sécurisé entre utilisateurs avant l'implémentation d'une authentification serveur (sessions, hash de mots de passe, RBAC appliqué à chaque endpoint, invitations vérifiées, journal d'audit, contrôle d'accès objet, stockage partagé sécurisé et tests de sécurité). Le socle API existant conserve son authentification administrateur commune.

## Validation effectuée
- `node --check app/static/app.js` : réussi.
- `python -m py_compile app/main.py` : réussi.
- Le wrapper Capacitor et workflow GitHub Actions APK existants ont été conservés ; aucune compilation APK signée sur appareil n'a été exécutée dans cette livraison.
