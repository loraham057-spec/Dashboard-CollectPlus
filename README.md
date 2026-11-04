# CollectPlus v0.5.0 — Collecte, partage public et analyse dynamique

CollectPlus est une première version exécutable d’une application de collecte de données inspirée des outils de formulaires de terrain. Elle comprend une interface web responsive, un formulaire MAPEPI préchargé, un créateur de formulaires, l’importation de certains XLSForm/JSON, une file de soumissions hors ligne dans le navigateur, une synchronisation vers une base SQLite et des exports CSV, Excel et JSON.

## Démarrage sous Windows

1. Installez Python 3.11 ou une version ultérieure depuis [python.org](https://www.python.org/downloads/). Pendant l’installation, activez **Add Python to PATH**.
2. Décompressez le dossier `CollectPlus_MVP.zip` dans un dossier où vous avez le droit d’écrire.
3. Double-cliquez sur `run_windows.bat`. Au premier lancement, le script crée un environnement virtuel et installe les dépendances Python. Une connexion Internet est nécessaire pour cette installation initiale.
4. Le navigateur s’ouvrira sur **http://127.0.0.1:8000**. Gardez la fenêtre de terminal ouverte tant que vous utilisez l’application.

Les données synchronisées sont enregistrées dans `data/collectplus.db`. Ne supprimez pas ce fichier si vous voulez conserver les données collectées.

## Démarrage avec Docker

Installez Docker Desktop, ouvrez un terminal dans le dossier et exécutez :

```bash
docker compose up --build
```

Puis ouvrez http://127.0.0.1:8000. Le volume `./data` conserve la base quand le conteneur est recréé.

## Utilisation sur téléphone

- L’interface est responsive et s’utilise dans le navigateur mobile.
- Pour tester depuis un téléphone sur le même réseau Wi-Fi que l’ordinateur, lancez `run_network_windows.bat`, trouvez l’adresse IP locale de l’ordinateur (`ipconfig` sous Windows), puis ouvrez `http://ADRESSE-IP:8000` sur le téléphone.
- L’accès depuis une autre machine ne fonctionne que tant que le serveur reste démarré et que le pare-feu autorise la connexion.
- La prise en charge PWA (mise sur l’écran d’accueil et cache de la coque de l’application) nécessite un navigateur compatible. Le service worker est généralement disponible sur `localhost` ou en HTTPS. Pour une installation publique, configurez un nom de domaine et HTTPS.
- Les réponses saisies quand le serveur est indisponible sont gardées dans le stockage local du navigateur et peuvent être renvoyées lorsque le serveur redevient joignable. Évitez d’effacer les données du navigateur avant synchronisation.

## Fonctionnalités incluses — version 0.4.0

- Dashboard enrichi : filtres de période, formulaire et province; courbe mensuelle de collecte; indicateurs actualisés via l’API.
- Cartographie Leaflet/OpenStreetMap des points GPS reçus depuis les champs `latitude`/`longitude`, `lat`/`lon` ou les champs `location`/`geopoint` (format lat lon altitude précision). Les coordonnées doivent être réellement renseignées dans les réponses.
- Partage de formulaire public sans compte participant : depuis « Mes enquêtes », bouton **Partager sans compte**; un jeton URL aléatoire est créé et copié. La page publique est mobile-responsive, vérifie les questions requises et envoie les réponses dans la même base. Le propriétaire peut **fermer le lien public**.
- Capture GPS depuis le navigateur sur les champs `geopoint` dans le formulaire public et la collecte interne (permission de localisation requise).
- Nouvelle palette bleu nuit / turquoise / vert menthe et cache PWA versionné.

### Partage public : parcours rapide

1. Ouvrir **Mes enquêtes** dans CollectPlus.
2. Sur le formulaire, cliquer **Partager sans compte**.
3. Copier et diffuser le lien (participants n’ont pas besoin d’un compte CollectPlus).
4. Les réponses soumises apparaissent dans **Soumissions**, les exports et les analyses du dashboard.
5. Pour arrêter la collecte par ce lien, cliquer **Fermer lien**. Le jeton est conservé mais désactivé; la publication peut être rouverte.


- Tableau de bord avec compteurs et graphiques, alimentés uniquement par les soumissions réelles.
- Formulaire « Fiche d’enregistrement et de suivi d’incident » adapté du document MAPEPI transmis : identification, étape du circuit, motifs, maladie/échantillon, impact/traçabilité, notification, mesures immédiates et correctives, clôture.
- Création simple d’enquêtes avec questions texte, texte long, nombre, date, heure, liste à choix unique, choix multiples, e-mail et téléphone.
- Importation `.json` CollectPlus et `.xlsx` XLSForm (feuilles `survey`, `choices` et, facultativement, `settings`). Les règles de pertinence, calculs, répétitions, médias et autres fonctions XLSForm avancées ne sont pas toutes exécutées : contrôlez chaque formulaire importé avant la collecte.
- Export CSV compatible avec Excel, classeur XLSX, archive JSON et impression du tableau de bord vers PDF via le navigateur.
- Personnalisation locale du nom et de la couleur de l’interface.

## Limites importantes de cette version

Cette livraison est une **version de développement fonctionnelle v0.4.0**, avec workflow GitHub Actions pour compiler un APK Android de test. L'APK n'est pas précompilé dans l'archive : il est produit par GitHub Actions après publication du code et lancement du workflow. Elle n’intègre pas encore l’authentification des administrateurs, les rôles/permissions, la protection d’administration des endpoints, une limitation anti-spam distribuée, le chiffrement de bout en bout, ni une infrastructure de sauvegardes automatisées. Le lien public est un jeton porteur : toute personne qui le possède peut soumettre tant qu’il est activé. Les préférences visuelles sont stockées dans le navigateur. La synchronisation hors ligne utilise `localStorage` et non une base mobile chiffrée.

**Ne déployez pas cette version telle quelle avec des données personnelles ou médicales identifiantes en production. Avant ouverture réelle, ajoutez une authentification forte pour les gestionnaires, contrôle d’accès serveur, limitation de débit, audit, HTTPS, sauvegardes testées, politique de confidentialité et gestion des consentements. Le partage anonyme sans compte répondant est fonctionnel mais nécessite supervision et protection anti-abus renforcées.** Utilisez d’abord des données de test.

## API utile

- `GET /api/health` — état du serveur.
- `GET /api/forms` — formulaires disponibles.
- `POST /api/forms` — créer un formulaire (JSON).
- `POST /api/forms/import` — importer XLSForm/JSON.
- `POST /api/submissions` — enregistrer une soumission.
- `GET /api/submissions` — consulter les soumissions.
- `GET /api/dashboard?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&form_id=ID&province=Province` — agrégats et points GPS filtrés.
- `POST /api/forms/{form_id}/publish` — activer ou désactiver le lien participant.
- `GET /p/{token}` — formulaire public anonyme (si activé).
- `GET /api/public/forms/{token}` et `POST /api/public/forms/{token}/submissions` — consulter le schéma public et soumettre sans compte.
- `GET /api/export/csv`, `/api/export/xlsx`, `/api/export/json` — exports.

La documentation interactive de l’API est accessible sur **http://127.0.0.1:8000/docs** après démarrage.

## Préparation Android (APK)

Le dossier `android-wrapper/` contient le conteneur Capacitor. Le formulaire MAPEPI est inclus comme formulaire de démarrage afin que l'écran de collecte soit disponible même si le serveur n'est pas accessible au premier lancement. Les soumissions faites hors ligne restent stockées sur l'appareil et peuvent être synchronisées vers une API CollectPlus compatible après configuration de son adresse dans les paramètres.

**Compiler un APK via GitHub Actions :**
1. Publiez tout le contenu de ce dossier dans la branche `main` d'un dépôt GitHub.
2. Ouvrez l'onglet **Actions** du dépôt.
3. Choisissez **Build CollectPlus APK**, puis **Run workflow** sur la branche `main`.
4. Une fois le workflow terminé avec une coche verte, ouvrez son exécution et téléchargez l'artefact **CollectPlus-Android-APK** dans la section **Artifacts**.
5. Décompressez l'artefact pour récupérer `app-debug.apk`, puis transférez-le sur un téléphone Android de test.

Le workflow se déclenche aussi automatiquement lorsqu'un changement pertinent est poussé dans `main`. L'APK généré est un APK debug de test, pas un paquet signé pour une publication de production. Pour la compilation locale avec Android Studio, voir `android-wrapper/README_ANDROID.md`.

## Structure du projet

```text
CollectPlus_MVP/
├── app/
│   ├── main.py
│   └── static/
│       ├── index.html
│       ├── styles.css
│       ├── app.js
│       ├── manifest.webmanifest
│       ├── service-worker.js
│       ├── default-forms.json
│       └── icon.svg
├── android-wrapper/
│   ├── package.json
│   ├── capacitor.config.ts
│   └── build_android_windows.bat
├── .github/workflows/
│   ├── collectplus-ci.yml
│   └── build-apk.yml
├── data/
├── run_windows.bat
├── run_network_windows.bat
├── run_linux_mac.sh
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── sample_form.json
```

## Vérification automatique avec GitHub Actions

Le fichier `.github/workflows/collectplus-ci.yml` vérifie automatiquement le projet à chaque push ou pull request vers `main` et peut être lancé manuellement depuis l'onglet **Actions**. Il installe les dépendances, vérifie la syntaxe, démarre brièvement le serveur pour contrôler les routes essentielles, puis construit l'image Docker.

**Important :** ce workflow vérifie et construit le projet dans un environnement temporaire GitHub. Il ne publie pas l'application sur une adresse Internet permanente. Pour rendre CollectPlus accessible au public, il faut ensuite choisir et configurer un hébergeur compatible avec FastAPI et prévoir un stockage persistant pour la base de données.

## Compiler l'APK automatiquement avec GitHub Actions

Le workflow `.github/workflows/build-apk.yml` compile l'application Android et publie `app-debug.apk` comme artefact téléchargeable.

1. Envoyez tout le contenu de ce dossier à la racine du dépôt GitHub (le dossier `.github/workflows/` doit également être présent).
2. Ouvrez le dépôt GitHub, puis **Actions**.
3. Sélectionnez **Build CollectPlus APK** dans la liste des workflows.
4. Cliquez sur **Run workflow**, sélectionnez la branche `main`, puis confirmez avec **Run workflow**. Le workflow peut aussi démarrer automatiquement après un push sur `main` lorsque des fichiers concernés sont modifiés.
5. Attendez que l'exécution soit terminée avec une coche verte. Ouvrez l'exécution, puis téléchargez l'artefact **CollectPlus-Android-APK** dans la section **Artifacts**. Décompressez l'archive téléchargée pour récupérer `app-debug.apk`.

Cette compilation produit un APK **debug destiné aux tests**, non signé pour une distribution de production. Le paquet Android contient l'interface mobile ; l'API Python et sa base de données doivent toujours fonctionner sur un serveur accessible pour les fonctions de synchronisation.


## Nouveautés v0.5.0 — nouveau tableau de bord
- Interface refaite d'après la maquette : barre latérale, 5 indicateurs, évolution (soumissions / GPS), carte satellite de la RDC avec noms des provinces, dernières soumissions, répartition, complétude, actions rapides, tableau des formulaires, analyse rapide, partage public avec QR et aperçu mobile.
- API : `/api/dashboard` enrichi (période précédente, GPS, complétude, provinces, zones, jours), `POST /api/forms/{id}/status` (publié/brouillon), `GET /api/users`, `GET /download/apk` (sert `data/CollectPlus.apk` s'il existe).
- `python scripts/seed_demo.py` crée des données **fictives** pour visualiser le tableau de bord (à ne pas utiliser en production).
- Limites de provinces : déposer `app/static/geo/rdc-provinces.geojson` (voir `LISEZMOI.txt`).
