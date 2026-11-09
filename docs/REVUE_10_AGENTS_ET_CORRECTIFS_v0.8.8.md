# CollectPlus — Revue structurée (Mode Équipe IA 10 Agents) et correctifs v0.8.8

## Portée de cette itération

Revue statique des principaux fichiers de l'archive v0.8.7 (`app/main.py`, `app/static/app.js`, `app/static/index.html`, `app/static/styles.css`), vérifications de syntaxe et exécution du test API de sécurité dans un environnement local temporaire. Cette étape ne constitue pas un test navigateur sur Render.

## Constat transversal

- Le backend FastAPI et le frontend SPA ont des éléments fonctionnels, mais certaines capacités sont locales au navigateur (`localStorage`) plutôt que multi-utilisateurs côté serveur.
- L'import XLSForm implémente une partie des types et expressions, pas l'ensemble du standard XLSForm.
- Le dashboard et certaines analytics reposent sur des attributs de données orientés/heuristiques; l'expérience cible avec filtres géographiques réels dépend de la présence et de la normalisation des champs collectés.
- La gestion de progression e-learning et la bibliothèque de cours sont local-browser, donc non partagées entre appareils/comptes.
- Le rate limiting des soumissions publiques est conservé dans SQLite/process environnement et sa conception indique qu'un déploiement multi-worker devra employer un store partagé ou une protection proxy.
- Les rôles utilisateurs et accès projet ne doivent pas être interprétés comme un contrôle d'accès complet côté API tant qu'ils ne sont pas appliqués sur serveur.

## Correctifs effectués

1. Version FastAPI exposée par `/api/health` alignée sur la version du paquet (`0.8.7` au départ, désormais `0.8.8`).
2. Synchronisation idempotente des soumissions durcie : un UUID existant n'est reconnu comme retry que si le formulaire, le contenu logique et l'horodatage sont identiques. Réutilisation d'un UUID avec contenu différent renvoie HTTP 409.
3. Test de non-régression ajouté pour le retry identique (200) et la collision de contenu (409).

## Vérifications effectuées

- `node --check app/static/app.js` : réussi.
- `python -m py_compile app/main.py` : réussi.
- `tests/security_api_smoke.py` sur serveur local avec base SQLite temporaire : réussi avant les changements et à rerun après patch.
- Les tests couvrent auth Basic, headers de sécurité, schema/validation, GPS et image, import XLSForm simple, QR, exports CSV/XLSX et neutralisation de formules, limite d'upload, rate limit, suppression/revocation et idempotence des soumissions.

## Limitations de la revue

- Pas de browser/GUI automation de Render réalisée.
- Pas de vérification d'identifiants de production ni de données réelles.
- Pas encore de tests exhaustive XLSForm, multi-utilisateurs, multi-worker, mobile Android installé, ou tests de charge.
- Les constats concernant les comportements de l'interface doivent encore être confirmés par une navigation browser et les parcours métiers complets.

## Priorités suivantes

P0: authentification multi-comptes et autorisations serveur par rôle; déploiement et secrets; tests e2e navigateur.
P1: remplacer les stocks localStorage projets/utilisateurs/elearning par API persistées; améliorer mapping question label vs clé dans tableau analytique; filtres réels province/zone/aire; gestion robuste des erreurs frontend.
P1: étendre XLSForm et formaliser les types/expressions supportés; retours de validation import explicites.
P2: optimisation pagination submissions/dashboard, performances carte, tests de charge, observabilité et sauvegarde/restore DB.
