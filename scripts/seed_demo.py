"""Données de DÉMONSTRATION (optionnel) : python scripts/seed_demo.py [nombre]
Crée des formulaires et des soumissions fictives pour visualiser le tableau de bord."""
import json, random, sys, uuid, sqlite3
from datetime import datetime, timedelta, timezone
sys.path.insert(0, ".")
from app import main as m
m.init_db()
N = int(sys.argv[1]) if len(sys.argv) > 1 else 1248
random.seed(7)
CEN = {"Haut-Lomami": (-8.3, 25.5), "Maniema": (-3, 26), "Tanganyika": (-6.5, 27.5), "Sud-Kivu": (-3, 28.5), "Haut-Katanga": (-10.5, 27.5), "Kinshasa": (-4.33, 15.31), "Nord-Kivu": (-0.8, 29), "Kasaï": (-5, 21.5), "Équateur": (0.3, 20.5), "Ituri": (1.8, 29)}
def q(n, l, t="text", req=False, **k): return {"name": n, "label": l, "type": t, "required": req, **k}
def mk(short, title):
    s = {"key": "demo-" + short.lower().replace(" ", "-"), "title": title, "short_title": short, "description": "Formulaire de démonstration", "version": 1,
         "sections": [{"title": "Informations générales", "questions": [q("province", "Province", "select", True, options=list(CEN)), q("zone_sante", "Zone de santé", "text", True), q("reference_incident", "Référence"), q("gps", "Position GPS", "geopoint")]}]}
    with m.db_conn() as c:
        r = c.execute("SELECT id FROM forms WHERE short_title=?", (short,)).fetchone()
        if r: return r[0], s
        return c.execute("INSERT INTO forms(title,short_title,description,schema_json,created_at,is_system) VALUES(?,?,?,?,?,0)", (title, short, s["description"], json.dumps(s, ensure_ascii=False), m.utc_now())).lastrowid, s
forms = [(mk("MAPEPI", "Fiche d'accompagnement MAPEPI"), .38), (mk("Vaccination PEV", "Suivi de vaccination PEV"), .27), (mk("Supervision", "Supervision"), .15), (mk("Signalement d'incident", "Signalement d'incident"), .11), (mk("Enquête ménage", "Enquête ménage"), .09)]
now = datetime.now(timezone.utc); zones = [f"Zone {i}" for i in range(1, 37)]
with m.db_conn() as c:
    c.execute("DELETE FROM users WHERE name!='Berly LORA'")
    for i in range(18): c.execute("INSERT INTO users(name,role) VALUES(?,'enqueteur')", (f"Enquêteur {i+1}",))
    for i in range(5): c.execute("INSERT INTO users(name,role) VALUES(?,'admin')", (f"Admin {i+1}",))
    for i in range(N):
        (fid, _), _w = random.choices(forms, [w for _, w in forms])[0]
        d = now - timedelta(days=int(random.triangular(0, 40, 0)), minutes=random.randint(0, 1400))
        pv = random.choices(list(CEN), [40, 25, 20, 15, 12, 8, 10, 6, 5, 4])[0]
        data = {"province": pv, "zone_sante": random.choice(zones), "reference_incident": f"REF-{i:05d}", "statut_incident": random.choices(["Résolu", "En cours", "Ouvert"], [70, 20, 10])[0]}
        if random.random() < .79: data["gps"] = f"{CEN[pv][0]+random.uniform(-1.5,1.5):.5f} {CEN[pv][1]+random.uniform(-1.5,1.5):.5f}"
        if random.random() < .08: data.pop("zone_sante")
        c.execute("INSERT INTO submissions(id,form_id,payload_json,submitted_at) VALUES(?,?,?,?)", (str(uuid.uuid4()), fid, json.dumps(data, ensure_ascii=False), d.isoformat(timespec="seconds")))
    c.execute("UPDATE forms SET status='draft' WHERE short_title='Enquête ménage'")
print("Données de démonstration créées :", N)
