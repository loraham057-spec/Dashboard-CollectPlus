from __future__ import annotations

import base64
import csv
import io
import json
import math
import hashlib
import ipaddress
import os
import re
import secrets
import sqlite3
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook, load_workbook
from PIL import Image, UnidentifiedImageError
import qrcode
from pydantic import BaseModel, Field, field_validator

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = ROOT_DIR / "data"
DB_PATH = Path(os.getenv("COLLECTPLUS_DB", str(DATA_DIR / "collectplus.db")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="CollectPlus",
    version="0.8.4",
    description="Plateforme de collecte mobile et de visualisation des enquêtes.",
)
# Origins are configurable for deployment. Same-origin is the default; add explicit
# origins (semicolon-separated) only when a separate frontend is intentionally used.
_allowed_origins = [x.strip().rstrip("/") for x in os.getenv("COLLECTPLUS_ALLOWED_ORIGINS", "").split(";") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_allowed_origins, allow_credentials=False, allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])

# Admin API and the SPA require HTTP Basic authentication. Public participant
# routes, health and static assets are intentionally exempt. Configure credentials
# using COLLECTPLUS_ADMIN_USERNAME and COLLECTPLUS_ADMIN_PASSWORD.
_ADMIN_USERNAME = os.getenv("COLLECTPLUS_ADMIN_USERNAME", "admin")
_ADMIN_PASSWORD = os.getenv("COLLECTPLUS_ADMIN_PASSWORD", "")
_RATE_WINDOW_SECONDS = 60
_RATE_LIMIT_PUBLIC_SUBMISSIONS = max(1, min(120, int(os.getenv("COLLECTPLUS_PUBLIC_RATE_LIMIT", "12"))))
_RATE_LIMIT_SALT = os.getenv("COLLECTPLUS_RATE_LIMIT_SALT", "collectplus-rate-limit-v1")

@app.middleware("http")
async def security_and_admin_auth(request: Request, call_next):
    path = request.url.path
    public_path = (path == "/api/health" or path.startswith("/api/public/") or path.startswith("/public/")
                   or path.startswith("/static/") or path == "/manifest.webmanifest" or path == "/service-worker.js")
    # Basic hard cap protects JSON endpoints from oversized request bodies. XLSX
    # uploads receive a stricter dedicated cap in the import endpoint.
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            size = int(content_length)
        except ValueError:
            return JSONResponse({"detail": "En-tête Content-Length invalide."}, status_code=400)
        if size > 10 * 1024 * 1024:
            return JSONResponse({"detail": "Requête trop volumineuse (maximum 10 Mo)."}, status_code=413)
    if not public_path and request.method != "OPTIONS":
        if not _ADMIN_PASSWORD:
            return JSONResponse({"detail": "Accès administrateur désactivé : configurez COLLECTPLUS_ADMIN_PASSWORD dans l’environnement."}, status_code=503)
        auth = request.headers.get("authorization", "")
        valid = False
        if auth.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth[6:], validate=True).decode("utf-8")
                username, password = decoded.split(":", 1)
                valid = secrets.compare_digest(username, _ADMIN_USERNAME) and secrets.compare_digest(password, _ADMIN_PASSWORD)
            except (ValueError, UnicodeDecodeError):
                valid = False
        if not valid:
            return JSONResponse({"detail": "Authentification administrateur requise."}, status_code=401, headers={"WWW-Authenticate": 'Basic realm="CollectPlus Admin", charset="UTF-8"'})
    # Process-local fixed-window throttling for anonymous submissions. For multi-worker
    # deployments, replace with shared Redis/proxy rate limiting.
    if path.startswith("/api/public/") and path.endswith("/submissions") and request.method == "POST":
        ip = request.client.host if request.client else "unknown"
        # Render terminates TLS in front of the app. Trust its forwarded client IP
        # only when the Render runtime marker is present; validate it as an IP.
        if os.getenv("RENDER") and request.headers.get("x-forwarded-for"):
            forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
            try: ip = str(ipaddress.ip_address(forwarded))
            except ValueError: pass
        token = path.split("/")[3] if len(path.split("/")) > 3 else "unknown-token"
        key_hash = hashlib.sha256(f"{_RATE_LIMIT_SALT}:{ip}:{token}".encode()).hexdigest()
        now_epoch = int(time.time())
        window_start = now_epoch - (now_epoch % _RATE_WINDOW_SECONDS)
        with db_conn() as conn:
            conn.execute("INSERT INTO public_rate_limits(ip_token_hash, window_start, request_count) VALUES (?, ?, 1) ON CONFLICT(ip_token_hash, window_start) DO UPDATE SET request_count=request_count+1", (key_hash, window_start))
            count = conn.execute("SELECT request_count FROM public_rate_limits WHERE ip_token_hash=? AND window_start=?", (key_hash, window_start)).fetchone()[0]
            # Periodic cleanup of expired rate-limit buckets; records contain only
            # a salted hash, not the original IP address.
            if now_epoch % 300 < 2:
                conn.execute("DELETE FROM public_rate_limits WHERE window_start < ?", (now_epoch - 3600,))
        if count > _RATE_LIMIT_PUBLIC_SUBMISSIONS:
            return JSONResponse({"detail": "Trop de soumissions. Réessayez dans une minute."}, status_code=429, headers={"Retry-After": str(_RATE_WINDOW_SECONDS - (now_epoch % _RATE_WINDOW_SECONDS) or _RATE_WINDOW_SECONDS)})
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(self), camera=(self), microphone=()")
    response.headers.setdefault("Content-Security-Policy", "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; connect-src 'self' https://*.tile.openstreetmap.org; font-src 'self' data: https://unpkg.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


LEGACY_SYSTEM_FORM_SHORT_TITLE = "Incidents MAPEPI"


def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db() -> None:
    with db_conn() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = FULL")
        conn.execute("""CREATE TABLE IF NOT EXISTS forms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            short_title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            schema_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            is_system INTEGER NOT NULL DEFAULT 0
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS submissions (
            id TEXT PRIMARY KEY,
            form_id INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            submitted_at TEXT NOT NULL,
            FOREIGN KEY(form_id) REFERENCES forms(id)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS public_form_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            form_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY(form_id) REFERENCES forms(id)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS public_rate_limits (
            ip_token_hash TEXT NOT NULL,
            window_start INTEGER NOT NULL,
            request_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(ip_token_hash, window_start)
        )""")
        # No questionnaire is seeded on a fresh installation. For existing installs,
        # retire the former bundled MAPEPI template without deleting any collected data.
        legacy = conn.execute("SELECT id FROM forms WHERE short_title = ? AND is_system = 1", (LEGACY_SYSTEM_FORM_SHORT_TITLE,)).fetchone()
        if legacy is not None:
            collected = conn.execute("SELECT COUNT(*) FROM submissions WHERE form_id = ?", (legacy["id"],)).fetchone()[0]
            if collected == 0:
                conn.execute("DELETE FROM forms WHERE id = ?", (legacy["id"],))
            else:
                conn.execute("UPDATE forms SET is_system = 0 WHERE id = ?", (legacy["id"],))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def configured_public_base(request: Request) -> str:
    configured = os.getenv("COLLECTPLUS_PUBLIC_BASE_URL", "").strip().rstrip("/")
    production = bool(os.getenv("RENDER")) or os.getenv("COLLECTPLUS_ENV", "").lower() == "production"
    if not configured:
        # In proxy deployments (e.g. Render), derive the public origin from the
        # request when no explicit canonical URL was supplied. Prefer the
        # forwarded scheme set by the trusted hosting proxy.
        configured = str(request.base_url).rstrip("/")
        forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip().lower()
        if forwarded_proto in ("http", "https"):
            parsed_origin = urlparse(configured)
            configured = f"{forwarded_proto}://{parsed_origin.netloc}"
    parsed = urlparse(configured)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(status_code=500, detail="COLLECTPLUS_PUBLIC_BASE_URL n’est pas une URL valide.")
    if production and parsed.scheme != "https":
        raise HTTPException(status_code=500, detail="COLLECTPLUS_PUBLIC_BASE_URL doit utiliser HTTPS en production.")
    return configured


def form_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    schema = json.loads(row["schema_json"])
    schema["id"] = row["id"]
    schema["created_at"] = row["created_at"]
    schema["is_system"] = bool(row["is_system"])
    return schema


def get_form_or_404(form_id: int) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT * FROM forms WHERE id = ?", (form_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Enquête introuvable")
    return form_to_dict(row)


class FormCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    short_title: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=1000)
    sections: list[dict[str, Any]]


class SubmissionCreate(BaseModel):
    id: str | None = None
    form_id: int | None = None
    form_key: str | None = None
    data: dict[str, Any]
    submitted_at: str | None = None


class PublicSubmissionRequest(BaseModel):
    data: dict[str, Any]

    @field_validator("data")
    @classmethod
    def limit_payload_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > 9 * 1024 * 1024:
            raise ValueError("La soumission dépasse 9 Mo.")
        return value


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/manifest.webmanifest")
def manifest() -> FileResponse:
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/service-worker.js")
def service_worker() -> FileResponse:
    return FileResponse(STATIC_DIR / "service-worker.js", media_type="application/javascript")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "app": "CollectPlus", "version": app.version, "time": utc_now()}


@app.get("/api/forms")
def list_forms() -> list[dict[str, Any]]:
    with db_conn() as conn:
        rows = conn.execute("SELECT * FROM forms ORDER BY id ASC").fetchall()
    return [form_to_dict(row) for row in rows]


@app.get("/api/forms/{form_id}")
def get_form(form_id: int) -> dict[str, Any]:
    return get_form_or_404(form_id)


ALLOWED_QUESTION_TYPES = {"text", "textarea", "number", "date", "time", "select", "multiselect", "email", "phone", "geopoint", "gps", "image", "photo", "note", "select_one", "select_multiple"}
QUESTION_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")

def validate_form_sections(sections: list[dict[str, Any]]) -> None:
    if not isinstance(sections, list) or not 1 <= len(sections) <= 50:
        raise HTTPException(status_code=400, detail="Le formulaire doit contenir entre 1 et 50 sections.")
    names: set[str] = set()
    question_total = 0
    for section in sections:
        if not isinstance(section, dict):
            raise HTTPException(status_code=400, detail="Structure de section invalide.")
        title = section.get("title", "Section")
        questions = section.get("questions")
        if not isinstance(title, str) or len(title) > 160 or not isinstance(questions, list) or not questions:
            raise HTTPException(status_code=400, detail="Chaque section doit avoir un titre valide et au moins une question.")
        question_total += len(questions)
        if question_total > 300:
            raise HTTPException(status_code=400, detail="Un formulaire ne peut pas dépasser 300 questions.")
        for q in questions:
            if not isinstance(q, dict):
                raise HTTPException(status_code=400, detail="Structure de question invalide.")
            name, label, qtype = q.get("name"), q.get("label"), q.get("type")
            if not isinstance(name, str) or not QUESTION_NAME_RE.fullmatch(name):
                raise HTTPException(status_code=400, detail="Le nom de chaque question doit commencer par une lettre et ne contenir que lettres, chiffres ou underscore (64 caractères maximum).")
            if name in names:
                raise HTTPException(status_code=400, detail=f"Nom de question dupliqué : {name}.")
            names.add(name)
            if not isinstance(label, str) or not label.strip() or len(label) > 500:
                raise HTTPException(status_code=400, detail=f"Libellé invalide pour la question {name}.")
            if qtype not in ALLOWED_QUESTION_TYPES:
                raise HTTPException(status_code=400, detail=f"Type de réponse non pris en charge pour {name}.")
            hint = q.get("hint", "")
            if hint is not None and (not isinstance(hint, str) or len(hint) > 1000):
                raise HTTPException(status_code=400, detail=f"Indication trop longue pour {name}.")
            if qtype in ("select", "multiselect", "select_one", "select_multiple"):
                options = q.get("options")
                if not isinstance(options, list) or not 1 <= len(options) <= 100 or any(not isinstance(x, str) or not x.strip() or len(x) > 200 for x in options):
                    raise HTTPException(status_code=400, detail=f"La question {name} doit avoir entre 1 et 100 choix valides.")

def validate_submission_data(form: dict[str, Any], data: dict[str, Any]) -> None:
    if not isinstance(data, dict) or len(data) > 300:
        raise HTTPException(status_code=422, detail="Structure de réponses invalide.")
    questions = [q for sec in form.get("sections", []) for q in sec.get("questions", []) if q.get("type") != "note"]
    by_name = {q.get("name"): q for q in questions}
    unknown = set(data) - set(by_name)
    if unknown:
        raise HTTPException(status_code=422, detail="La soumission contient des champs inconnus.")
    missing = []
    for name, q in by_name.items():
        value = data.get(name)
        qtype = q.get("type")
        required = bool(q.get("required"))
        if value is None or value == "" or value == []:
            if required: missing.append(q.get("label") or name)
            continue
        if qtype in ("select", "select_one"):
            if not isinstance(value, str) or value not in q.get("options", []):
                raise HTTPException(status_code=422, detail=f"Choix invalide pour {name}.")
        elif qtype in ("multiselect", "select_multiple"):
            if not isinstance(value, list) or len(value) > len(q.get("options", [])) or any(x not in q.get("options", []) for x in value) or len(set(value)) != len(value):
                raise HTTPException(status_code=422, detail=f"Sélection multiple invalide pour {name}.")
        elif qtype in ("geopoint", "gps"):
            if not isinstance(value, dict): raise HTTPException(status_code=422, detail=f"Coordonnées GPS invalides pour {name}.")
            try: lat, lon, accuracy = float(value["latitude"]), float(value["longitude"]), float(value["accuracy"])
            except (KeyError, TypeError, ValueError): raise HTTPException(status_code=422, detail=f"Coordonnées GPS invalides pour {name}.")
            if not all(math.isfinite(v) for v in (lat, lon, accuracy)) or not -90 <= lat <= 90 or not -180 <= lon <= 180 or not 0 <= accuracy <= 100000:
                raise HTTPException(status_code=422, detail=f"Coordonnées GPS hors limites pour {name}.")
        elif qtype in ("image", "photo"):
            if not isinstance(value, str) or not value.startswith("data:image/"):
                raise HTTPException(status_code=422, detail=f"Image invalide pour {name}.")
            match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", value)
            if not match: raise HTTPException(status_code=422, detail=f"Format d’image non autorisé pour {name}.")
            try: decoded = base64.b64decode(match.group(2), validate=True)
            except ValueError: raise HTTPException(status_code=422, detail=f"Image encodée invalide pour {name}.")
            mime = match.group(1)
            signature_ok = ((mime == "jpeg" and decoded.startswith(b"\xff\xd8\xff"))
                            or (mime == "png" and decoded.startswith(b"\x89PNG\r\n\x1a\n"))
                            or (mime == "webp" and len(decoded) >= 12 and decoded[:4] == b"RIFF" and decoded[8:12] == b"WEBP"))
            if not signature_ok: raise HTTPException(status_code=422, detail=f"Le contenu du fichier ne correspond pas à son type image pour {name}.")
            if len(decoded) > 6 * 1024 * 1024: raise HTTPException(status_code=413, detail="Chaque image doit faire 6 Mo maximum après optimisation.")
            try:
                with Image.open(io.BytesIO(decoded)) as image:
                    expected_format = {"jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}[mime]
                    if image.format != expected_format or image.width > 8000 or image.height > 8000 or image.width * image.height > 40_000_000:
                        raise HTTPException(status_code=422, detail=f"Dimensions ou format d’image non autorisés pour {name}.")
                    image.verify()
            except HTTPException:
                raise
            except (UnidentifiedImageError, OSError, ValueError):
                raise HTTPException(status_code=422, detail=f"Le fichier image est corrompu ou non décodable pour {name}.")
        elif qtype == "number":
            if isinstance(value, bool): raise HTTPException(status_code=422, detail=f"Nombre invalide pour {name}.")
            try: num = float(value)
            except (TypeError, ValueError): raise HTTPException(status_code=422, detail=f"Nombre invalide pour {name}.")
            if not math.isfinite(num): raise HTTPException(status_code=422, detail=f"Nombre non fini pour {name}.")
        else:
            if not isinstance(value, (str, int, float)) or isinstance(value, bool) or len(str(value)) > 10000:
                raise HTTPException(status_code=422, detail=f"Valeur invalide ou trop longue pour {name}.")
    if missing:
        raise HTTPException(status_code=422, detail="Champs obligatoires manquants : " + ", ".join(missing))

@app.post("/api/forms")
def create_form(form: FormCreate) -> dict[str, Any]:
    validate_form_sections(form.sections)
    title = form.title.strip()
    short_title = form.short_title.strip()
    description = form.description.strip()
    if len(title) < 2 or len(short_title) < 2:
        raise HTTPException(status_code=400, detail="Le titre et le titre court doivent contenir au moins 2 caractères utiles.")
    schema = {
        "key": f"custom-{uuid.uuid4().hex[:8]}",
        "title": title,
        "short_title": short_title,
        "description": description,
        "version": 1,
        "sections": form.sections,
    }
    with db_conn() as conn:
        cur = conn.execute(
            "INSERT INTO forms(title, short_title, description, schema_json, created_at, is_system) VALUES (?, ?, ?, ?, ?, 0)",
            (schema["title"], schema["short_title"], schema["description"], json.dumps(schema, ensure_ascii=False), utc_now()),
        )
        form_id = cur.lastrowid
    return get_form_or_404(int(form_id))


@app.post("/api/forms/{form_id}/share")
def create_public_link(form_id: int, request: Request) -> dict[str, Any]:
    form = get_form_or_404(form_id)
    base = configured_public_base(request)
    token = secrets.token_urlsafe(24)
    created = utc_now()
    with db_conn() as conn:
        conn.execute("INSERT INTO public_form_links(form_id, token, is_active, created_at) VALUES (?, ?, 1, ?)", (form_id, token, created))
    return {"ok": True, "form_id": form_id, "form_title": form.get("title"), "token": token, "url": f"{base}/public/{token}", "created_at": created}


@app.get("/api/forms/{form_id}/share")
def get_public_links(form_id: int) -> list[dict[str, Any]]:
    get_form_or_404(form_id)
    with db_conn() as conn:
        rows = conn.execute("SELECT token, is_active, created_at FROM public_form_links WHERE form_id=? ORDER BY id DESC", (form_id,)).fetchall()
    return [{"token": r["token"], "is_active": bool(r["is_active"]), "created_at": r["created_at"]} for r in rows]


@app.get("/api/forms/{form_id}/share/{token}/qr.png")
def public_link_qr(form_id: int, token: str, request: Request) -> Response:
    with db_conn() as conn:
        row = conn.execute("SELECT is_active FROM public_form_links WHERE form_id=? AND token=?", (form_id, token)).fetchone()
    if row is None or not row["is_active"]:
        raise HTTPException(status_code=404, detail="Lien public invalide ou désactivé.")
    form = get_form_or_404(form_id)
    base = configured_public_base(request)
    public_url = f"{base}/public/{token}"
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=7, border=3)
    qr.add_data(public_url)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#082b49", back_color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return Response(content=buffer.getvalue(), media_type="image/png", headers={"Cache-Control": "private, no-store", "Content-Disposition": f'inline; filename="collectplus_qr_{form_id}.png"'})

@app.post("/api/forms/{form_id}/share/revoke")
def revoke_public_links(form_id: int) -> dict[str, Any]:
    get_form_or_404(form_id)
    with db_conn() as conn:
        conn.execute("UPDATE public_form_links SET is_active=0 WHERE form_id=?", (form_id,))
    return {"ok": True, "revoked": True}


@app.get("/api/public/{token}/form")
def get_public_form(token: str) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT form_id FROM public_form_links WHERE token=? AND is_active=1", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Lien public invalide ou désactivé.")
    form = get_form_or_404(int(row["form_id"]))
    return {"key": form.get("key"), "title": form.get("title"), "short_title": form.get("short_title"), "description": form.get("description"), "sections": form.get("sections", [])}


@app.get("/public/{token}")
def public_form_page(token: str) -> FileResponse:
    with db_conn() as conn:
        row = conn.execute("SELECT id FROM public_form_links WHERE token=? AND is_active=1", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Lien public invalide ou désactivé.")
    return FileResponse(STATIC_DIR / "public.html", media_type="text/html")


@app.post("/api/public/{token}/submissions")
def submit_public_form(token: str, submission: PublicSubmissionRequest) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT form_id FROM public_form_links WHERE token=? AND is_active=1", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Lien public invalide ou désactivé.")
    form_id = int(row["form_id"])
    form = get_form_or_404(form_id)
    validate_submission_data(form, submission.data)
    return create_submission(SubmissionCreate(form_id=form_id, data=submission.data))


@app.delete("/api/forms/{form_id}")
def delete_form(form_id: int) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT is_system FROM forms WHERE id = ?", (form_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Enquête introuvable")
        if row["is_system"]:
            raise HTTPException(status_code=400, detail="Ce formulaire système ne peut pas être supprimé.")
        submission_count = conn.execute("SELECT COUNT(*) FROM submissions WHERE form_id = ?", (form_id,)).fetchone()[0]
        if submission_count:
            raise HTTPException(status_code=409, detail="Ce formulaire possède des soumissions. Archivez-le plutôt que de supprimer les données collectées.")
        # Remove share tokens tied to this form so the FK does not block deletion
        # and previously issued anonymous links cannot remain dangling.
        conn.execute("DELETE FROM public_form_links WHERE form_id = ?", (form_id,))
        conn.execute("DELETE FROM forms WHERE id = ?", (form_id,))
    return {"ok": True}


def parse_xlsform(content: bytes, filename: str) -> dict[str, Any]:
    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Impossible de lire le fichier XLSForm : {exc}")
    if "survey" not in workbook.sheetnames:
        raise HTTPException(status_code=400, detail="Le fichier Excel doit contenir une feuille 'survey'.")
    survey_sheet = workbook["survey"]
    rows = list(survey_sheet.iter_rows(values_only=True))
    if len(rows) > 1001:
        workbook.close()
        raise HTTPException(status_code=400, detail="La feuille survey dépasse la limite de 1 000 lignes de questions.")
    if not rows:
        raise HTTPException(status_code=400, detail="La feuille survey est vide.")
    headers = [str(v).strip().lower() if v is not None else "" for v in rows[0]]
    table = [dict(zip(headers, row)) for row in rows[1:]]
    settings: dict[str, Any] = {}
    if "settings" in workbook.sheetnames:
        srows = list(workbook["settings"].iter_rows(values_only=True))
        if len(srows) > 10:
            workbook.close()
            raise HTTPException(status_code=400, detail="La feuille settings dépasse 10 lignes.")
        if srows:
            sh = [str(v).strip().lower() if v is not None else "" for v in srows[0]]
            if len(srows) > 1:
                settings = dict(zip(sh, srows[1]))
    choices: dict[str, list[dict[str, str]]] = {}
    if "choices" in workbook.sheetnames:
        crows = list(workbook["choices"].iter_rows(values_only=True))
        if len(crows) > 5001:
            workbook.close()
            raise HTTPException(status_code=400, detail="La feuille choices dépasse la limite de 5 000 choix.")
        if crows:
            ch = [str(v).strip().lower() if v is not None else "" for v in crows[0]]
            for crow in crows[1:]:
                rec = dict(zip(ch, crow))
                lname = str(rec.get("list_name") or "")
                if lname:
                    choices.setdefault(lname, []).append({"value": str(rec.get("name") or ""), "label": str(rec.get("label") or rec.get("name") or "")})

    sections: list[dict[str, Any]] = [{"title": "Questionnaire", "questions": []}]
    section_stack: list[dict[str, Any]] = [sections[0]]
    unsupported = []
    for record in table:
        raw_type = str(record.get("type") or "").strip()
        if not raw_type or raw_type.startswith("#"):
            continue
        name = str(record.get("name") or "").strip()
        label = str(record.get("label::French (fr)") or record.get("label::fr") or record.get("label") or name).strip()
        if raw_type == "begin_group":
            new_section = {"title": label or name or "Section", "description": "", "questions": []}
            sections.append(new_section)
            section_stack = [new_section]
            continue
        if raw_type == "end_group":
            section_stack = [sections[0]]
            continue
        if not name or not label:
            continue
        required_value = str(record.get("required") or "").strip().lower()
        required = required_value in ("yes", "true", "1")
        hint = str(record.get("hint::French (fr)") or record.get("hint") or "").strip()
        q: dict[str, Any] = {"name": name, "label": label, "required": required}
        if hint:
            q["hint"] = hint
        if raw_type.startswith("select_one "):
            q["type"] = "select"
            list_name = raw_type.split(" ", 1)[1].strip()
            q["options"] = [item["label"] for item in choices.get(list_name, [])]
        elif raw_type.startswith("select_multiple "):
            q["type"] = "multiselect"
            list_name = raw_type.split(" ", 1)[1].strip()
            q["options"] = [item["label"] for item in choices.get(list_name, [])]
        elif raw_type in ("integer", "decimal"):
            q["type"] = "number"
        elif raw_type in ("date", "time", "datetime", "text", "email", "note", "geopoint", "image", "audio", "barcode"):
            q["type"] = {"integer": "number", "decimal": "number", "note": "note", "geopoint": "geopoint", "image": "image", "audio": "text", "barcode": "text"}.get(raw_type, raw_type)
        else:
            q["type"] = "text"
            unsupported.append(raw_type)
        if q["type"] in ("select", "multiselect") and not q.get("options"):
            q["options"] = ["Valeur 1", "Valeur 2"]
            q["hint"] = (q.get("hint", "") + " Liste de choix à vérifier après importation.").strip()
        section_stack[-1]["questions"].append(q)
    sections = [sec for sec in sections if sec.get("questions")]
    if not sections:
        raise HTTPException(status_code=400, detail="Aucune question exploitable n’a été trouvée dans la feuille survey.")
    title = str(settings.get("form_title") or settings.get("form_id") or Path(filename).stem).strip()
    workbook.close()
    return {
        "key": f"import-{uuid.uuid4().hex[:8]}",
        "title": title,
        "short_title": title[:80],
        "description": f"Formulaire importé depuis {filename}. Vérifiez les règles conditionnelles et les types de questions après importation.",
        "version": 1,
        "sections": sections,
        "import_warnings": sorted(set(unsupported)),
    }


@app.post("/api/forms/import")
async def import_form(file: UploadFile = File(...)) -> dict[str, Any]:
    filename = Path(file.filename or "formulaire.xlsx").name
    # Reject oversized uploads before parsing; cap XLSX decompressed contents to
    # reduce zip-bomb risk. The workbook parser remains read-only.
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Fichier d’importation trop volumineux (maximum 5 Mo).")
    suffix = Path(filename).suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                total_uncompressed = 0
                for entry in archive.infolist():
                    total_uncompressed += entry.file_size
                    if entry.file_size > 15 * 1024 * 1024 or (entry.compress_size and entry.file_size / entry.compress_size > 100):
                        raise HTTPException(status_code=400, detail="Fichier Excel suspect : ratio de compression anormal.")
                if total_uncompressed > 25 * 1024 * 1024:
                    raise HTTPException(status_code=400, detail="Le contenu décompressé du fichier Excel dépasse 25 Mo.")
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Le fichier Excel n’est pas une archive XLSX valide.")
    if suffix == ".json":
        try:
            schema = json.loads(content.decode("utf-8-sig"))
        except Exception:
            raise HTTPException(status_code=400, detail="Le JSON n’est pas valide.")
        if not isinstance(schema, dict) or not isinstance(schema.get("sections"), list):
            raise HTTPException(status_code=400, detail="Le JSON doit contenir un objet avec un tableau 'sections'.")
        schema.setdefault("title", Path(filename).stem)
        schema.setdefault("short_title", str(schema["title"])[:80])
        schema.setdefault("description", "Formulaire importé depuis JSON.")
    elif suffix in (".xlsx", ".xlsm"):
        schema = parse_xlsform(content, filename)
    else:
        raise HTTPException(status_code=400, detail="Format non pris en charge. Utilisez un XLSForm .xlsx ou un schéma .json CollectPlus.")
    form = FormCreate(title=str(schema.get("title", "Enquête importée")), short_title=str(schema.get("short_title", schema.get("title", "Enquête importée")))[:80], description=str(schema.get("description", "")), sections=schema["sections"])
    created = create_form(form)
    if schema.get("import_warnings"):
        created["import_warnings"] = schema["import_warnings"]
    return created


@app.post("/api/submissions")
def create_submission(submission: SubmissionCreate) -> dict[str, Any]:
    # Prefer the stable form key when provided. This lets a submission captured
    # on a freshly installed offline APK match the server form even if its DB id differs.
    resolved_form_id = submission.form_id
    if submission.form_key:
        with db_conn() as conn:
            rows = conn.execute("SELECT id, schema_json FROM forms").fetchall()
        resolved_form_id = None
        for row in rows:
            try:
                schema = json.loads(row["schema_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            if schema.get("key") == submission.form_key:
                resolved_form_id = int(row["id"])
                break
        if resolved_form_id is None:
            raise HTTPException(status_code=404, detail="Le formulaire associé à cette soumission n’existe pas sur le serveur.")
    if resolved_form_id is None:
        raise HTTPException(status_code=422, detail="form_id ou form_key est requis.")
    form = get_form_or_404(resolved_form_id)
    validate_submission_data(form, submission.data)
    sub_id = submission.id or str(uuid.uuid4())
    if not isinstance(sub_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", sub_id):
        raise HTTPException(status_code=422, detail="Identifiant de soumission invalide.")
    submitted_at = submission.submitted_at or utc_now()
    if not isinstance(submitted_at, str) or len(submitted_at) > 64:
        raise HTTPException(status_code=422, detail="Date de soumission invalide.")
    try:
        datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="La date de soumission doit être au format ISO 8601.")
    payload = submission.data
    with db_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO submissions(id, form_id, payload_json, submitted_at) VALUES (?, ?, ?, ?)",
                (sub_id, resolved_form_id, json.dumps(payload, ensure_ascii=False), submitted_at),
            )
        except sqlite3.IntegrityError:
            # Retry-safe offline synchronization: an already uploaded UUID is an acknowledgement.
            row = conn.execute("SELECT id FROM submissions WHERE id = ?", (sub_id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=409, detail="Impossible d’enregistrer cette soumission.")
    return {"ok": True, "id": sub_id, "submitted_at": submitted_at}


def read_submissions(form_id: int | None = None) -> list[dict[str, Any]]:
    with db_conn() as conn:
        if form_id:
            rows = conn.execute("""SELECT s.*, f.short_title, f.title AS form_title FROM submissions s
                                    JOIN forms f ON f.id=s.form_id WHERE s.form_id=? ORDER BY s.submitted_at DESC""", (form_id,)).fetchall()
        else:
            rows = conn.execute("""SELECT s.*, f.short_title, f.title AS form_title FROM submissions s
                                    JOIN forms f ON f.id=s.form_id ORDER BY s.submitted_at DESC""").fetchall()
    return [{"id": r["id"], "form_id": r["form_id"], "form_title": r["form_title"], "short_title": r["short_title"], "data": json.loads(r["payload_json"]), "submitted_at": r["submitted_at"]} for r in rows]


@app.get("/api/submissions")
def list_submissions(form_id: int | None = None) -> list[dict[str, Any]]:
    return read_submissions(form_id)


@app.get("/api/dashboard")
def dashboard() -> dict[str, Any]:
    with db_conn() as conn:
        form_count = conn.execute("SELECT COUNT(*) FROM forms").fetchone()[0]
        submission_count = conn.execute("SELECT COUNT(*) FROM submissions").fetchone()[0]
        recent = conn.execute("""SELECT s.id, s.form_id, s.payload_json, s.submitted_at, f.short_title
                                FROM submissions s JOIN forms f ON f.id=s.form_id ORDER BY s.submitted_at DESC LIMIT 7""").fetchall()
        by_form = conn.execute("""SELECT f.short_title, COUNT(s.id) AS n FROM forms f LEFT JOIN submissions s ON s.form_id=f.id
                               GROUP BY f.id ORDER BY n DESC, f.id ASC""").fetchall()
        all_payloads = conn.execute("SELECT payload_json FROM submissions").fetchall()
    statuses: dict[str, int] = {"Ouvert": 0, "En cours": 0, "Résolu": 0}
    disease_counts: dict[str, int] = {}
    for row in all_payloads:
        payload = json.loads(row["payload_json"])
        status = payload.get("statut_incident")
        if status in statuses:
            statuses[status] += 1
        diseases = payload.get("maladie_echantillon", [])
        if isinstance(diseases, str):
            diseases = [diseases]
        if isinstance(diseases, list):
            for disease in diseases:
                disease_counts[str(disease)] = disease_counts.get(str(disease), 0) + 1
    return {
        "form_count": form_count,
        "submission_count": submission_count,
        "status_counts": statuses,
        "disease_counts": disease_counts,
        "by_form": [{"label": r["short_title"], "value": r["n"]} for r in by_form],
        "recent": [{"id": r["id"], "form_id": r["form_id"], "form_title": r["short_title"], "data": json.loads(r["payload_json"]), "submitted_at": r["submitted_at"]} for r in recent],
    }


def flatten_records(rows: list[dict[str, Any]]) -> tuple[list[str], list[list[str]]]:
    all_keys: list[str] = []
    for row in rows:
        for key in row["data"].keys():
            if key not in all_keys:
                all_keys.append(key)
    headers = ["id", "form_id", "form_title", "submitted_at"] + all_keys
    output = []
    for row in rows:
        values = [row["id"], row["form_id"], row["form_title"], row["submitted_at"]]
        for key in all_keys:
            value = row["data"].get(key, "")
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=False)
            text_value = "" if value is None else str(value)
            # Neutralize spreadsheet formula injection in CSV and XLSX exports.
            if text_value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                text_value = "'" + text_value
            values.append(text_value)
        output.append(values)
    return headers, output



@app.get("/api/analytics/quality")
def analytics_quality(form_id: int | None = None) -> dict[str, Any]:
    """Summarize submission completeness, exact duplicate payloads, and daily trend."""
    with db_conn() as conn:
        query = """SELECT s.id, s.form_id, s.payload_json, s.submitted_at, f.short_title
                   FROM submissions s JOIN forms f ON f.id=s.form_id"""
        params: tuple[Any, ...] = ()
        if form_id is not None:
            query += " WHERE s.form_id = ?"
            params = (form_id,)
        query += " ORDER BY s.submitted_at ASC"
        rows = conn.execute(query, params).fetchall()

    total = len(rows)
    daily: dict[str, int] = {}
    payload_hashes: dict[str, int] = {}
    field_presence: dict[str, int] = {}
    malformed = 0
    form_counts: dict[str, int] = {}
    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
            if not isinstance(payload, dict):
                malformed += 1
                continue
        except (TypeError, json.JSONDecodeError):
            malformed += 1
            continue
        digest = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        payload_hashes[digest] = payload_hashes.get(digest, 0) + 1
        stamp = str(row["submitted_at"] or "")
        day = stamp[:10] if len(stamp) >= 10 else "Date inconnue"
        daily[day] = daily.get(day, 0) + 1
        form_label = str(row["short_title"] or f"Formulaire {row['form_id']}")
        form_counts[form_label] = form_counts.get(form_label, 0) + 1
        for key, value in payload.items():
            if value is not None and value != "" and value != [] and value != {}:
                field_presence[str(key)] = field_presence.get(str(key), 0) + 1

    duplicate_groups = sum(1 for count in payload_hashes.values() if count > 1)
    duplicate_extra_records = sum(count - 1 for count in payload_hashes.values() if count > 1)
    field_stats = [
        {"field": field, "filled": filled, "missing": max(0, total - filled),
         "completeness_percent": round((filled / total) * 100, 1) if total else 0.0}
        for field, filled in sorted(field_presence.items(), key=lambda item: item[0].casefold())
    ]
    return {
        "total_submissions": total,
        "malformed_payloads": malformed,
        "duplicate_groups": duplicate_groups,
        "duplicate_extra_records": duplicate_extra_records,
        "daily_trend": [{"date": day, "count": count} for day, count in sorted(daily.items())],
        "form_counts": [{"form": label, "count": count} for label, count in sorted(form_counts.items(), key=lambda item: (-item[1], item[0]))],
        "field_completeness": field_stats,
        "note": "Les doublons sont des payloads strictement identiques; ce sont des candidats à la vérification, pas des suppressions automatiques."
    }


@app.get("/api/export/csv")
def export_csv(form_id: int | None = None) -> StreamingResponse:
    rows = read_submissions(form_id)
    headers, values = flatten_records(rows)
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(headers)
    writer.writerows(values)
    # UTF-8 BOM helps Excel open French accents correctly.
    content = "\ufeff" + buffer.getvalue()
    name = f"collectplus_export_{form_id or 'toutes_enquetes'}.csv"
    return StreamingResponse(iter([content]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/export/json")
def export_json(form_id: int | None = None) -> StreamingResponse:
    rows = read_submissions(form_id)
    content = json.dumps(rows, ensure_ascii=False, indent=2)
    name = f"collectplus_export_{form_id or 'toutes_enquetes'}.json"
    return StreamingResponse(iter([content]), media_type="application/json; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/export/xlsx")
def export_xlsx(form_id: int | None = None) -> StreamingResponse:
    rows = read_submissions(form_id)
    headers, values = flatten_records(rows)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Soumissions"
    sheet.append(headers)
    for row in values:
        sheet.append(row)
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for column in sheet.columns:
        letter = column[0].column_letter
        max_len = max((len(str(cell.value or "")) for cell in column), default=10)
        sheet.column_dimensions[letter].width = min(max(max_len + 2, 12), 42)
    out = io.BytesIO()
    workbook.save(out)
    out.seek(0)
    name = f"collectplus_export_{form_id or 'toutes_enquetes'}.xlsx"
    return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="{name}"'})
