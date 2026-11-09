"""Logique métier de CollectPlus, indépendante de FastAPI (donc testable seule).

Contient : accès SQLite, migrations, validation des formulaires et des réponses,
stockage normalisé (colonnes dénormalisées + pièces jointes), statistiques,
exports et import XLSForm.
"""
from __future__ import annotations

import base64
import binascii
import csv
import io
import json
import math
import re
import sqlite3
import time
import unicodedata
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from openpyxl import Workbook, load_workbook
from PIL import Image, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 40_000_000  # protège contre les « decompression bombs »


class AppError(Exception):
    """Erreur métier convertie en réponse HTTP par la couche web."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


# --------------------------------------------------------------------------- #
# Constantes
# --------------------------------------------------------------------------- #
CHOICE_ONE = {"select", "select_one"}
CHOICE_MANY = {"multiselect", "select_multiple"}
GEO = {"geopoint", "gps"}
IMG = {"image", "photo"}
ALLOWED_QUESTION_TYPES = (
    {"text", "textarea", "number", "date", "time", "datetime", "email", "phone", "note"}
    | CHOICE_ONE | CHOICE_MANY | GEO | IMG
)
QUESTION_KEYS = ("name", "label", "type", "required", "hint", "options", "placeholder")
QUESTION_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
MAX_IMAGE_BYTES = 6 * 1024 * 1024
MAX_IMAGES_PER_SUBMISSION = 10
MAX_TEXT = 10_000
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
PHONE_RE = re.compile(r"^[+0-9 ().\-]{5,25}$")
FORM_STATUSES = ("draft", "published")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# Base de données
# --------------------------------------------------------------------------- #
class Conn(sqlite3.Connection):
    """Connexion qui valide/annule puis se FERME à la sortie du bloc `with`.

    La classe standard ne ferme jamais la connexion : sous charge, les
    descripteurs de fichiers fuient (corrigé ici).
    """

    def __exit__(self, exc_type, exc, tb):  # type: ignore[override]
        try:
            return super().__exit__(exc_type, exc, tb)
        finally:
            self.close()


def connect(path: str | Path) -> Conn:
    conn = sqlite3.connect(str(path), factory=Conn, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def init_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    conn.execute("""CREATE TABLE IF NOT EXISTS forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, short_title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', schema_json TEXT NOT NULL, created_at TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 0)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY, form_id INTEGER NOT NULL, payload_json TEXT NOT NULL,
        submitted_at TEXT NOT NULL, FOREIGN KEY(form_id) REFERENCES forms(id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS public_form_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
        FOREIGN KEY(form_id) REFERENCES forms(id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS public_rate_limits (
        ip_token_hash TEXT NOT NULL, window_start INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ip_token_hash, window_start))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, field TEXT NOT NULL, mime TEXT NOT NULL,
        size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
        action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
        ip_hash TEXT NOT NULL DEFAULT '')""")
    # Migrations additives (idempotentes)
    fcols = _columns(conn, "forms")
    if "status" not in fcols:
        conn.execute("ALTER TABLE forms ADD COLUMN status TEXT NOT NULL DEFAULT 'published'")
    if "published_at" not in fcols:
        conn.execute("ALTER TABLE forms ADD COLUMN published_at TEXT")
        conn.execute("UPDATE forms SET published_at = created_at WHERE status = 'published'")
    scols = _columns(conn, "submissions")
    for col, ddl in (("received_at", "TEXT"), ("day", "TEXT"), ("collector", "TEXT NOT NULL DEFAULT ''"),
                     ("province", "TEXT"), ("zone", "TEXT"), ("aire", "TEXT"),
                     ("lat", "REAL"), ("lon", "REAL"), ("accuracy", "REAL"), ("has_gps", "INTEGER")):
        if col not in scols:
            conn.execute(f"ALTER TABLE submissions ADD COLUMN {col} {ddl}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sub_form ON submissions(form_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sub_day ON submissions(day)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sub_geo ON submissions(province, zone, aire)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_rl_window ON public_rate_limits(window_start)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_att_sub ON attachments(submission_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at)")
    # Ancien modèle MAPEPI intégré : retiré s'il est vide, jamais supprimé s'il contient des données.
    legacy = conn.execute("SELECT id FROM forms WHERE short_title = 'Incidents MAPEPI' AND is_system = 1").fetchone()
    if legacy is not None:
        n = conn.execute("SELECT COUNT(*) FROM submissions WHERE form_id = ?", (legacy["id"],)).fetchone()[0]
        if n == 0:
            conn.execute("DELETE FROM forms WHERE id = ?", (legacy["id"],))
        else:
            conn.execute("UPDATE forms SET is_system = 0 WHERE id = ?", (legacy["id"],))
    backfill_submissions(conn)


def audit(conn: sqlite3.Connection, actor: str, action: str, target: str = "", detail: str = "", ip_hash: str = "") -> None:
    conn.execute("INSERT INTO audit_log(at, actor, action, target, detail, ip_hash) VALUES (?,?,?,?,?,?)",
                 (utc_now(), actor[:60], action[:60], str(target)[:120], detail[:500], ip_hash[:64]))


def rate_hit(conn: sqlite3.Connection, key_hash: str, window_s: int, now: int | None = None) -> tuple[int, int]:
    """Compte un appel dans la fenêtre fixe courante. Retourne (compteur, secondes avant réinitialisation)."""
    now = int(time.time()) if now is None else now
    window_start = now - (now % window_s)
    conn.execute("INSERT INTO public_rate_limits(ip_token_hash, window_start, request_count) VALUES (?,?,1) "
                 "ON CONFLICT(ip_token_hash, window_start) DO UPDATE SET request_count = request_count + 1",
                 (key_hash, window_start))
    count = conn.execute("SELECT request_count FROM public_rate_limits WHERE ip_token_hash=? AND window_start=?",
                         (key_hash, window_start)).fetchone()[0]
    if now % 20 == 0:  # purge régulière (index sur window_start)
        conn.execute("DELETE FROM public_rate_limits WHERE window_start < ?", (now - 3600,))
    return count, (window_s - (now % window_s)) or window_s


# --------------------------------------------------------------------------- #
# Formulaires
# --------------------------------------------------------------------------- #
def _bad(detail: str, status: int = 400) -> AppError:
    return AppError(status, detail)


def normalize_sections(sections: Any) -> list[dict[str, Any]]:
    """Valide la structure et ne conserve QUE les clés connues (pas de données arbitraires stockées)."""
    if not isinstance(sections, list) or not 1 <= len(sections) <= 50:
        raise _bad("Le formulaire doit contenir entre 1 et 50 sections.")
    names: set[str] = set()
    total = 0
    clean_sections: list[dict[str, Any]] = []
    for section in sections:
        if not isinstance(section, dict):
            raise _bad("Structure de section invalide.")
        title = section.get("title", "Section")
        desc = section.get("description", "") or ""
        questions = section.get("questions")
        if (not isinstance(title, str) or len(title) > 160 or not isinstance(desc, str) or len(desc) > 1000
                or not isinstance(questions, list) or not questions):
            raise _bad("Chaque section doit avoir un titre valide et au moins une question.")
        total += len(questions)
        if total > 300:
            raise _bad("Un formulaire ne peut pas dépasser 300 questions.")
        clean_questions = []
        for q in questions:
            if not isinstance(q, dict):
                raise _bad("Structure de question invalide.")
            name, label, qtype = q.get("name"), q.get("label"), q.get("type")
            if not isinstance(name, str) or not QUESTION_NAME_RE.fullmatch(name):
                raise _bad("Le nom de chaque question doit commencer par une lettre et ne contenir que lettres, chiffres ou underscore (64 max).")
            if name in names:
                raise _bad(f"Nom de question dupliqué : {name}.")
            names.add(name)
            if not isinstance(label, str) or not label.strip() or len(label) > 500:
                raise _bad(f"Libellé invalide pour la question {name}.")
            if qtype not in ALLOWED_QUESTION_TYPES:
                raise _bad(f"Type de réponse non pris en charge pour {name}.")
            hint = q.get("hint") or ""
            placeholder = q.get("placeholder") or ""
            if not isinstance(hint, str) or len(hint) > 1000 or not isinstance(placeholder, str) or len(placeholder) > 200:
                raise _bad(f"Indication trop longue pour {name}.")
            item: dict[str, Any] = {"name": name, "label": label.strip(), "type": qtype, "required": bool(q.get("required"))}
            if hint:
                item["hint"] = hint
            if placeholder:
                item["placeholder"] = placeholder
            if qtype in CHOICE_ONE | CHOICE_MANY:
                options = q.get("options")
                if (not isinstance(options, list) or not 1 <= len(options) <= 100
                        or any(not isinstance(x, str) or not x.strip() or len(x) > 200 for x in options)):
                    raise _bad(f"La question {name} doit avoir entre 1 et 100 choix valides.")
                cleaned = [x.strip() for x in options]
                if len(set(cleaned)) != len(cleaned):
                    raise _bad(f"Les choix de la question {name} doivent être uniques.")
                item["options"] = cleaned
            clean_questions.append(item)
        clean_sections.append({"title": title.strip() or "Section", "description": desc.strip(), "questions": clean_questions})
    return clean_sections


def form_questions(form: dict[str, Any]) -> list[dict[str, Any]]:
    return [q for s in form.get("sections", []) for q in s.get("questions", [])]


def form_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    schema = json.loads(row["schema_json"])
    schema.update(id=row["id"], created_at=row["created_at"], is_system=bool(row["is_system"]),
                  status=row["status"], published_at=row["published_at"])
    schema["has_gps"] = any(q.get("type") in GEO for q in form_questions(schema))
    return schema


def get_form(conn: sqlite3.Connection, form_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM forms WHERE id = ?", (form_id,)).fetchone()
    if row is None:
        raise AppError(404, "Enquête introuvable")
    return form_to_dict(row)


def find_form_by_key(conn: sqlite3.Connection, key: str) -> dict[str, Any] | None:
    for row in conn.execute("SELECT id, schema_json FROM forms").fetchall():
        try:
            if json.loads(row["schema_json"]).get("key") == key:
                return get_form(conn, row["id"])
        except (TypeError, ValueError):
            continue
    return None


def list_forms(conn: sqlite3.Connection, published_only: bool = False) -> list[dict[str, Any]]:
    sql = "SELECT f.*, (SELECT COUNT(*) FROM submissions s WHERE s.form_id=f.id) AS n FROM forms f"
    if published_only:
        sql += " WHERE f.status='published'"
    out = []
    for row in conn.execute(sql + " ORDER BY f.id ASC").fetchall():
        d = form_to_dict(row)
        d["submission_count"] = row["n"]
        out.append(d)
    return out


def create_form(conn: sqlite3.Connection, title: str, short_title: str, description: str,
                sections: Any, status: str = "draft") -> dict[str, Any]:
    clean = normalize_sections(sections)
    title, short_title, description = title.strip(), short_title.strip(), description.strip()
    if len(title) < 2 or len(short_title) < 2:
        raise _bad("Le titre et le titre court doivent contenir au moins 2 caractères utiles.")
    if status not in FORM_STATUSES:
        raise _bad("Statut de formulaire invalide.")
    schema = {"key": f"custom-{uuid.uuid4().hex[:8]}", "title": title, "short_title": short_title,
              "description": description, "version": 1, "sections": clean}
    now = utc_now()
    cur = conn.execute("INSERT INTO forms(title, short_title, description, schema_json, created_at, is_system, status, published_at)"
                       " VALUES (?,?,?,?,?,0,?,?)",
                       (title, short_title, description, json.dumps(schema, ensure_ascii=False), now, status,
                        now if status == "published" else None))
    return get_form(conn, int(cur.lastrowid))


# --------------------------------------------------------------------------- #
# Localisation et dénormalisation
# --------------------------------------------------------------------------- #
def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))


_ROLE_PATTERNS = {
    "aire": re.compile(r"aire.*sante|\bas\b|health.?area"),
    "zone": re.compile(r"zone.*sante|\bzs\b|health.?zone"),
    "province": re.compile(r"province"),
}


def location_roles(form: dict[str, Any]) -> dict[str, str]:
    """Associe province / zone / aire de santé aux questions du formulaire (par nom ou libellé)."""
    found: dict[str, str] = {}
    for q in form_questions(form):
        if q.get("type") in GEO | IMG | {"note"}:
            continue
        hay = _fold(f"{q.get('name', '')} {q.get('label', '')}").replace("_", " ")
        for role in ("aire", "zone", "province"):  # « aire » avant « zone » avant « province »
            if role not in found and _ROLE_PATTERNS[role].search(hay):
                found[role] = q["name"]
                break
    return found


def _short(value: Any) -> str | None:
    if value is None or isinstance(value, (dict, list)):
        return None
    text = str(value).strip()
    return text[:120] or None


def extract_columns(form: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    roles = location_roles(form)
    cols: dict[str, Any] = {r: _short(data.get(roles[r])) if r in roles else None for r in ("province", "zone", "aire")}
    cols.update(lat=None, lon=None, accuracy=None, has_gps=0)
    for q in form_questions(form):
        v = data.get(q["name"])
        if q.get("type") in GEO and isinstance(v, dict) and v.get("latitude") is not None:
            cols.update(lat=v["latitude"], lon=v["longitude"], accuracy=v.get("accuracy"), has_gps=1)
            break
    return cols


# --------------------------------------------------------------------------- #
# Validation et stockage des réponses
# --------------------------------------------------------------------------- #
def _decode_image(value: Any, name: str) -> tuple[str, bytes]:
    if not isinstance(value, str):
        raise AppError(422, f"Image invalide pour {name}.")
    m = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", value)
    if not m:
        raise AppError(422, f"Format d’image non autorisé pour {name}.")
    mime = m.group(1)
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise AppError(422, f"Image encodée invalide pour {name}.")
    ok = ((mime == "jpeg" and raw.startswith(b"\xff\xd8\xff")) or (mime == "png" and raw.startswith(b"\x89PNG\r\n\x1a\n"))
          or (mime == "webp" and len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"))
    if not ok:
        raise AppError(422, f"Le contenu du fichier ne correspond pas à son type image pour {name}.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise AppError(413, "Chaque image doit faire 6 Mo maximum après optimisation.")
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.format != mime.upper() or im.width > 8000 or im.height > 8000:
                raise AppError(422, f"Dimensions ou format d’image non autorisés pour {name}.")
            im.verify()
    except AppError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise AppError(422, f"Le fichier image est corrompu ou non décodable pour {name}.")
    return mime, raw


def _is_empty(v: Any) -> bool:
    return v is None or v == "" or v == []


def validate_submission(form: dict[str, Any], data: Any) -> tuple[dict[str, Any], list[tuple[str, str, str, bytes]]]:
    """Valide et NORMALISE les réponses. Retourne (données propres, pièces jointes[(id, champ, mime, octets)])."""
    if not isinstance(data, dict) or len(data) > 300:
        raise AppError(422, "Structure de réponses invalide.")
    by_name = {q["name"]: q for q in form_questions(form) if q.get("type") != "note"}
    if set(data) - set(by_name):
        raise AppError(422, "La soumission contient des champs inconnus.")
    clean: dict[str, Any] = {}
    attachments: list[tuple[str, str, str, bytes]] = []
    missing: list[str] = []
    for name, q in by_name.items():
        v, t = data.get(name), q.get("type")
        if _is_empty(v):
            if q.get("required"):
                missing.append(q.get("label") or name)
            continue
        opts = q.get("options", [])
        if t in CHOICE_ONE:
            if not isinstance(v, str) or v not in opts:
                raise AppError(422, f"Choix invalide pour {name}.")
            clean[name] = v
        elif t in CHOICE_MANY:
            if not isinstance(v, list) or len(set(map(str, v))) != len(v) or any(x not in opts for x in v):
                raise AppError(422, f"Sélection multiple invalide pour {name}.")
            clean[name] = list(v)
        elif t in GEO:
            try:
                lat, lon = float(v["latitude"]), float(v["longitude"])
                acc = float(v["accuracy"]) if v.get("accuracy") not in (None, "") else None
            except (KeyError, TypeError, ValueError, AttributeError):
                raise AppError(422, f"Coordonnées GPS invalides pour {name}.")
            vals = [lat, lon] + ([acc] if acc is not None else [])
            if not all(math.isfinite(x) for x in vals) or not -90 <= lat <= 90 or not -180 <= lon <= 180 \
                    or (acc is not None and not 0 <= acc <= 100000):
                raise AppError(422, f"Coordonnées GPS hors limites pour {name}.")
            clean[name] = {"latitude": round(lat, 7), "longitude": round(lon, 7), "accuracy": None if acc is None else round(acc, 1)}
        elif t in IMG:
            mime, raw = _decode_image(v, name)
            if len(attachments) >= MAX_IMAGES_PER_SUBMISSION:
                raise AppError(422, "Trop d’images dans une même soumission.")
            att_id = uuid.uuid4().hex
            attachments.append((att_id, name, f"image/{mime}", raw))
            clean[name] = {"attachment": att_id, "mime": f"image/{mime}"}
        elif t == "number":
            if isinstance(v, bool):
                raise AppError(422, f"Nombre invalide pour {name}.")
            try:
                num = float(str(v).replace(",", ".")) if isinstance(v, str) else float(v)
            except (TypeError, ValueError):
                raise AppError(422, f"Nombre invalide pour {name}.")
            if not math.isfinite(num) or abs(num) > 1e15:
                raise AppError(422, f"Nombre non fini ou trop grand pour {name}.")
            clean[name] = int(num) if num.is_integer() else num
        else:  # texte, date, heure, e-mail, téléphone
            if not isinstance(v, (str, int, float)) or isinstance(v, bool):
                raise AppError(422, f"Valeur invalide pour {name}.")
            s = str(v).replace("\x00", "").strip()
            if len(s) > MAX_TEXT:
                raise AppError(422, f"Valeur trop longue pour {name}.")
            try:
                if t == "date":
                    date.fromisoformat(s)
                elif t == "time":
                    datetime.strptime(s, "%H:%M:%S" if s.count(":") == 2 else "%H:%M")
                elif t == "datetime":
                    datetime.fromisoformat(s)
                elif t == "email" and not EMAIL_RE.fullmatch(s):
                    raise ValueError
                elif t == "phone" and not PHONE_RE.fullmatch(s):
                    raise ValueError
            except ValueError:
                raise AppError(422, f"Format invalide pour {name} ({t}).")
            clean[name] = s
    if missing:
        raise AppError(422, "Champs obligatoires manquants : " + ", ".join(missing))
    if sum(len(a[3]) for a in attachments) > 9 * 1024 * 1024:
        raise AppError(413, "Les images de cette soumission dépassent 9 Mo au total.")
    return clean, attachments


def normalize_submitted_at(value: str | None, now: datetime | None = None) -> str:
    """Convertit en UTC ISO-8601 homogène (tri fiable). Une date future est ramenée à l’instant présent."""
    now = now or datetime.now(timezone.utc)
    if value is None:
        return now.isoformat(timespec="seconds")
    if not isinstance(value, str) or len(value) > 64:
        raise AppError(422, "Date de soumission invalide.")
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise AppError(422, "La date de soumission doit être au format ISO 8601.")
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    d = d.astimezone(timezone.utc)
    if d.year < 2000:
        raise AppError(422, "Date de soumission invalide.")
    return min(d, now).isoformat(timespec="seconds")


def store_submission(conn: sqlite3.Connection, form: dict[str, Any], sub_id: str, data: dict[str, Any],
                     submitted_at: str | None, collector: str = "") -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", sub_id):
        raise AppError(422, "Identifiant de soumission invalide.")
    existing = conn.execute("SELECT form_id FROM submissions WHERE id = ?", (sub_id,)).fetchone()
    if existing is not None:  # synchronisation rejouée : accusé de réception idempotent
        if existing["form_id"] != form["id"]:
            raise AppError(409, "Identifiant de soumission déjà utilisé par une autre enquête.")
        return {"ok": True, "id": sub_id, "duplicate": True}
    clean, attachments = validate_submission(form, data)
    when = normalize_submitted_at(submitted_at)
    cols = extract_columns(form, clean)
    conn.execute(
        "INSERT INTO submissions(id, form_id, payload_json, submitted_at, received_at, day, collector, province, zone, aire, lat, lon, accuracy, has_gps)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (sub_id, form["id"], json.dumps(clean, ensure_ascii=False), when, utc_now(), when[:10], collector[:60],
         cols["province"], cols["zone"], cols["aire"], cols["lat"], cols["lon"], cols["accuracy"], cols["has_gps"]))
    for att_id, field, mime, raw in attachments:
        conn.execute("INSERT INTO attachments(id, submission_id, field, mime, size, data, created_at) VALUES (?,?,?,?,?,?,?)",
                     (att_id, sub_id, field, mime, len(raw), raw, utc_now()))
    return {"ok": True, "id": sub_id, "submitted_at": when}


def backfill_submissions(conn: sqlite3.Connection) -> int:
    """Migre les anciennes lignes : colonnes dénormalisées + photos (data URL) déplacées vers `attachments`."""
    rows = conn.execute("SELECT id, form_id, payload_json, submitted_at FROM submissions WHERE has_gps IS NULL").fetchall()
    forms_cache: dict[int, dict[str, Any]] = {}
    done = 0
    for r in rows:
        try:
            if r["form_id"] not in forms_cache:
                forms_cache[r["form_id"]] = get_form(conn, r["form_id"])
            form = forms_cache[r["form_id"]]
            data = json.loads(r["payload_json"])
            for q in form_questions(form):
                v = data.get(q["name"])
                if q.get("type") in IMG and isinstance(v, str) and v.startswith("data:image/"):
                    try:
                        mime, raw = _decode_image(v, q["name"])
                    except AppError:
                        data.pop(q["name"], None)
                        continue
                    att = uuid.uuid4().hex
                    conn.execute("INSERT INTO attachments(id, submission_id, field, mime, size, data, created_at) VALUES (?,?,?,?,?,?,?)",
                                 (att, r["id"], q["name"], f"image/{mime}", len(raw), raw, utc_now()))
                    data[q["name"]] = {"attachment": att, "mime": f"image/{mime}"}
                elif q.get("type") in GEO and isinstance(v, dict):
                    try:
                        data[q["name"]] = {"latitude": float(v["latitude"]), "longitude": float(v["longitude"]),
                                           "accuracy": float(v["accuracy"]) if v.get("accuracy") is not None else None}
                    except (KeyError, TypeError, ValueError):
                        data.pop(q["name"], None)
            try:
                when = normalize_submitted_at(r["submitted_at"])
            except AppError:
                when = r["submitted_at"]
            cols = extract_columns(form, data)
            conn.execute("UPDATE submissions SET payload_json=?, submitted_at=?, received_at=COALESCE(received_at, ?), day=?,"
                         " province=?, zone=?, aire=?, lat=?, lon=?, accuracy=?, has_gps=? WHERE id=?",
                         (json.dumps(data, ensure_ascii=False), when, when, when[:10], cols["province"], cols["zone"],
                          cols["aire"], cols["lat"], cols["lon"], cols["accuracy"], cols["has_gps"], r["id"]))
            done += 1
        except Exception:  # une ligne corrompue ne doit jamais empêcher le démarrage
            conn.execute("UPDATE submissions SET has_gps = 0 WHERE id = ?", (r["id"],))
    return done


# --------------------------------------------------------------------------- #
# Lecture / statistiques
# --------------------------------------------------------------------------- #
def sync_status(submitted_at: str, received_at: str | None) -> str:
    """« synchronisee » si la réponse est arrivée longtemps après sa saisie (collecte hors ligne)."""
    try:
        delta = datetime.fromisoformat(received_at) - datetime.fromisoformat(submitted_at)
        return "synchronisee" if delta > timedelta(minutes=5) else "enregistree"
    except (TypeError, ValueError):
        return "enregistree"


def _filters(date_from=None, date_to=None, province=None, zone=None, aire=None, form_id=None, search=None, alias="s"):
    where, args = [], []
    p = f"{alias}." if alias else ""
    if date_from:
        where.append(f"{p}day >= ?"); args.append(date_from)
    if date_to:
        where.append(f"{p}day <= ?"); args.append(date_to)
    for col, val in (("province", province), ("zone", zone), ("aire", aire)):
        if val:
            where.append(f"{p}{col} = ?"); args.append(val)
    if form_id:
        where.append(f"{p}form_id = ?"); args.append(int(form_id))
    if search:
        like = "%" + search.replace("%", r"\%").replace("_", r"\_") + "%"
        where.append(f"({p}id LIKE ? ESCAPE '\\' OR {p}payload_json LIKE ? ESCAPE '\\' OR {p}province LIKE ? ESCAPE '\\')")
        args += [like, like, like]
    return (" WHERE " + " AND ".join(where)) if where else "", args


def parse_day(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        raise AppError(422, "Date invalide (format attendu AAAA-MM-JJ).")


def _place(prov, zone, aire) -> str:
    return " · ".join(x for x in (prov, zone, aire) if x) or "—"


def dashboard_stats(conn: sqlite3.Connection, date_from=None, date_to=None, province=None, zone=None,
                    aire=None, form_id=None, admins: int = 1) -> dict[str, Any]:
    today = datetime.now(timezone.utc).date()
    d_to = date.fromisoformat(parse_day(date_to)) if date_to else today
    d_from = date.fromisoformat(parse_day(date_from)) if date_from else d_to - timedelta(days=29)
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    span = (d_to - d_from).days + 1
    if span > 1900:
        raise AppError(422, "Période trop longue (5 ans maximum).")
    f, fa = d_from.isoformat(), d_to.isoformat()
    where, args = _filters(f, fa, province, zone, aire, form_id)
    total, gps = conn.execute(f"SELECT COUNT(*), COALESCE(SUM(s.has_gps),0) FROM submissions s{where}", args).fetchone()
    # Période précédente de même durée (croissance)
    pf, pt = (d_from - timedelta(days=span)).isoformat(), (d_from - timedelta(days=1)).isoformat()
    pw, pa = _filters(pf, pt, province, zone, aire, form_id)
    prev = conn.execute(f"SELECT COUNT(*) FROM submissions s{pw}", pa).fetchone()[0]
    growth = None if prev == 0 else round((total - prev) / prev * 100)
    by_day = {r["day"]: (r["n"], r["g"]) for r in conn.execute(
        f"SELECT s.day AS day, COUNT(*) AS n, COALESCE(SUM(s.has_gps),0) AS g FROM submissions s{where} GROUP BY s.day", args)}
    trend = []
    for i in range(span):
        d = (d_from + timedelta(days=i)).isoformat()
        n, g = by_day.get(d, (0, 0))
        trend.append({"date": d, "total": n, "gps": g})
    collectors = conn.execute(f"SELECT COUNT(DISTINCT s.collector) FROM submissions s{where}"
                              + (" AND" if where else " WHERE") + " s.collector NOT IN ('', 'public')", args).fetchone()[0]
    geo = [{"id": r["id"], "form_id": r["form_id"], "form": r["short_title"], "lat": r["lat"], "lon": r["lon"],
            "province": r["province"], "zone": r["zone"], "aire": r["aire"], "at": r["submitted_at"]}
           for r in conn.execute(
               f"SELECT s.id, s.form_id, f.short_title, s.lat, s.lon, s.province, s.zone, s.aire, s.submitted_at "
               f"FROM submissions s JOIN forms f ON f.id=s.form_id{where}" + (" AND" if where else " WHERE")
               + " s.has_gps=1 ORDER BY s.submitted_at DESC LIMIT 5000", args)]
    recent = [{"id": r["id"], "n": r["rowid"], "form": r["short_title"], "at": r["submitted_at"],
               "place": _place(r["province"], r["zone"], r["aire"]), "status": sync_status(r["submitted_at"], r["received_at"])}
              for r in conn.execute(
                  f"SELECT s.rowid AS rowid, s.id, s.submitted_at, s.received_at, s.province, s.zone, s.aire, f.short_title "
                  f"FROM submissions s JOIN forms f ON f.id=s.form_id{where} ORDER BY s.submitted_at DESC LIMIT 8", args)]
    forms = conn.execute("SELECT status, COUNT(*) FROM forms GROUP BY status").fetchall()
    counts = {r[0]: r[1] for r in forms}
    return {
        "range": {"from": f, "to": fa},
        "kpis": {"forms": sum(counts.values()), "published": counts.get("published", 0), "drafts": counts.get("draft", 0),
                 "submissions": total, "growth_pct": growth, "gps": int(gps), "gps_rate": round(gps / total * 100) if total else 0,
                 "collectors": collectors, "admins": admins},
        "trend": trend, "geo": geo, "recent": recent, "options": geo_options(conn, province, zone),
    }


def geo_options(conn: sqlite3.Connection, province=None, zone=None) -> dict[str, list[str]]:
    def distinct(col: str, where="", args=()):
        q = f"SELECT DISTINCT {col} FROM submissions WHERE {col} IS NOT NULL AND {col} != ''{where} ORDER BY {col} COLLATE NOCASE LIMIT 500"
        return [r[0] for r in conn.execute(q, args)]
    zw, za = (" AND province = ?", (province,)) if province else ("", ())
    aw, aa = ("", ())
    if zone:
        aw, aa = " AND zone = ?", (zone,)
    elif province:
        aw, aa = " AND province = ?", (province,)
    return {"provinces": distinct("province"), "zones": distinct("zone", zw, za), "aires": distinct("aire", aw, aa)}


def _payload_rows(conn, form_id, date_from=None, date_to=None):
    where, args = _filters(date_from, date_to, form_id=form_id)
    return [(json.loads(r["payload_json"]), r["has_gps"], r["zone"], r["aire"]) for r in
            conn.execute(f"SELECT s.payload_json, s.has_gps, s.zone, s.aire FROM submissions s{where}", args)]


def form_stats(conn: sqlite3.Connection, form: dict[str, Any], date_from=None, date_to=None) -> dict[str, Any]:
    date_from, date_to = parse_day(date_from), parse_day(date_to)
    rows = _payload_rows(conn, form["id"], date_from, date_to)
    total = len(rows)
    gps = sum(1 for r in rows if r[1])
    zones = {r[2] for r in rows if r[2]}
    aires = {r[3] for r in rows if r[3]}
    # Croissance sur 30 jours glissants
    today = datetime.now(timezone.utc).date()
    cur = conn.execute("SELECT COUNT(*) FROM submissions WHERE form_id=? AND day > ?", (form["id"], (today - timedelta(days=30)).isoformat())).fetchone()[0]
    prev = conn.execute("SELECT COUNT(*) FROM submissions WHERE form_id=? AND day > ? AND day <= ?",
                        (form["id"], (today - timedelta(days=60)).isoformat(), (today - timedelta(days=30)).isoformat())).fetchone()[0]
    growth = None if prev == 0 else round((cur - prev) / prev * 100)
    charts, completeness = [], []
    for q in form_questions(form):
        t = q.get("type")
        if t == "note":
            continue
        answered = sum(1 for r in rows if not _is_empty(r[0].get(q["name"])))
        completeness.append({"name": q["name"], "label": q["label"], "required": bool(q.get("required")),
                             "answered": answered, "rate": round(answered / total * 100) if total else 0})
        if len(charts) >= 3:
            continue
        if t in CHOICE_ONE | CHOICE_MANY:
            counts: dict[str, int] = {o: 0 for o in q.get("options", [])}
            for r in rows:
                v = r[0].get(q["name"])
                for x in (v if isinstance(v, list) else [v]):
                    if x in counts:
                        counts[x] += 1
            if any(counts.values()):
                charts.append({"kind": "choice", "name": q["name"], "label": q["label"],
                               "items": [{"label": k, "value": v} for k, v in counts.items()][:12]})
        elif t == "number":
            vals = [float(r[0][q["name"]]) for r in rows if isinstance(r[0].get(q["name"]), (int, float))]
            if len(vals) >= 2 and max(vals) > min(vals):
                lo, hi, bins = min(vals), max(vals), 5
                width = (hi - lo) / bins
                items = [{"label": f"{lo + i * width:.0f}–{lo + (i + 1) * width:.0f}", "value": 0} for i in range(bins)]
                for v in vals:
                    items[min(bins - 1, int((v - lo) / width))]["value"] += 1
                charts.append({"kind": "histogram", "name": q["name"], "label": q["label"], "items": items})
    accs = sorted(r["accuracy"] for r in conn.execute(
        "SELECT accuracy FROM submissions WHERE form_id=? AND has_gps=1 AND accuracy IS NOT NULL", (form["id"],)))
    return {"kpis": {"submissions": total, "gps": gps, "gps_rate": round(gps / total * 100) if total else 0,
                     "zones": len(zones), "aires": len(aires), "growth_pct": growth},
            "charts": charts, "quality": {"completeness": completeness,
                                          "median_accuracy": accs[len(accs) // 2] if accs else None}}


def list_submissions(conn: sqlite3.Connection, limit=50, offset=0, date_from=None, date_to=None, province=None,
                     zone=None, aire=None, form_id=None, search=None) -> dict[str, Any]:
    limit = max(1, min(int(limit), 500))
    offset = max(0, int(offset))
    where, args = _filters(parse_day(date_from), parse_day(date_to), province, zone, aire, form_id, search)
    total = conn.execute(f"SELECT COUNT(*) FROM submissions s{where}", args).fetchone()[0]
    rows = conn.execute(
        f"SELECT s.rowid AS n, s.id, s.form_id, f.title AS form_title, f.short_title, s.payload_json, s.submitted_at, s.received_at,"
        f" s.collector, s.province, s.zone, s.aire, s.has_gps, s.lat, s.lon FROM submissions s JOIN forms f ON f.id=s.form_id{where}"
        f" ORDER BY s.submitted_at DESC, s.rowid DESC LIMIT ? OFFSET ?", args + [limit, offset]).fetchall()
    items = [{"n": r["n"], "id": r["id"], "form_id": r["form_id"], "form_title": r["form_title"], "short_title": r["short_title"],
              "data": json.loads(r["payload_json"]), "submitted_at": r["submitted_at"], "collector": r["collector"],
              "place": _place(r["province"], r["zone"], r["aire"]), "has_gps": bool(r["has_gps"]), "lat": r["lat"], "lon": r["lon"],
              "status": sync_status(r["submitted_at"], r["received_at"])} for r in rows]
    return {"total": total, "limit": limit, "offset": offset, "items": items}


def get_submission(conn: sqlite3.Connection, sub_id: str) -> dict[str, Any]:
    r = conn.execute("SELECT s.*, s.rowid AS n, f.title AS form_title, f.short_title FROM submissions s JOIN forms f ON f.id=s.form_id WHERE s.id=?",
                     (sub_id,)).fetchone()
    if r is None:
        raise AppError(404, "Soumission introuvable")
    return {"n": r["n"], "id": r["id"], "form_id": r["form_id"], "form_title": r["form_title"], "short_title": r["short_title"],
            "data": json.loads(r["payload_json"]), "submitted_at": r["submitted_at"], "received_at": r["received_at"],
            "collector": r["collector"], "place": _place(r["province"], r["zone"], r["aire"]), "has_gps": bool(r["has_gps"]),
            "lat": r["lat"], "lon": r["lon"], "status": sync_status(r["submitted_at"], r["received_at"])}


def list_collectors(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [{"name": r["collector"], "submissions": r["n"], "gps": r["g"], "first": r["first"], "last": r["last"]}
            for r in conn.execute("SELECT collector, COUNT(*) AS n, COALESCE(SUM(has_gps),0) AS g, MIN(submitted_at) AS first,"
                                  " MAX(submitted_at) AS last FROM submissions GROUP BY collector ORDER BY last DESC")]


# --------------------------------------------------------------------------- #
# Exports
# --------------------------------------------------------------------------- #
_NUMERIC_RE = re.compile(r"^[+-]?\d+([.,]\d+)?$")


def neutralize(text: str) -> str:
    """Neutralise l’injection de formules (CSV/Excel) sans casser les nombres négatifs légitimes."""
    if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) and not _NUMERIC_RE.fullmatch(text.strip()):
        return "'" + text
    return text


def export_rows(conn: sqlite3.Connection, form_id: int | None = None) -> tuple[list[str], list[list[Any]]]:
    where, args = _filters(form_id=form_id)
    rows = conn.execute(f"SELECT s.id, s.form_id, f.title, s.submitted_at, s.collector, s.payload_json FROM submissions s "
                        f"JOIN forms f ON f.id=s.form_id{where} ORDER BY s.submitted_at DESC", args).fetchall()
    keys: list[str] = []
    parsed = []
    for r in rows:
        data = json.loads(r["payload_json"])
        parsed.append((r, data))
        for k, v in data.items():
            cols = [f"{k}_latitude", f"{k}_longitude", f"{k}_precision_m"] if isinstance(v, dict) and "latitude" in v else [k]
            for c in cols:
                if c not in keys:
                    keys.append(c)
    headers = ["id", "form_id", "form_title", "submitted_at", "collector"] + keys
    out = []
    for r, data in parsed:
        flat: dict[str, Any] = {}
        for k, v in data.items():
            if isinstance(v, dict) and "latitude" in v:
                flat.update({f"{k}_latitude": v["latitude"], f"{k}_longitude": v["longitude"], f"{k}_precision_m": v.get("accuracy")})
            elif isinstance(v, dict) and "attachment" in v:
                flat[k] = "[photo]"  # les photos ne sont pas incluses dans CSV/Excel (limite 32 767 car. par cellule)
            elif isinstance(v, list):
                flat[k] = " | ".join(map(str, v))
            else:
                flat[k] = v
        line: list[Any] = [r["id"], r["form_id"], r["title"], r["submitted_at"], r["collector"]]
        for k in keys:
            v = flat.get(k, "")
            line.append(neutralize(v) if isinstance(v, str) else ("" if v is None else v))
        out.append([neutralize(x) if isinstance(x, str) else x for x in line[:5]] + line[5:])
    return headers, out


def export_csv_text(headers, rows) -> str:
    buf = io.StringIO(newline="")
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    return "\ufeff" + buf.getvalue()  # BOM pour les accents sous Excel


def export_xlsx_bytes(headers, rows) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Soumissions"
    ws.append(headers)
    for r in rows:
        ws.append(r)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for col in ws.columns:
        width = max((len(str(c.value or "")) for c in col), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(max(width + 2, 12), 42)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def export_json_text(conn: sqlite3.Connection, form_id: int | None = None) -> str:
    return json.dumps(_all_submissions(conn, form_id), ensure_ascii=False, indent=2)


def _all_submissions(conn, form_id):
    where, args = _filters(form_id=form_id)
    return [{"id": r["id"], "form_id": r["form_id"], "form_title": r["title"], "submitted_at": r["submitted_at"],
             "collector": r["collector"], "data": json.loads(r["payload_json"])}
            for r in conn.execute(f"SELECT s.id, s.form_id, f.title, s.submitted_at, s.collector, s.payload_json FROM submissions s "
                                  f"JOIN forms f ON f.id=s.form_id{where} ORDER BY s.submitted_at DESC", args)]


# --------------------------------------------------------------------------- #
# Import XLSForm / JSON
# --------------------------------------------------------------------------- #
_META_TYPES = {"start", "end", "today", "deviceid", "subscriberid", "simserial", "phonenumber", "username",
               "calculate", "hidden", "audit", "start-geopoint"}


def check_xlsx_archive(content: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            total = 0
            for e in z.infolist():
                total += e.file_size
                if e.file_size > 15 * 1024 * 1024 or (e.compress_size and e.file_size / e.compress_size > 100):
                    raise AppError(400, "Fichier Excel suspect : ratio de compression anormal.")
            if total > 25 * 1024 * 1024:
                raise AppError(400, "Le contenu décompressé du fichier Excel dépasse 25 Mo.")
    except zipfile.BadZipFile:
        raise AppError(400, "Le fichier Excel n’est pas une archive XLSX valide.")


def _clean_name(raw: str, used: set[str], index: int) -> str:
    name = re.sub(r"[^A-Za-z0-9_]", "_", _fold(raw))[:60].strip("_") or f"question_{index}"
    if not name[0].isalpha():
        name = "q_" + name
    base, n = name, 2
    while name in used:
        name = f"{base}_{n}"[:64]; n += 1
    used.add(name)
    return name


def parse_xlsform(content: bytes, filename: str) -> dict[str, Any]:
    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise AppError(400, f"Impossible de lire le fichier XLSForm : {exc}")
    try:
        if "survey" not in wb.sheetnames:
            raise AppError(400, "Le fichier Excel doit contenir une feuille 'survey'.")
        rows = list(wb["survey"].iter_rows(values_only=True))
        if len(rows) > 1001:
            raise AppError(400, "La feuille survey dépasse la limite de 1 000 lignes de questions.")
        if not rows:
            raise AppError(400, "La feuille survey est vide.")
        head = lambda r: [str(v).strip().lower() if v is not None else "" for v in r]  # noqa: E731
        headers = head(rows[0])
        table = [dict(zip(headers, r)) for r in rows[1:]]
        settings: dict[str, Any] = {}
        if "settings" in wb.sheetnames:
            srows = list(wb["settings"].iter_rows(values_only=True))
            if len(srows) > 10:
                raise AppError(400, "La feuille settings dépasse 10 lignes.")
            if len(srows) > 1:
                settings = dict(zip(head(srows[0]), srows[1]))
        choices: dict[str, list[str]] = {}
        if "choices" in wb.sheetnames:
            crows = list(wb["choices"].iter_rows(values_only=True))
            if len(crows) > 5001:
                raise AppError(400, "La feuille choices dépasse la limite de 5 000 choix.")
            if crows:
                ch = head(crows[0])
                for crow in crows[1:]:
                    rec = dict(zip(ch, crow))
                    ln = str(rec.get("list_name") or "").strip()
                    lab = str(rec.get("label::french (fr)") or rec.get("label::fr") or rec.get("label") or rec.get("name") or "").strip()
                    if ln and lab and lab not in choices.setdefault(ln, []):
                        choices[ln].append(lab)
    finally:
        wb.close()

    sections: list[dict[str, Any]] = [{"title": "Questionnaire", "description": "", "questions": []}]
    current = sections[0]
    unsupported: set[str] = set()
    ignored_rules = 0
    used: set[str] = set()
    for i, rec in enumerate(table, start=1):
        raw_type = str(rec.get("type") or "").strip()
        if not raw_type or raw_type.startswith("#"):
            continue
        name = str(rec.get("name") or "").strip()
        label = str(rec.get("label::french (fr)") or rec.get("label::fr") or rec.get("label") or name).strip()
        if raw_type in ("begin_group", "begin group"):
            current = {"title": (label or name or "Section")[:160], "description": "", "questions": []}
            sections.append(current)
            continue
        if raw_type in ("end_group", "end group"):
            current = sections[0]
            continue
        if raw_type.split()[0] in _META_TYPES or not name or not label:
            continue
        for rule in ("relevant", "constraint", "calculation"):
            if str(rec.get(rule) or "").strip():
                ignored_rules += 1
                break
        q: dict[str, Any] = {"name": _clean_name(name, used, i), "label": label[:500],
                             "required": str(rec.get("required") or "").strip().lower() in ("yes", "true", "1", "true()")}
        hint = str(rec.get("hint::french (fr)") or rec.get("hint") or "").strip()
        if hint:
            q["hint"] = hint[:1000]
        kind, _, list_name = raw_type.partition(" ")
        if kind in ("select_one", "select_multiple"):
            q["type"] = "select" if kind == "select_one" else "multiselect"
            q["options"] = (choices.get(list_name.strip()) or [])[:100]
            if not q["options"]:
                q["options"] = ["Valeur 1", "Valeur 2"]
                q["hint"] = (q.get("hint", "") + " Liste de choix à vérifier après importation.").strip()
        elif kind in ("integer", "decimal"):
            q["type"] = "number"
        elif kind in ("date", "time", "datetime", "text", "email", "note", "geopoint", "image"):
            q["type"] = kind
        elif kind in ("audio", "barcode"):
            q["type"] = "text"; unsupported.add(kind)
        else:
            q["type"] = "text"; unsupported.add(kind)
        current["questions"].append(q)
    sections = [s for s in sections if s["questions"]]
    if not sections:
        raise AppError(400, "Aucune question exploitable n’a été trouvée dans la feuille survey.")
    title = str(settings.get("form_title") or settings.get("form_id") or Path(filename).stem).strip()
    return {"title": title[:160], "short_title": title[:80], "sections": sections,
            "description": f"Formulaire importé depuis {filename}. Vérifiez les règles conditionnelles et les types de questions.",
            "import_warnings": sorted(unsupported), "ignored_rules": ignored_rules}
