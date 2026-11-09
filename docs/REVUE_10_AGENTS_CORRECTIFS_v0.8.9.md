# Revue CollectPlus — v0.8.9

## Axe de l’itération
Améliorer la lisibilité du tableau des données par question en exploitant les libellés du schéma des enquêtes.

## Angles de revue (10 agents)
1. Fonctionnel : rendre les colonnes interprétables par les équipes de terrain.
2. UX/UI : afficher les labels plutôt que les noms techniques.
3. Architecture : utiliser la définition de formulaire chargée côté client.
4. Frontend : recherche sur label ou nom de champ.
5. Données : maintenir la correspondance label/clé du payload.
6. Analytics : en-têtes CSV alignés avec la table.
7. Compatibilité : fallback sur la clé technique si label absent.
8. Sécurité : échappement HTML conservé pour les labels/cellules.
9. QA : validation syntaxique et intégrité de l’archive.
10. Red-team : traitement des champs homonymes avec labels différents.

## Changements
- Libellés issus de `state.forms[].sections[].questions[].label`.
- Recherche par label et clé technique.
- Export CSV avec en-têtes compréhensibles.
- Suppression d’une double mise à jour de `lastRefreshLabel`.

## Limites
Validations syntaxiques JavaScript/Python et intégrité ZIP effectuées. Aucun test navigateur ou déploiement Render exécuté. Les champs absents du schéma retournent au nom technique comme fallback.
