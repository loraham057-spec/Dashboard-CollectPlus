# Revue de code, sécurité et conformité design — CollectPlus v0.8.0

Base examinée : `CollectPlus_v0_7_1.zip` (FastAPI + SQLite + interface HTML/JS). Cette revue liste ce qui a été trouvé, ce qui a été
corrigé, et ce qui reste à votre charge. Rien n'est déclaré « corrigé » sans preuve d'exécution indiquée en dernière colonne.

## 1. Défauts trouvés dans la v0.7.1 et correction

| # | Gravité | Constat | Correction v0.8.0 | Preuve |
|---|---|---|---|---|
| 1 | **Critique** | `app.js` écrivait dans `#metricQueueText`, absent du HTML : `init()` plantait et **aucune donnée ne se chargeait** (0 formulaire, KPI à 0). | Interface réécrite ; plus de dépendance à des éléments orphelins. | Reproduit dans Chromium avant, e2e après |
| 2 | **Critique** | File hors ligne stockée dans `localStorage` (≈5 Mo) avec les photos en base64 ; l'échec d'écriture était avalé alors que l'écran annonçait « enregistré » → **perte silencieuse de données**. | File dans **IndexedDB**, erreur explicite si l'écriture échoue, reprise automatique de l'ancienne file v0.7. | e2e : hors ligne, rechargement, reprise v0.7 |
| 3 | Élevée | Réponse refusée par le serveur (4xx) remise en file et renvoyée indéfiniment. | Erreur affichée à l'utilisateur ; réponses refusées isolées et consultables (« Rejetée »). | e2e « rejet 4xx » |
| 4 | Élevée | `with sqlite3.connect()` ne ferme pas la connexion → fuite de descripteurs sous charge. | Classe `Conn` qui valide puis **ferme**. | test unitaire |
| 5 | Élevée | Mot de passe contenant un accent → `TypeError` dans `compare_digest` (HTTP 500, ou contournement du blocage). | Comparaison en octets UTF-8, non court-circuitée. | banc web |
| 6 | Élevée | Limite de débit basée sur le **premier** élément de `X-Forwarded-For` (falsifiable par le client). | Lecture de l'adresse ajoutée par *votre* proxy (`COLLECTPLUS_TRUSTED_PROXY_HOPS`). | banc web |
| 7 | Élevée | Limite de 10 Mo contournable en transfert *chunked* (pas de `Content-Length`). | Refus 411. | banc web |
| 8 | Moyenne | Les réponses 401/403/413/429 renvoyées par le middleware n'avaient **aucun en-tête de sécurité**. | En-têtes appliqués à toutes les réponses. | banc web |
| 9 | Élevée | Terminaux de terrain et APK utilisaient le compte **administrateur** pour envoyer des données. | Compte **collecteur** (saisie seule : pas de lecture, export, statistiques, audit). | banc web, smoke API |
| 10 | Élevée | CSRF : l'authentification Basic est renvoyée automatiquement par le navigateur ; un `POST` sans corps (dépublier, révoquer un lien) pouvait être déclenché par un site tiers. | En-tête `X-Requested-With: CollectPlus` obligatoire sur toute requête modifiante. | banc web |
| 11 | Moyenne | Aucune protection contre le brute-force du compte admin. | 10 échecs / 5 min / IP → 429. | banc web |
| 12 | Moyenne | Table de limitation de débit : une ligne par couple IP+jeton (gonflable avec de faux jetons), purge aléatoire. | Clé par IP, index sur la fenêtre, purge régulière. | test unitaire |
| 13 | Élevée | Tableau de bord, liste et exports chargeaient **tous** les JSON, photos comprises (mémoire, latence) ; un export Excel avec photo dépasse 32 767 caractères par cellule. | Colonnes dénormalisées (province, zone, aire, GPS, jour, collecteur), photos dans la table `attachments`, agrégats SQL, pagination, exports sans photo. | tests unitaires |
| 14 | Moyenne | CSP avec `'unsafe-inline'` (styles) et Leaflet chargé depuis unpkg **sans SRI** ; tuiles OSM = fuite des positions GPS vers un tiers. | CSP stricte (`script-src 'self'; style-src 'self'`), carte SVG interne hors ligne. Aucun appel externe. | e2e + smoke API |
| 15 | Moyenne | Dates `submitted_at` fournies par le client stockées telles quelles (formats mêlés → tri faux). | Normalisation UTC ISO, date future ramenée à « maintenant ». | tests unitaires |
| 16 | Moyenne | Type `datetime` d'un XLSForm refusé (400) ; libellé commençant par un chiffre → nom invalide ; règles `relevant`/`constraint` ignorées sans avertissement. | Type accepté, noms nettoyés/dédoublonnés, **avertissement** sur les règles non appliquées. | tests unitaires |
| 17 | Moyenne | Champs libres stockés (clés de question arbitraires, `display` du GPS). | Liste blanche de clés, GPS normalisé numérique. | tests unitaires |
| 18 | Faible | Règles métier en dur (`statut_incident`, `maladie_echantillon`, date du jour par défaut) ; version `0.7.0` dans le code vs `0.7.1`. | Statistiques génériques déduites du formulaire ; version unique. | e2e |
| 19 | Faible | Formulaires : labels non reliés aux champs, caméra forcée (`capture`), erreurs seulement en toast. | Étiquettes associées, erreurs en ligne (`aria-invalid`), choix caméra/galerie. | design_check Q2 |
| 20 | Faible | CSV : neutralisation de formule cassait les nombres négatifs (`-5` → `'-5`). | Les nombres sont conservés. | test unitaire |

## 2. Conformité au design (maquette fournie) — vérification règle par règle

Vérifiée automatiquement dans Chromium (assertions sur le DOM, libellés exacts, couleurs calculées, 15 vues × 4 largeurs) : **25/25**.

| Règle | Exigence de la maquette | Statut |
|---|---|---|
| D1–D5 | Barre latérale sombre (marque + baseline), 10 entrées dans l'ordre, entrée active, carte « Synchronisation », barre haute (menu, recherche, cloche, aide, utilisateur) | ✅ |
| D6–D7 | Titre « Tableau de bord général » + sous-titre, période, filtre province, « Nouveau formulaire » | ✅ |
| D8–D9 | 4 cartes KPI avec pastilles vert / bleu / orange / violet | ✅ (4ᵉ carte : voir écarts) |
| D10 | Évolution des soumissions : sélecteur « Derniers 30 jours », légende, 2 courbes (Soumissions / Avec GPS), infobulle | ✅ |
| D11–D12 | Carte : zoom +/−, recentrage, échelle, légende ; filtres Province/Zone/Aire, période, 5 couches, plein écran | ✅ |
| D13 | Tableau « Dernières soumissions » : 6 colonnes, badges de statut, lien « Voir toutes » (sans défilement horizontal) | ✅ |
| D14 | Liste des formulaires : recherche, Filtrer, onglets avec compteurs, pastille Publié/Non publié, « Avec GPS », menu ⋮ | ✅ |
| D15 | Fiche formulaire : menu à 7 entrées, KPI (Soumissions, Avec GPS, Zones, Aires), anneau et barres | ✅ |
| D16 | Cartographie détaillée : popup (Aire, Zone, Province, Date, « Voir la fiche complète ») | ✅ |
| D17 | Formulaire public : logo, « FR », titre, description, étapes, champs obligatoires | ✅ |
| Q1–Q4 | Aucune erreur console/CSP ; accessibilité (étiquettes, noms de boutons) ; aucun débordement à 390/768/1024/1536 px ; lien d'évitement clavier | ✅ |

### Écarts assumés (à valider)
1. **4ᵉ KPI** : la maquette affiche « Utilisateurs actifs (24 — 18 enquêteurs, 6 admins) ». Il n'existe pas de comptes individuels : la carte affiche donc **« Enquêteurs actifs »** (noms saisis sur chaque appareil) et le nombre de comptes admin. Des comptes nominatifs sont la suite logique (voir §3).
2. **Carte** : pas de fond de carte (satellite/rues) — choix délibéré (hors ligne, pas de fuite de positions GPS). Les **contours** (RDC, provinces, zones, aires) ne sont pas fournis : déposez vos GeoJSON dans `app/static/geo/` (voir le README du dossier). Sans eux, la carte affiche points, clusters et noms de provinces.
3. **Formulaire public** : l'étape « Enfant / Suivi / Validation » de la maquette est un exemple ; les étapes reflètent les **sections de votre formulaire**.
4. **Police** : pile système (Inter si installée) — aucune police distante, par conformité CSP.

## 3. Risques résiduels (non traités ici)
- **Authentification** : deux comptes partagés (admin, collecteur) en Basic Auth ; pas de comptes nominatifs, de MFA, ni de rotation. Pour un déploiement institutionnel : comptes individuels + sessions + journal nominatif.
- **Données personnelles** : base et sauvegardes **non chiffrées** au repos ; pas de politique de rétention ni de consentement intégrée. Planifiez `scripts/backup_sqlite.py` et chiffrez les sauvegardes.
- **Photos** : celles prises dans l'application sont ré-encodées (métadonnées EXIF supprimées) ; celles envoyées par d'autres clients conservent leurs métadonnées.
- **Blocage de connexion** : compteur en mémoire, propre à chaque processus (non partagé entre plusieurs workers).
- **SQLite** : adapté à quelques milliers de soumissions/jour ; au-delà, passer à PostgreSQL.
- **Docker** : le conteneur s'exécute en root ; utilisateur non privilégié recommandé (attention aux droits du volume).
- Les jours des statistiques sont découpés en **UTC** (la RDC est en UTC+1/+2).

## 4. Preuves d'exécution et limites de la vérification
- `python -m unittest tests.test_core` : **14/14** (validation, migration d'une base v0.7, statistiques, exports, import XLSForm, limites).
- Interface testée dans **Chromium** contre le vrai `core.py` avec la même CSP : parcours complet **47/47** (filtres, fiche, carte, collecte, hors ligne, reprise v0.7, rôle collecteur, création, mobile, page publique) et conformité design **25/25**.
- Portail de sécurité et routes (`app/main.py`) : **37/37** avec des doublures de FastAPI.
- ⚠️ **Non exécuté ici** : `main.py` sur un vrai FastAPI/uvicorn (pas d'accès réseau pour installer les dépendances). `tests/security_api_smoke.py` (≈50 contrôles) est prêt et lancé par la CI : exécutez-le avant toute mise en production.
- Outils de test d'interface (Playwright) non livrés dans l'archive.
