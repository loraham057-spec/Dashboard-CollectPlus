# Limites administratives (optionnel)

La carte fonctionne sans fond de carte ni fichier de limites (points, clusters, étiquettes de provinces calculées
à partir des données). Pour afficher les contours, déposez des fichiers **GeoJSON** (WGS84, longitude/latitude) dans ce
dossier puis déclarez-les dans `index.json` :

```json
{"layers": {"rdc": "rdc.geojson", "provinces": "provinces.geojson", "zones": "zones.geojson", "aires": "aires.geojson"}}
```

- Types acceptés : `Polygon` et `MultiPolygon`.
- Pour les provinces, le nom affiché est lu dans `name`, `nom`, `ADM1_FR`, `admin1Name` ou `shapeName`.
- Sources usuelles : OCHA/HDX (« COD-AB RDC »), ministère de la Santé pour les zones et aires de santé.
- Les couches non déclarées sont grisées dans le panneau « Couches de carte ». Les fichiers lourds (aires de santé)
  peuvent être simplifiés avec mapshaper avant import.
