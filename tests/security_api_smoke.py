"""Tests de bout en bout sur un serveur réel (uvicorn) : contrôle d'accès, rôles, validation, exports, limites.

Lancement (voir .github/workflows/collectplus-ci.yml) : python tests/security_api_smoke.py
Les tests de blocage (429) sont exécutés en dernier : ils verrouillent volontairement l'IP de test.
"""
import base64, http.client, io, json, os, urllib.error, urllib.request
from urllib.parse import urlparse
from openpyxl import load_workbook
from PIL import Image

BASE = os.getenv("COLLECTPLUS_TEST_BASE", "http://127.0.0.1:8000")
basic = lambda u, p: "Basic " + base64.b64encode(f"{u}:{p}".encode()).decode()
ADMIN, COLLECTOR = basic("ci-admin", "ci-password-test-only"), basic("ci-collector", "ci-collector-test-only")


def req(path, method="GET", data=None, auth=ADMIN, raw_headers=None):
    headers = {"Content-Type": "application/json", "X-Requested-With": "CollectPlus"}
    if auth:
        headers["Authorization"] = auth
    headers.update(raw_headers or {})
    r = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data).encode(), headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def ok(label, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  -> {extra}"))
    assert cond, (label, extra)


# --- Accès : public / administrateur / collecteur
ok("health public", req("/api/health", auth=None)[0] == 200)
s, _, h = req("/api/forms", auth=None)
ok("API sans identifiants -> 401", s == 401)
ok("les réponses d'erreur portent les en-têtes de sécurité", bool(h.get("Content-Security-Policy")) and h.get("X-Content-Type-Options") == "nosniff", dict(h))
ok("CSP stricte (pas de script/style en ligne)", "'unsafe-inline'" not in h.get("Content-Security-Policy", ""))
ok("page d'accueil protégée", req("/", auth=None)[0] == 401)
ok("mot de passe faux -> 401", req("/api/forms", auth=basic("ci-admin", "faux"))[0] == 401)
ok("mot de passe avec accents -> 401 (et non 500)", req("/api/forms", auth=basic("ci-admin", "é€ü"))[0] == 401)
ok("admin autorisé", req("/api/forms")[0] == 200 and req("/api/whoami")[0] == 200)
ok("collecteur : liste des formulaires autorisée", req("/api/forms", auth=COLLECTOR)[0] == 200)
ok("collecteur : statistiques refusées (403)", req("/api/stats", auth=COLLECTOR)[0] == 403)
ok("collecteur : exports refusés (403)", req("/api/export/csv", auth=COLLECTOR)[0] == 403)
ok("collecteur : journal d'audit refusé (403)", req("/api/audit", auth=COLLECTOR)[0] == 403)

# --- CSRF : une requête modifiante sans l'en-tête personnalisé est refusée
s, _, _ = req("/api/forms", "POST", schema_probe := {"title": "x", "short_title": "x", "sections": []}, raw_headers={"X-Requested-With": ""})
ok("requête modifiante sans en-tête CSRF -> 403", s == 403, s)

# --- Formulaires
dup = {"title": "Doublons", "short_title": "Dup", "description": "", "sections": [{"title": "S", "questions": [
    {"name": "q1", "label": "A", "type": "text"}, {"name": "q1", "label": "B", "type": "text"}]}]}
ok("noms de question dupliqués refusés", req("/api/forms", "POST", dup)[0] == 400)
schema = {"title": "Enquête de test sécurité", "short_title": "Sécurité", "description": "", "sections": [{"title": "Terrain", "questions": [
    {"name": "person_name", "label": "Nom", "type": "text", "required": True},
    {"name": "province", "label": "Province", "type": "select", "options": ["Maniema", "Kasaï"]},
    {"name": "zone_sante", "label": "Zone de santé", "type": "text"},
    {"name": "gps_point", "label": "GPS", "type": "geopoint"}, {"name": "site_photo", "label": "Photo", "type": "image"},
    {"name": "visite", "label": "Date de visite", "type": "date"}]}]}
s, raw, _ = req("/api/forms", "POST", schema)
ok("création de formulaire", s == 200, raw)
form = json.loads(raw)
fid = form["id"]
ok("un nouveau formulaire est un brouillon", form["status"] == "draft")
ok("brouillon invisible du collecteur", all(f["id"] != fid for f in json.loads(req("/api/forms", auth=COLLECTOR)[1])))
ok("collecteur ne peut pas soumettre sur un brouillon", req("/api/submissions", "POST", {"form_id": fid, "data": {"person_name": "X"}}, auth=COLLECTOR)[0] == 404)
s, raw, _ = req(f"/api/forms/{fid}/share", "POST", {})
ok("création du lien public", s == 200, raw)
token = json.loads(raw)["token"]
ok("le partage publie le formulaire", json.loads(req(f"/api/forms/{fid}")[1])["status"] == "published")
ok("formulaire public lisible sans identifiants", req(f"/api/public/{token}/form", auth=None)[0] == 200)
s, qr, _ = req(f"/api/forms/{fid}/share/{token}/qr.png")
ok("QR code PNG", s == 200 and qr.startswith(b"\x89PNG"))

# --- Validation serveur
pub = lambda d: req(f"/api/public/{token}/submissions", "POST", {"data": d}, auth=None)
ok("champ obligatoire manquant -> 422", pub({"province": "Maniema"})[0] == 422)
ok("GPS hors limites -> 422", pub({"person_name": "B", "gps_point": {"latitude": 99, "longitude": 15, "accuracy": 5}})[0] == 422)
ok("choix invalide -> 422", pub({"person_name": "B", "province": "Mars"})[0] == 422)
ok("date invalide -> 422", pub({"person_name": "B", "visite": "31/12/2024"})[0] == 422)
ok("champ inconnu -> 422", pub({"person_name": "B", "intrus": 1})[0] == 422)
ok("image au contenu falsifié -> 422", pub({"person_name": "B", "site_photo": "data:image/jpeg;base64," + base64.b64encode(b"pas une image").decode()})[0] == 422)
buf = io.BytesIO(); Image.new("RGB", (4, 4), (40, 120, 90)).save(buf, "JPEG")
img = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
s, raw, _ = pub({"person_name": "Berly", "province": "Maniema", "zone_sante": "Kamina", "gps_point": {"latitude": -4.3, "longitude": 15.3, "accuracy": 5}, "site_photo": img, "visite": "2024-11-12"})
ok("soumission valide avec photo", s == 200, raw)
ok("soumission avec formule", pub({"person_name": "=1+1", "province": "Kasaï"})[0] == 200)

# --- Lecture, pièces jointes, statistiques, exports
s, raw, _ = req(f"/api/submissions?form_id={fid}")
listing = json.loads(raw)
ok("liste paginée légère (aucune image en base64)", s == 200 and listing["total"] == 2 and b"base64" not in raw)
photo_sub = next(i for i in listing["items"] if "site_photo" in i["data"])
s, jpg, h = req("/api/attachments/" + photo_sub["data"]["site_photo"]["attachment"])
ok("pièce jointe servie avec le bon type", s == 200 and jpg[:3] == b"\xff\xd8\xff" and h.get("Content-Type") == "image/jpeg")
ok("pièce jointe : id invalide -> 404", req("/api/attachments/../../etc/passwd")[0] == 404)
st = json.loads(req("/api/stats")[1])
ok("statistiques : structure et valeurs", st["kpis"]["submissions"] >= 2 and st["kpis"]["gps"] >= 1 and len(st["trend"]) == 30 and "provinces" in st["options"])
ok("statistiques : période invalide -> 422", req("/api/stats?date_from=pas-une-date")[0] == 422)
ok("statistiques d'un formulaire", req(f"/api/forms/{fid}/stats")[0] == 200)
s, csv_bytes, _ = req("/api/export/csv")
ok("CSV : formule neutralisée, photo exclue", s == 200 and b"'=1+1" in csv_bytes and b"base64" not in csv_bytes, csv_bytes[:200])
s, xlsx, _ = req("/api/export/xlsx")
ws = load_workbook(io.BytesIO(xlsx)).active
ok("XLSX valide", s == 200 and ws.max_row >= 3)
ok("export JSON", req("/api/export/json")[0] == 200)
audit = json.loads(req("/api/audit")[1])
ok("journal d'audit renseigné", {"form.create", "link.create", "export.csv"} <= {a["action"] for a in audit})
ok("api/system", json.loads(req("/api/system")[1])["security"]["collector_account"] is True)

# --- Collecte par compte collecteur (nom d'enquêteur encodé)
s, raw, _ = req("/api/submissions", "POST", {"id": "ci-sub-1", "form_key": form["key"], "data": {"person_name": "Collecteur"}}, auth=COLLECTOR, raw_headers={"X-Collector": "Awa%20Kasongo"})
ok("collecteur : soumission par form_key", s == 200, raw)
ok("soumission rejouée = idempotente", json.loads(req("/api/submissions", "POST", {"id": "ci-sub-1", "form_key": form["key"], "data": {"person_name": "Collecteur"}}, auth=COLLECTOR)[1]).get("duplicate") is True)
ok("enquêteur identifié", any(c["name"] == "Awa Kasongo" for c in json.loads(req("/api/collectors")[1])))

# --- Cycle de vie
ok("suppression refusée si des soumissions existent", req(f"/api/forms/{fid}", "DELETE")[0] == 409)
ok("révocation du lien", req(f"/api/links/{token}/revoke", "POST", {})[0] == 200)
ok("lien révoqué -> 404", req(f"/api/public/{token}/form", auth=None)[0] == 404)
ok("dépublication", req(f"/api/forms/{fid}/unpublish", "POST", {})[0] == 200)

# --- Blocages (en dernier : verrouillent l'IP de test)
p = urlparse(BASE)
conn = http.client.HTTPConnection(p.hostname, p.port)
conn.request("POST", "/api/submissions", body=iter([b"{}"]), headers={"Authorization": ADMIN, "Content-Type": "application/json", "Transfer-Encoding": "chunked"}, encode_chunked=True)
ok("corps chunked sans Content-Length -> 411", conn.getresponse().status == 411)
s2, raw2, _ = req("/api/forms", "POST", schema)
token2 = json.loads(req(f"/api/forms/{json.loads(raw2)['id']}/share", "POST", {})[1])["token"]
codes = [req(f"/api/public/{token2}/submissions", "POST", {"data": {"person_name": "x"}}, auth=None)[0] for _ in range(16)]
ok("limitation de débit publique -> 429", 429 in codes and codes[0] == 200, codes)
codes = [req("/api/forms", auth=basic("ci-admin", f"x{i}"))[0] for i in range(11)]
ok("verrouillage après tentatives échouées -> 429", codes[-1] == 429, codes)
print("\nTous les contrôles API sont passés.")
