# CollectPlus v0.6.0 — Refonte dashboard

CollectPlus est une application web de création, collecte et analyse de formulaires de terrain (FastAPI + SQLite + interface web/PWA + wrapper Android Capacitor).

## Changements de cette livraison

- Refonte de la page d'accueil/dashboard en reprenant la composition visuelle de la référence : KPI, filtres période/province/formulaire, courbe de tendance, carte de collecte, dernières soumissions, distribution et qualité GPS, panneau d'aide au partage.
- Les valeurs du dashboard sont issues des soumissions réellement enregistrées ; aucune statistique fictive n'est injectée.
- Carte Leaflet/OpenStreetMap qui place les soumissions possédant des coordonnées GPS. Les données de GPS sont recherchées dans les champs latitude/longitude et dans des formats de localisation courants.
- Responsive ordinateur/tablette/mobile, thème bleu nuit, bleu clair et turquoise.
- **Aucun questionnaire d'enquête n'est préchargé** dans une nouvelle installation : la bibliothèque est vide, et l'utilisateur doit créer ou importer ses formulaires.
- Migration de l'ancien formulaire système MAPEPI : si aucune soumission n'existe, l'ancien modèle système est supprimé ; s'il possède des réponses, il est conservé comme formulaire non système pour ne pas perdre les données.
- Suppression de la suppression cascade des soumissions lors de la suppression d'un formulaire : un formulaire ayant des réponses renvoie un message de conflit et ses données sont préservées.
- Partage public par lien tokenisé : le participant ouvre le lien sans compte et soumet sa réponse. Le créateur peut générer un lien depuis la carte de formulaire ; l’interface copie le lien et ouvre le QR via un service QR externe.
- Révocation des liens publics depuis l’API de gestion.
- Cache PWA versionné pour renouveler les ressources du design.

## Lancement Windows

1. Installer Python 3.11+.
2. Décompresser cette archive.
3. Double-cliquer `run_windows.bat`.
4. Le script crée `.venv`, installe `requirements.txt`, lance FastAPI et ouvre le navigateur.
5. URL : http://127.0.0.1:8000

La première installation de dépendances requiert Internet. Garder la console ouverte pour maintenir le serveur.

## Lancement manuel

```cmd
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Lancement Docker / Render

Le `Dockerfile` expose le port 8000. Pour Docker local :

```bash
docker compose up --build
```

Pour Render, utiliser le Dockerfile existant et un disque persistant monté pour la base SQLite, avec `COLLECTPLUS_DB` pointant vers un chemin sur ce disque. Ne remplacez pas ou ne supprimez pas la base en place sans sauvegarde préalable.

## Carte et dépendances web externes

La carte s'appuie sur Leaflet 1.9.4 et les tuiles OpenStreetMap via CDN. La cartographie de fond nécessite une connexion Internet. Les marqueurs ne s'affichent que pour les soumissions avec coordonnées GPS reconnues. Le dashboard n'invente pas de points, formulaires ou soumissions.

## Vérifications réalisées

- Syntaxe Python compilée (`py_compile`).
- Syntaxe JS vérifiée (`node --check`).
- Initialisation DB testée : 0 formulaire au premier démarrage.
- API dashboard testée sur une base de test vide : 0 soumission et listes vides.

## Limites et sécurité

Cette livraison constitue un projet prêt à démarrer/tester, pas encore une plateforme certifiée de production pour des données de santé identifiantes. Avant l'ouverture publique, intégrer authentification administrateur, RBAC, audit, contrôle anti-abus des formulaires publics, politique de sauvegarde et TLS/HTTPS. La compatibilité XLSForm est partielle pour les fonctionnalités avancées.


## Version 0.6.1 — Types GPS et photo dans l’éditeur
- Ajout des types de question **Géolocalisation GPS** et **Photo / Appareil photo** dans le constructeur visuel.
- Capture GPS par navigateur avec latitude, longitude et précision, permission explicite du participant.
- Capture/sélection de photo, aperçu et optimisation JPEG côté client avant envoi.
- Les types sont aussi rendus dans le formulaire public partagé, sans compte participant.
- La capture GPS et l’accès caméra requièrent un contexte sécurisé HTTPS (ou localhost).
