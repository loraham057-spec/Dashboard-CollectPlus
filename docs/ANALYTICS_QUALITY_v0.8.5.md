# CollectPlus v0.8.5 — Amélioration analytique

## Fonction livrée
Ajout de l'endpoint authentifié `GET /api/analytics/quality` dans le backend.

## Indicateurs retournés
- Nombre total de soumissions.
- Nombre de payloads JSON malformés.
- Groupes de payloads strictement identiques et soumissions supplémentaires candidates au doublon.
- Tendance quotidienne des soumissions.
- Nombre de soumissions par formulaire.
- Complétude observée par champ (présence d'une valeur non vide).

## Précautions d'interprétation
- Le détecteur compare le payload complet, normalisé par ordre des clés. Il ne détecte pas tous les doublons métier (par exemple une même personne avec une réponse modifiée).
- Les valeurs absentes sont calculées sur l'ensemble des soumissions sélectionnées, et non sur le schéma obligatoire de chaque formulaire. Pour une mesure de complétude rigoureuse, il faudra confronter les soumissions au schéma de chaque formulaire.
- Aucun enregistrement n'est modifié ou supprimé automatiquement.
- La route est couverte par la couche d'authentification administrative déjà définie par l'application.

## Validation effectuée
- Compilation Python du module `app/main.py`: réussie.
- Test de la route avec base de données locale et jeux d'essai: à effectuer dans l'environnement complet.
- Tests navigateur, rendu chart, déploiement Render, APK et synchronisation offline: non effectués dans cette étape.

## Pistes suivantes
1. Interface Analytics avec filtres de période et de formulaire et visualisations graphiques.
2. PostgreSQL et disque persistant pour environnement hébergé.
3. Synchronisation offline-first et file d'attente de soumissions sur Android.
4. Audit trail, contrôle d'accès par rôle/antenne et sauvegardes automatiques.
5. Résumés assistés par IA en lecture seule avec validation humaine.
