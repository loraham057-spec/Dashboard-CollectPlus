# CollectPlus v0.8.0

Plateforme de collecte mobile (hors ligne), d'analyse et de cartographie d'enquêtes — **Collecter · Analyser · Décider**.
FastAPI + SQLite, interface web sans dépendance externe (aucun CDN, aucune police distante, CSP stricte).

## Démarrage

```bash
pip install -r requirements.txt
export COLLECTPLUS_ADMIN_PASSWORD='un-mot-de-passe-long-et-unique'
uvicorn app.main:app --host 127.0.0.1 --port 8000     # puis http://127.0.0.1:8000
```
Windows : `run_windows.bat` — Linux/macOS : `run_linux_mac.sh` — Docker : `docker compose up` (copiez `.env.example` en `.env`).

## Fonctionnalités
- **Tableau de bord** : KPI, évolution (soumissions / avec GPS), carte filtrable (province → zone → aire), dernières soumissions.
- **Formulaires** : création visuelle, import XLSForm/JSON, brouillon/publié, partage par lien public + QR code, révocation.
- **Collecte** : formulaire par étapes, GPS, photos optimisées, **file hors ligne (IndexedDB)** avec synchronisation automatique.
- **Données** : recherche, pagination, fiche détaillée avec photos, exports Excel / CSV / JSON.
- **Analyses** : répartitions par question, taux de complétion, précision GPS.
- **Administration** : état du système, contrôles de sécurité, journal d'audit. **Utilisateurs** : enquêteurs identifiés.

## Comptes et rôles
| Rôle | Variables | Droits |
|---|---|---|
| Administrateur | `COLLECTPLUS_ADMIN_USERNAME` / `_PASSWORD` | Tout |
| Collecteur (optionnel) | `COLLECTPLUS_COLLECTOR_USERNAME` / `_PASSWORD` | Voir les formulaires publiés et **envoyer** des réponses. Ni lecture, ni export, ni statistiques |
Utilisez le compte collecteur sur les téléphones et dans l'APK (Paramètres → « Mode application mobile »).

## Convention de localisation
Les filtres province / zone / aire de santé s'appuient sur les questions dont le **nom ou le libellé** contient « province »,
« zone de santé » (ou `zs`), « aire de santé » (ou `as`). Les contours de carte sont optionnels : `app/static/geo/README.md`.

## Variables d'environnement
Voir `.env.example` : `COLLECTPLUS_PUBLIC_BASE_URL` (HTTPS en production), `COLLECTPLUS_TRUSTED_PROXY_HOPS`, `COLLECTPLUS_ENV=production`,
`COLLECTPLUS_ALLOWED_ORIGINS`, `COLLECTPLUS_PUBLIC_RATE_LIMIT`, `COLLECTPLUS_DB`.

## Mise à niveau depuis 0.7.x
1. **Sauvegardez** `data/collectplus.db` (`python scripts/backup_sqlite.py`).
2. Démarrez la nouvelle version : le schéma est migré automatiquement (colonnes de recherche, photos déplacées vers `attachments`, formulaires existants marqués « publiés »).
3. Les réponses encore en attente sur un appareil sont reprises automatiquement dans la nouvelle file.
4. Les anciens formulaires ne sont jamais supprimés ; un modèle système vide est retiré.

## Tests
```bash
python -m unittest tests.test_core -v            # logique métier (sans serveur)
python tests/security_api_smoke.py               # serveur réel : accès, rôles, validation, exports, limites (voir la CI)
```

## Structure
`app/core.py` (métier testable) · `app/main.py` (routes, sécurité) · `app/static/` (interface : `app.js`, `formkit.js`, `geomap.js`, `charts.js`) ·
`android-wrapper/` (APK Capacitor) · `docs/REVUE_CODE_SECURITE_v0.8.0.md` (revue, conformité design, risques résiduels).
