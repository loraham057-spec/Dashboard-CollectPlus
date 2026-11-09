# CollectPlus v0.9.0 — Revue 10 angles et refonte dashboard

## Référence UX
Capture fournie « Tableau de bord CollectPlus Pro en RDC ». L'intention retenue: dashboard dense mais hiérarchisé, filtres visibles, KPI en rangée, tendance + carte + dernières soumissions, actions rapides, analytics en dessous, responsive.

## Revue 10 agents / angles
1. Fonctionnel : conserver les métriques calculées par l'application, ne pas créer de statistiques démo.
2. UX/UI : titres, actions, cartes, contraste et espace visuel harmonisés.
3. Architecture : CSS ciblé à `#view-dashboard`, minimisant l'impact sur les autres vues.
4. Frontend : classes et IDs existants conservés; logique JS métier non remplacée.
5. Data : cartes KPI restent alimentées par les fonctions existantes.
6. Analytics : zones existantes restent intactes, le style améliore leur mise en page.
7. Cartographie : Leaflet existant est conservé, hauteur ajustée au desktop responsive.
8. Accessibilité : focus existant préservé, taille mobile révisée; revue plus exhaustive reste nécessaire.
9. QA : checks de syntaxe JavaScript/Python, inspection des sélecteurs et test d'intégrité ZIP.
10. Red-team : risque de surdensité; le breakpoint 1350/900/600px passe à des grilles simplifiées.

## Points écartés de la capture
- 6 KPI et statistiques de projets/utilisateurs/zones de santé: pas tous reliés à des endpoints/données validés. Aucun faux KPI ajouté.
- Aperçu smartphone CollectPlus Mobile et carte RDC satellite: le dashboard source ne dispose pas encore d'un composant de preview dédié et d'un fournisseur cartographique vérifié.
- Barres de statut opérationnel/API: leur ajout attend un endpoint health/status branché à la UI.

## Tests
La vérification syntaxique et l'intégrité archive ont été exécutées. Pas de navigateur E2E, pas de test sur le Render de production dans cette livraison.
