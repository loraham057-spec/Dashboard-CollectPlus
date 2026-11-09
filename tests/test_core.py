"""Tests unitaires de la logique métier (sans serveur ni FastAPI) : python -m unittest tests.test_core -v"""
import base64, io, json, os, sqlite3, sys, tempfile, unittest
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image
from openpyxl import Workbook
from app import core
from app.core import AppError


def jpeg_data_url(size=(40, 30)):
    buf = io.BytesIO(); Image.new("RGB", size, (200, 30, 30)).save(buf, "JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


SECTIONS = [{"title": "Infos", "questions": [
    {"name": "province", "label": "Province", "type": "select", "required": True, "options": ["Haut-Lomami", "Maniema"]},
    {"name": "zone_sante", "label": "Zone de santé", "type": "text"},
    {"name": "aire_sante", "label": "Aire de santé", "type": "text"},
    {"name": "age", "label": "Âge", "type": "number"},
    {"name": "email", "label": "E-mail", "type": "email"},
    {"name": "date_visite", "label": "Date", "type": "date"},
    {"name": "maladies", "label": "Maladies", "type": "multiselect", "options": ["Rougeole", "Choléra"]},
    {"name": "gps", "label": "Position", "type": "geopoint"},
    {"name": "photo", "label": "Photo", "type": "image"}]}]


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False); self.tmp.close()
        with core.connect(self.tmp.name) as c:
            core.init_schema(c)
            self.form = core.create_form(c, "Enquête test", "Test", "", SECTIONS, status="published")

    def tearDown(self):
        for ext in ("", "-wal", "-shm"):
            try: os.unlink(self.tmp.name + ext)
            except FileNotFoundError: pass

    def store(self, data, sub_id="s1", at=None, collector="alice"):
        with core.connect(self.tmp.name) as c:
            return core.store_submission(c, core.get_form(c, self.form["id"]), sub_id, data, at, collector)

    # -- formulaires
    def test_form_rejects_duplicates_and_drops_unknown_keys(self):
        with core.connect(self.tmp.name) as c:
            with self.assertRaises(AppError):
                core.create_form(c, "Doublons", "Dup", "", [{"title": "s", "questions": [
                    {"name": "a", "label": "A", "type": "text"}, {"name": "a", "label": "B", "type": "text"}]}])
            f = core.create_form(c, "Propre", "Propre", "", [{"title": "s", "questions": [
                {"name": "a", "label": "A", "type": "text", "evil": "<script>"}]}])
            self.assertNotIn("evil", f["sections"][0]["questions"][0])
            self.assertEqual(f["status"], "draft")

    def test_datetime_type_is_accepted(self):
        with core.connect(self.tmp.name) as c:
            core.create_form(c, "DT", "DT", "", [{"title": "s", "questions": [{"name": "d", "label": "D", "type": "datetime"}]}])

    # -- validation
    def test_required_choice_and_gps_bounds(self):
        with self.assertRaises(AppError): self.store({})
        with self.assertRaises(AppError): self.store({"province": "Inconnue"})
        with self.assertRaises(AppError): self.store({"province": "Maniema", "gps": {"latitude": 91, "longitude": 0, "accuracy": 5}})
        with self.assertRaises(AppError): self.store({"province": "Maniema", "gps": {"latitude": 0, "longitude": 181, "accuracy": 5}})
        with self.assertRaises(AppError): self.store({"province": "Maniema", "gps": {"latitude": float("nan"), "longitude": 0, "accuracy": 5}})

    def test_formats(self):
        for bad in ({"email": "pas-un-mail"}, {"date_visite": "31/12/2024"}, {"age": "abc"}, {"inconnu": 1}):
            with self.assertRaises(AppError): self.store({"province": "Maniema", **bad})
        r = self.store({"province": "Maniema", "age": "12,5", "email": "a@b.cd", "date_visite": "2024-12-31"})
        self.assertTrue(r["ok"])
        with core.connect(self.tmp.name) as c:
            self.assertEqual(core.get_submission(c, "s1")["data"]["age"], 12.5)

    def test_image_stored_as_attachment_and_validated(self):
        with self.assertRaises(AppError): self.store({"province": "Maniema", "photo": "data:image/jpeg;base64," + base64.b64encode(b"pas une image").decode()})
        with self.assertRaises(AppError): self.store({"province": "Maniema", "photo": "data:image/svg+xml;base64,AAAA"})
        self.store({"province": "Maniema", "photo": jpeg_data_url()})
        with core.connect(self.tmp.name) as c:
            sub = core.get_submission(c, "s1")
            att = sub["data"]["photo"]
            self.assertIn("attachment", att)
            self.assertNotIn("base64", json.dumps(sub))  # la liste reste légère
            self.assertEqual(c.execute("SELECT COUNT(*) FROM attachments").fetchone()[0], 1)

    def test_idempotent_sync_and_conflict(self):
        self.store({"province": "Maniema"}, "dup")
        self.assertTrue(self.store({"province": "Maniema"}, "dup")["duplicate"])
        with core.connect(self.tmp.name) as c:
            other = core.create_form(c, "Autre", "Autre", "", [{"title": "s", "questions": [{"name": "x", "label": "X", "type": "text"}]}])
            with self.assertRaises(AppError):
                core.store_submission(c, other, "dup", {}, None)
        with self.assertRaises(AppError): self.store({"province": "Maniema"}, "mauvais id!")

    def test_date_normalisation_and_future_clamp(self):
        self.assertEqual(core.normalize_submitted_at("2024-11-12T10:00:00Z"), "2024-11-12T10:00:00+00:00")
        self.assertEqual(core.normalize_submitted_at("2024-11-12T11:00:00+01:00"), "2024-11-12T10:00:00+00:00")
        future = (datetime.now(timezone.utc) + timedelta(days=400)).isoformat()
        self.assertLessEqual(core.normalize_submitted_at(future), core.utc_now())
        with self.assertRaises(AppError): core.normalize_submitted_at("pas une date")

    # -- statistiques
    def test_dashboard_stats_and_filters(self):
        today = datetime.now(timezone.utc)
        for i in range(6):
            data = {"province": "Maniema" if i % 2 else "Haut-Lomami", "zone_sante": f"Z{i % 3}", "aire_sante": f"A{i}"}
            if i < 4: data["gps"] = {"latitude": -3.0 - i * .1, "longitude": 26.0, "accuracy": 8}
            self.store(data, f"x{i}", (today - timedelta(days=i)).isoformat(), "alice" if i < 3 else "bob")
        self.store({"province": "Maniema"}, "pub", None, "public")
        with core.connect(self.tmp.name) as c:
            st = core.dashboard_stats(c)
            self.assertEqual(st["kpis"]["submissions"], 7)
            self.assertEqual(st["kpis"]["gps"], 4)
            self.assertEqual(st["kpis"]["collectors"], 2)           # « public » exclu
            self.assertEqual(len(st["trend"]), 30)
            self.assertEqual(sum(t["total"] for t in st["trend"]), 7)
            self.assertEqual(len(st["geo"]), 4)
            self.assertEqual(core.dashboard_stats(c, province="Maniema")["kpis"]["submissions"], 4)
            self.assertEqual(core.dashboard_stats(c, province="Maniema", zone="Z1")["kpis"]["submissions"], 1)
            self.assertIn("Maniema", st["options"]["provinces"])
            self.assertEqual(core.dashboard_stats(c, date_from="2000-01-01", date_to="2000-01-02")["kpis"]["submissions"], 0)
            with self.assertRaises(AppError): core.dashboard_stats(c, date_from="2010-01-01", date_to="2020-01-01")
            fs = core.form_stats(c, core.get_form(c, self.form["id"]))
            self.assertEqual(fs["kpis"]["submissions"], 7)
            self.assertTrue(any(ch["kind"] == "choice" for ch in fs["charts"]))
            lst = core.list_submissions(c, limit=3, offset=0)
            self.assertEqual((lst["total"], len(lst["items"])), (7, 3))
            self.assertEqual(core.list_submissions(c, search="Maniema")["total"], 4)
            self.assertEqual(core.list_submissions(c, search="%")["total"], 0)  # % n'est pas un joker

    def test_location_roles(self):
        roles = core.location_roles(self.form)
        self.assertEqual(roles, {"province": "province", "zone": "zone_sante", "aire": "aire_sante"})

    # -- exports
    def test_exports_neutralise_formulas_and_skip_photos(self):
        self.store({"province": "Maniema", "zone_sante": "=1+1", "aire_sante": "-5", "photo": jpeg_data_url(),
                    "gps": {"latitude": -3.1, "longitude": 26.2, "accuracy": 7}, "maladies": ["Rougeole", "Choléra"]})
        with core.connect(self.tmp.name) as c:
            headers, rows = core.export_rows(c)
        row = dict(zip(headers, rows[0]))
        self.assertEqual(row["zone_sante"], "'=1+1")
        self.assertEqual(row["aire_sante"], "-5")            # nombre négatif légitime conservé
        self.assertEqual(row["photo"], "[photo]")
        self.assertEqual(row["gps_latitude"], -3.1)
        self.assertEqual(row["maladies"], "Rougeole | Choléra")
        self.assertTrue(core.export_csv_text(headers, rows).startswith("\ufeff"))
        self.assertGreater(len(core.export_xlsx_bytes(headers, rows)), 1000)

    # -- migration d'une base v0.7.x
    def test_backfill_legacy_rows(self):
        path = self.tmp.name + ".legacy"
        con = sqlite3.connect(path)
        con.executescript("""CREATE TABLE forms (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, short_title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '', schema_json TEXT NOT NULL, created_at TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE submissions (id TEXT PRIMARY KEY, form_id INTEGER NOT NULL, payload_json TEXT NOT NULL, submitted_at TEXT NOT NULL);""")
        schema = {"key": "k", "title": "Ancien", "short_title": "Ancien", "sections": core.normalize_sections(SECTIONS)}
        con.execute("INSERT INTO forms(title, short_title, schema_json, created_at) VALUES ('Ancien','Ancien',?, '2024-01-01T00:00:00+00:00')", (json.dumps(schema),))
        payload = {"province": "Maniema", "gps": {"latitude": -3.0, "longitude": 26.0, "accuracy": 9, "display": "x"}, "photo": jpeg_data_url()}
        con.execute("INSERT INTO submissions VALUES ('old1', 1, ?, '2024-05-01T10:00:00Z')", (json.dumps(payload),)); con.commit(); con.close()
        try:
            with core.connect(path) as c:
                core.init_schema(c)
            with core.connect(path) as c:
                core.init_schema(c)  # idempotent : un second démarrage ne change rien
                row = c.execute("SELECT province, has_gps, day, payload_json FROM submissions").fetchone()
                self.assertEqual((row["province"], row["has_gps"], row["day"]), ("Maniema", 1, "2024-05-01"))
                self.assertNotIn("base64", row["payload_json"])
                self.assertEqual(c.execute("SELECT COUNT(*) FROM attachments").fetchone()[0], 1)
                self.assertEqual(c.execute("SELECT status FROM forms").fetchone()[0], "published")
        finally:
            for ext in ("", "-wal", "-shm"):
                try: os.unlink(path + ext)
                except FileNotFoundError: pass

    # -- import XLSForm
    def test_xlsform_import(self):
        wb = Workbook(); s = wb.active; s.title = "survey"
        s.append(["type", "name", "label", "required", "relevant"])
        s.append(["begin_group", "g1", "Identification", None, None])
        s.append(["select_one oui_non", "Fumeur-1", "Fumeur ?", "yes", None])
        s.append(["datetime", "quand", "Quand ?", None, "${fumeur_1}='oui'"])
        s.append(["geopoint", "pos", "Position", None, None])
        s.append(["calculate", "calc", "Calcul", None, None])
        s.append(["end_group", None, None, None, None])
        c = wb.create_sheet("choices"); c.append(["list_name", "name", "label"]); c.append(["oui_non", "oui", "Oui"]); c.append(["oui_non", "non", "Non"])
        buf = io.BytesIO(); wb.save(buf)
        core.check_xlsx_archive(buf.getvalue())
        parsed = core.parse_xlsform(buf.getvalue(), "test.xlsx")
        qs = parsed["sections"][0]["questions"]
        self.assertEqual([q["type"] for q in qs], ["select", "datetime", "geopoint"])   # calculate ignoré
        self.assertEqual(qs[0]["name"], "fumeur_1")
        self.assertEqual(parsed["ignored_rules"], 1)
        with core.connect(self.tmp.name) as c2:  # le résultat doit passer la validation serveur
            core.create_form(c2, parsed["title"], parsed["short_title"], parsed["description"], parsed["sections"])
        with self.assertRaises(AppError): core.check_xlsx_archive(b"pas un zip")

    def test_rate_limit(self):
        with core.connect(self.tmp.name) as c:
            counts = [core.rate_hit(c, "k", 60, now=1000)[0] for _ in range(5)]
            self.assertEqual(counts, [1, 2, 3, 4, 5])
            self.assertEqual(core.rate_hit(c, "k", 60, now=1060)[0], 1)

    def test_connection_is_closed_after_with(self):
        with core.connect(self.tmp.name) as c:
            pass
        with self.assertRaises(sqlite3.ProgrammingError):
            c.execute("SELECT 1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
