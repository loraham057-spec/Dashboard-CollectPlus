# CollectPlus v0.8.7 — Table des données par question

## Fonctionnalité
Ajout au tableau de bord d'une grille tabulaire des soumissions avec une colonne par question (champ présent dans les réponses), plus ID de soumission, date et formulaire.

## Interactions
- Table réactive et scrollable horizontalement/verticalement.
- En-têtes persistants pendant le défilement.
- Recherche des questions par nom de champ.
- Respect du filtre formulaire déjà présent sur le dashboard.
- Export CSV de la vue tabulaire.
- Limite d'affichage à 500 lignes pour éviter les ralentissements; le nombre total est indiqué.

## Validation
- JavaScript syntax check: passed.
- Python compilation backend: passed.
- ZIP integrity: to be checked on packaging.
- UI in browser and actual live data: not tested in this delivery.

## Note
Les colonnes sont construites à partir des clés présentes dans les payloads. La dénomination des questions est donc basée sur les identifiants techniques de champs (name), pas encore sur les libellés du schéma questionnaire. Une prochaine amélioration peut utiliser les libellés déclarés dans la structure de formulaire.
