# CollectPlus v0.4.0 — Journal des évolutions

## Interface / UX
- Palette bleu nuit, turquoise et vert menthe ; sidebar et cartes harmonisées.
- Dashboard avec filtres période / enquête / province, évolution mensuelle, cartes indicateurs et carte Leaflet OpenStreetMap.
- Boîte de partage de lien avec copie, partage natif et QR code client-side (dépendance CDN, QR de secours si hors ligne).
- Page publique de formulaire responsive, parcours participant simplifié et sans création de compte.

## API / collecte
- Colonnes de partage `public_token` et `public_enabled` ajoutées par migration SQLite rétrocompatible.
- Routes de publication/fermeture, lecture schéma public, soumission anonyme.
- Validation côté serveur des champs obligatoires.
- Capture GPS depuis navigateur pour champs geopoint et prise en charge coordonnées GPS sur carte.
- Honeypot léger pour réduire le spam automatique.

## Tests
- Syntaxe Python, JavaScript et JSON vérifiée.
- Tests API manuels d’intégration : publier/fermer lien, page publique, soumission, filtre province/date, extraction de point GPS.
- Workflow CI étendu avec un parcours API public.

## Limites importantes
Cette version est destinée à développement/pilote. Les API d’administration restent sans authentification utilisateur. Avant usage avec données sensibles, mettre en place auth, RBAC, protections anti-abus/rate-limit, audit, politique de confidentialité, HTTPS et sauvegardes éprouvées.
