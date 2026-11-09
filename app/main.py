from __future__ import annotations

import base64
import hashlib
import io
import ipaddress
import json
import os
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import qrcode
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import core
from .core import AppError

APP_VERSION = "0.8.0"
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = ROOT_DIR / "data"
DB_PATH = Path(os.getenv("COLLECTPLUS_DB", str(DATA_DIR / "collectplus.db")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

PRODUCTION = bool(os.getenv("RENDER")) or os.getenv("COLLECTPLUS_ENV", "").lower() == "production"

# --- Comptes : un administrateur (obligatoire) et un compte « collecteur » optionnel à droits réduits ---
_ADMIN_USERNAME = os.getenv("COLLECTPLUS_ADMIN_USERNAME", "admin")
_ADMIN_PASSWORD = os.getenv("COLLECTPLUS_ADMIN_PASSWORD", "")
_COLLECTOR_USERNAME = os.getenv("COLLECTPLUS_COLLECTOR_USERNAME", "")
_COLLECTOR_PASSWORD = os.getenv("COLLECTPLUS_COLLECTOR_PASSWORD", "")
_RATE_WINDOW_SECONDS = 60
_RATE_LIMIT_PUBLIC = max(1, min(120, int(os.getenv("COLLECTPLUS_PUBLIC_RATE_LIMIT", "12"))))
_RATE_SALT = os.getenv("COLLECTPLUS_RATE_LIMIT_SALT", "collectplus-rate-limit-v1")
_TRUSTED_HOPS = int(os.getenv("COLLECTPLUS_TRUSTED_PROXY_HOPS", "1" if os.getenv("RENDER") else "0"))
_MAX_BODY = 10 * 1024 * 1024

_PUBLIC_PREFIXES = ("/api/public/", "/public/", "/static/")
_PUBLIC_EXACT = {"/api/health", "/manifest.webmanifest", "/service-worker.js"}
_FAILS: dict[str, list[float]] = {}  # tentatives de connexion échouées par IP (en mémoire, par processus)


@asynccontextmanager
async def lifespan(_: FastAPI):
    with core.connect(DB_PATH) as conn:
        core.init_schema(conn)
    yield


app = FastAPI(title="CollectPlus", version=APP_VERSION, lifespan=lifespan,
              description="Plateforme de collecte mobile et de visualisation des enquêtes.",
              docs_url=None if PRODUCTION else "/docs", redoc_url=None, openapi_url=None if PRODUCTION else "/openapi.json")
_allowed_origins = [x.strip().rstrip("/") for x in os.getenv("COLLECTPLUS_ALLOWED_ORIGINS", "").split(";") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_allowed_origins, allow_credentials=False,
                   allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type", "X-Collector", "X-Requested-With"])


# --------------------------------------------------------------------------- #
# Sécurité : authentification, limitation de débit, en-têtes
# --------------------------------------------------------------------------- #
def client_ip(request: Request) -> str:
    ip = request.client.host if request.client else "unknown"
    if _TRUSTED_HOPS > 0:
        # On lit l'adresse ajoutée par NOTRE proxy (à droite). Le premier élément est fourni par le client : falsifiable.
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(parts) >= _TRUSTED_HOPS:
            try:
                ip = str(ipaddress.ip_address(parts[-_TRUSTED_HOPS]))
            except ValueError:
                pass
    return ip


def _hash(value: str) -> str:
    return hashlib.sha256(f"{_RATE_SALT}:{value}".encode()).hexdigest()


def _eq(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode("utf-8"), b.encode("utf-8"))  # bytes : pas d'erreur sur les accents


def resolve_role(request: Request) -> tuple[str | None, str]:
    header = request.headers.get("authorization", "")
    if not header.startswith("Basic "):
        return None, ""
    try:
        user, password = base64.b64decode(header[6:], validate=True).decode("utf-8").split(":", 1)
    except (ValueError, UnicodeDecodeError):
        return None, ""
    if _ADMIN_PASSWORD and _eq(user, _ADMIN_USERNAME) & _eq(password, _ADMIN_PASSWORD):
        return "admin", user
    if _COLLECTOR_USERNAME and _COLLECTOR_PASSWORD and _eq(user, _COLLECTOR_USERNAME) & _eq(password, _COLLECTOR_PASSWORD):
        return "collector", user
    return None, ""


def collector_allowed(method: str, path: str) -> bool:
    if method == "GET":
        return path in ("/", "/api/whoami", "/api/forms") or re.fullmatch(r"/api/forms/\d+", path) is not None
    return method == "POST" and path == "/api/submissions"


def _login_blocked(ip: str) -> int:
    now = time.time()
    recent = [t for t in _FAILS.get(ip, []) if now - t < 300]
    _FAILS[ip] = recent
    if len(_FAILS) > 5000:
        for k in [k for k, v in _FAILS.items() if not v or now - v[-1] > 300]:
            _FAILS.pop(k, None)
    return int(300 - (now - recent[0])) if len(recent) >= 10 else 0


async def _gate(request: Request, call_next):
    path, method = request.url.path, request.method
    cl = request.headers.get("content-length")
    if cl:
        try:
            if int(cl) > _MAX_BODY:
                return JSONResponse({"detail": "Requête trop volumineuse (maximum 10 Mo)."}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "En-tête Content-Length invalide."}, status_code=400)
    elif method in ("POST", "PUT", "PATCH") and "chunked" in request.headers.get("transfer-encoding", "").lower():
        return JSONResponse({"detail": "Content-Length obligatoire."}, status_code=411)  # empêche de contourner la limite de taille

    public = path in _PUBLIC_EXACT or path.startswith(_PUBLIC_PREFIXES)
    request.state.role, request.state.actor = None, "anonyme"
    if not public and method != "OPTIONS":
        if not _ADMIN_PASSWORD:
            return JSONResponse({"detail": "Accès administrateur désactivé : configurez COLLECTPLUS_ADMIN_PASSWORD."}, status_code=503)
        ip = client_ip(request)
        wait = _login_blocked(ip)
        if wait:
            return JSONResponse({"detail": "Trop de tentatives échouées. Réessayez plus tard."}, status_code=429,
                                headers={"Retry-After": str(wait)})
        role, actor = resolve_role(request)
        if role is None:
            if request.headers.get("authorization"):
                _FAILS.setdefault(ip, []).append(time.time())
            return JSONResponse({"detail": "Authentification requise."}, status_code=401,
                                headers={"WWW-Authenticate": 'Basic realm="CollectPlus", charset="UTF-8"'})
        if method in ("POST", "PUT", "PATCH", "DELETE") and request.headers.get("x-requested-with") != "CollectPlus":
            # Protection CSRF : un site tiers ne peut pas ajouter cet en-tête sans autorisation CORS (donc sans préflight accepté).
            return JSONResponse({"detail": "En-tête X-Requested-With: CollectPlus requis."}, status_code=403)
        if role == "collector" and not collector_allowed(method, path):
            return JSONResponse({"detail": "Ce compte collecteur n’a pas accès à cette ressource."}, status_code=403)
        _FAILS.pop(ip, None)
        request.state.role, request.state.actor = role, actor

    if method == "POST" and path.startswith("/api/public/") and path.endswith("/submissions"):
        key = _hash(client_ip(request))  # par IP (et non par jeton) : une IP ne peut pas gonfler la table avec de faux jetons
        count, retry = await run_in_threadpool(_rate_hit, key)
        if count > _RATE_LIMIT_PUBLIC:
            return JSONResponse({"detail": "Trop de soumissions. Réessayez dans une minute."}, status_code=429,
                                headers={"Retry-After": str(retry)})
    return await call_next(request)


def _rate_hit(key: str) -> tuple[int, int]:
    with core.connect(DB_PATH) as conn:
        return core.rate_hit(conn, key, _RATE_WINDOW_SECONDS)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    response = await _gate(request, call_next)  # les réponses d'erreur du portail reçoivent AUSSI les en-têtes
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "no-referrer")
    h.setdefault("Permissions-Policy", "geolocation=(self), camera=(self), microphone=()")
    h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    h.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    h.setdefault("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
                 "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
    if request.url.path.startswith("/api/") or request.url.path == "/":
        h.setdefault("Cache-Control", "no-store")  # données personnelles : jamais en cache partagé/navigateur
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def db() -> core.Conn:
    return core.connect(DB_PATH)


def _audit(conn, request: Request, action: str, target: str = "", detail: str = "") -> None:
    core.audit(conn, request.state.actor, action, target, detail, _hash(client_ip(request))[:16])


def is_admin(request: Request) -> bool:
    return request.state.role == "admin"


def configured_public_base(request: Request) -> str:
    configured = os.getenv("COLLECTPLUS_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not configured:
        if PRODUCTION:
            raise HTTPException(503, "COLLECTPLUS_PUBLIC_BASE_URL doit être configuré pour le partage public en production.")
        configured = str(request.base_url).rstrip("/")
    p = urlparse(configured)
    if p.scheme not in ("http", "https") or not p.netloc or p.username or p.password or p.query or p.fragment:
        raise HTTPException(500, "COLLECTPLUS_PUBLIC_BASE_URL n’est pas une URL valide.")
    if PRODUCTION and p.scheme != "https":
        raise HTTPException(500, "COLLECTPLUS_PUBLIC_BASE_URL doit utiliser HTTPS en production.")
    return configured


# --------------------------------------------------------------------------- #
# Modèles
# --------------------------------------------------------------------------- #
class FormIn(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    short_title: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=1000)
    sections: list[dict[str, Any]]


class SubmissionIn(BaseModel):
    id: str | None = Field(default=None, max_length=128)
    form_id: int | None = None
    form_key: str | None = Field(default=None, max_length=64)
    data: dict[str, Any]
    submitted_at: str | None = Field(default=None, max_length=64)


class PublicSubmissionIn(BaseModel):
    data: dict[str, Any]


# --------------------------------------------------------------------------- #
# Pages et état
# --------------------------------------------------------------------------- #
@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/manifest.webmanifest")
def manifest() -> FileResponse:
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/service-worker.js")
def service_worker() -> FileResponse:
    return FileResponse(STATIC_DIR / "service-worker.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "app": "CollectPlus", "version": APP_VERSION, "time": core.utc_now()}


@app.get("/api/whoami")
def whoami(request: Request) -> dict[str, Any]:
    return {"role": request.state.role, "actor": request.state.actor, "version": APP_VERSION}


# --------------------------------------------------------------------------- #
# Formulaires
# --------------------------------------------------------------------------- #
@app.get("/api/forms")
def list_forms(request: Request) -> list[dict[str, Any]]:
    with db() as conn:
        return core.list_forms(conn, published_only=not is_admin(request))


@app.get("/api/forms/{form_id}")
def get_form(form_id: int, request: Request) -> dict[str, Any]:
    with db() as conn:
        form = core.get_form(conn, form_id)
    if not is_admin(request) and form["status"] != "published":
        raise AppError(404, "Enquête introuvable")
    return form


@app.post("/api/forms")
def create_form(body: FormIn, request: Request) -> dict[str, Any]:
    with db() as conn:
        form = core.create_form(conn, body.title, body.short_title, body.description, body.sections)
        _audit(conn, request, "form.create", str(form["id"]), form["title"])
    return form


@app.post("/api/forms/import")
async def import_form(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    filename = Path(file.filename or "formulaire.xlsx").name
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise AppError(413, "Fichier d’importation trop volumineux (maximum 5 Mo).")
    suffix = Path(filename).suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        core.check_xlsx_archive(content)
        schema = await run_in_threadpool(core.parse_xlsform, content, filename)
    elif suffix == ".json":
        try:
            schema = json.loads(content.decode("utf-8-sig"))
        except Exception:
            raise AppError(400, "Le JSON n’est pas valide.")
        if not isinstance(schema, dict) or not isinstance(schema.get("sections"), list):
            raise AppError(400, "Le JSON doit contenir un objet avec un tableau 'sections'.")
        schema.setdefault("title", Path(filename).stem)
        schema.setdefault("short_title", str(schema["title"])[:80])
    else:
        raise AppError(400, "Format non pris en charge. Utilisez un XLSForm .xlsx ou un schéma .json CollectPlus.")
    title = str(schema.get("title") or "Enquête importée")[:160]
    with db() as conn:
        form = core.create_form(conn, title, str(schema.get("short_title") or title)[:80], str(schema.get("description") or "")[:1000], schema["sections"])
        _audit(conn, request, "form.import", str(form["id"]), filename)
    form["import_warnings"] = schema.get("import_warnings", [])
    form["ignored_rules"] = schema.get("ignored_rules", 0)
    return form


def _set_status(form_id: int, status: str, request: Request) -> dict[str, Any]:
    with db() as conn:
        core.get_form(conn, form_id)
        conn.execute("UPDATE forms SET status=?, published_at=? WHERE id=?",
                     (status, core.utc_now() if status == "published" else None, form_id))
        _audit(conn, request, f"form.{'publish' if status == 'published' else 'unpublish'}", str(form_id))
        return core.get_form(conn, form_id)


@app.post("/api/forms/{form_id}/publish")
def publish_form(form_id: int, request: Request) -> dict[str, Any]:
    return _set_status(form_id, "published", request)


@app.post("/api/forms/{form_id}/unpublish")
def unpublish_form(form_id: int, request: Request) -> dict[str, Any]:
    return _set_status(form_id, "draft", request)


@app.delete("/api/forms/{form_id}")
def delete_form(form_id: int, request: Request) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT is_system, title FROM forms WHERE id = ?", (form_id,)).fetchone()
        if row is None:
            raise AppError(404, "Enquête introuvable")
        if row["is_system"]:
            raise AppError(400, "Ce formulaire système ne peut pas être supprimé.")
        if conn.execute("SELECT COUNT(*) FROM submissions WHERE form_id = ?", (form_id,)).fetchone()[0]:
            raise AppError(409, "Ce formulaire possède des soumissions : dépubliez-le plutôt que de supprimer les données collectées.")
        conn.execute("DELETE FROM public_form_links WHERE form_id = ?", (form_id,))
        conn.execute("DELETE FROM forms WHERE id = ?", (form_id,))
        _audit(conn, request, "form.delete", str(form_id), row["title"])
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Partage public
# --------------------------------------------------------------------------- #
@app.post("/api/forms/{form_id}/share")
def create_public_link(form_id: int, request: Request) -> dict[str, Any]:
    base = configured_public_base(request)
    token, created = secrets.token_urlsafe(24), core.utc_now()
    with db() as conn:
        form = core.get_form(conn, form_id)
        conn.execute("INSERT INTO public_form_links(form_id, token, is_active, created_at) VALUES (?, ?, 1, ?)", (form_id, token, created))
        if form["status"] != "published":  # un lien public n'a de sens que pour un formulaire publié
            conn.execute("UPDATE forms SET status='published', published_at=? WHERE id=?", (created, form_id))
        _audit(conn, request, "link.create", str(form_id), form["title"])
    return {"ok": True, "form_id": form_id, "form_title": form["title"], "token": token, "url": f"{base}/public/{token}", "created_at": created}


@app.get("/api/forms/{form_id}/share")
def get_public_links(form_id: int) -> list[dict[str, Any]]:
    with db() as conn:
        core.get_form(conn, form_id)
        rows = conn.execute("SELECT token, is_active, created_at FROM public_form_links WHERE form_id=? ORDER BY id DESC", (form_id,)).fetchall()
    return [{"token": r["token"], "is_active": bool(r["is_active"]), "created_at": r["created_at"]} for r in rows]


@app.get("/api/links")
def all_links(request: Request) -> list[dict[str, Any]]:
    base = configured_public_base(request)
    with db() as conn:
        rows = conn.execute("SELECT l.token, l.form_id, l.is_active, l.created_at, f.title, f.status,"
                            " (SELECT COUNT(*) FROM submissions s WHERE s.form_id=f.id) AS n"
                            " FROM public_form_links l JOIN forms f ON f.id=l.form_id ORDER BY l.id DESC").fetchall()
    return [{"token": r["token"], "form_id": r["form_id"], "form_title": r["title"], "form_status": r["status"],
             "is_active": bool(r["is_active"]), "created_at": r["created_at"], "submissions": r["n"],
             "url": f"{base}/public/{r['token']}"} for r in rows]


@app.post("/api/links/{token}/revoke")
def revoke_link(token: str, request: Request) -> dict[str, Any]:
    with db() as conn:
        cur = conn.execute("UPDATE public_form_links SET is_active=0 WHERE token=?", (token,))
        if cur.rowcount == 0:
            raise AppError(404, "Lien introuvable.")
        _audit(conn, request, "link.revoke", token[:6] + "…")
    return {"ok": True}


@app.post("/api/forms/{form_id}/share/revoke")
def revoke_public_links(form_id: int, request: Request) -> dict[str, Any]:
    with db() as conn:
        core.get_form(conn, form_id)
        conn.execute("UPDATE public_form_links SET is_active=0 WHERE form_id=?", (form_id,))
        _audit(conn, request, "link.revoke_all", str(form_id))
    return {"ok": True, "revoked": True}


@app.get("/api/forms/{form_id}/share/{token}/qr.png")
def public_link_qr(form_id: int, token: str, request: Request) -> Response:
    with db() as conn:
        row = conn.execute("SELECT is_active FROM public_form_links WHERE form_id=? AND token=?", (form_id, token)).fetchone()
    if row is None or not row["is_active"]:
        raise AppError(404, "Lien public invalide ou désactivé.")
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=7, border=3)
    qr.add_data(f"{configured_public_base(request)}/public/{token}")
    qr.make(fit=True)
    buf = io.BytesIO()
    qr.make_image(fill_color="#0b2545", back_color="white").save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png",
                    headers={"Cache-Control": "private, no-store", "Content-Disposition": f'inline; filename="collectplus_qr_{form_id}.png"'})


def _public_form(token: str) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT form_id FROM public_form_links WHERE token=? AND is_active=1", (token,)).fetchone()
        if row is None:
            raise AppError(404, "Lien public invalide ou désactivé.")
        form = core.get_form(conn, int(row["form_id"]))
    if form["status"] != "published":
        raise AppError(404, "Lien public invalide ou désactivé.")
    return form


@app.get("/api/public/{token}/form")
def get_public_form(token: str) -> dict[str, Any]:
    f = _public_form(token)
    return {"key": f.get("key"), "title": f["title"], "short_title": f["short_title"], "description": f.get("description", ""), "sections": f["sections"]}


@app.get("/public/{token}")
def public_form_page(token: str) -> FileResponse:
    _public_form(token)
    return FileResponse(STATIC_DIR / "public.html", media_type="text/html", headers={"Cache-Control": "no-store"})


@app.post("/api/public/{token}/submissions")
def submit_public_form(token: str, body: PublicSubmissionIn) -> dict[str, Any]:
    form = _public_form(token)
    with db() as conn:
        return core.store_submission(conn, form, "pub-" + secrets.token_hex(12), body.data, None, "public")


# --------------------------------------------------------------------------- #
# Soumissions
# --------------------------------------------------------------------------- #
def _collector_name(request: Request) -> str:
    raw = unquote(request.headers.get("x-collector", "")).strip()  # le client encode le nom (en-têtes ASCII uniquement)
    cleaned = re.sub(r"[^\w .'@-]", "", raw, flags=re.UNICODE)[:60].strip()
    return cleaned or request.state.actor


@app.post("/api/submissions")
def create_submission(body: SubmissionIn, request: Request) -> dict[str, Any]:
    with db() as conn:
        form = None
        if body.form_key:  # clé stable : fonctionne même si l'identifiant diffère (APK fraîchement installé)
            form = core.find_form_by_key(conn, body.form_key)
            if form is None:
                raise AppError(404, "Le formulaire associé à cette soumission n’existe pas sur le serveur.")
        elif body.form_id is not None:
            form = core.get_form(conn, body.form_id)
        else:
            raise AppError(422, "form_id ou form_key est requis.")
        if not is_admin(request) and form["status"] != "published":
            raise AppError(404, "Enquête introuvable")
        return core.store_submission(conn, form, body.id or uuid.uuid4().hex, body.data, body.submitted_at, _collector_name(request))


def _date_args(date_from: str | None, date_to: str | None):
    return core.parse_day(date_from), core.parse_day(date_to)


@app.get("/api/submissions")
def list_submissions(limit: int = 50, offset: int = 0, date_from: str | None = None, date_to: str | None = None,
                     province: str | None = None, zone: str | None = None, aire: str | None = None,
                     form_id: int | None = None, q: str | None = None) -> dict[str, Any]:
    with db() as conn:
        return core.list_submissions(conn, limit, offset, date_from, date_to, province, zone, aire, form_id, (q or "")[:100] or None)


@app.get("/api/submissions/{sub_id}")
def get_submission(sub_id: str) -> dict[str, Any]:
    with db() as conn:
        return core.get_submission(conn, sub_id)


@app.get("/api/attachments/{att_id}")
def get_attachment(att_id: str) -> Response:
    if not re.fullmatch(r"[0-9a-f]{32}", att_id):
        raise AppError(404, "Pièce jointe introuvable")
    with db() as conn:
        row = conn.execute("SELECT mime, data FROM attachments WHERE id=?", (att_id,)).fetchone()
    if row is None:
        raise AppError(404, "Pièce jointe introuvable")
    return Response(bytes(row["data"]), media_type=row["mime"], headers={"Cache-Control": "private, max-age=3600", "Content-Disposition": "inline"})


# --------------------------------------------------------------------------- #
# Statistiques
# --------------------------------------------------------------------------- #
@app.get("/api/stats")
def stats(date_from: str | None = None, date_to: str | None = None, province: str | None = None,
          zone: str | None = None, aire: str | None = None, form_id: int | None = None) -> dict[str, Any]:
    with db() as conn:
        return core.dashboard_stats(conn, date_from, date_to, province, zone, aire, form_id, admins=1)


@app.get("/api/forms/{form_id}/stats")
def form_stats(form_id: int, date_from: str | None = None, date_to: str | None = None) -> dict[str, Any]:
    with db() as conn:
        return core.form_stats(conn, core.get_form(conn, form_id), date_from, date_to)


# --------------------------------------------------------------------------- #
# Exports
# --------------------------------------------------------------------------- #
def _export(request: Request, fmt: str, form_id: int | None) -> Response:
    with db() as conn:
        if form_id is not None:
            core.get_form(conn, form_id)
        name = f"collectplus_export_{form_id or 'toutes_enquetes'}.{fmt}"
        if fmt == "json":
            body, media = core.export_json_text(conn, form_id).encode("utf-8"), "application/json; charset=utf-8"
        else:
            headers, rows = core.export_rows(conn, form_id)
            if fmt == "csv":
                body, media = core.export_csv_text(headers, rows).encode("utf-8"), "text/csv; charset=utf-8"
            else:
                body, media = core.export_xlsx_bytes(headers, rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        _audit(conn, request, f"export.{fmt}", str(form_id or "all"))
    return Response(body, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/export/csv")
def export_csv(request: Request, form_id: int | None = None) -> Response:
    return _export(request, "csv", form_id)


@app.get("/api/export/json")
def export_json(request: Request, form_id: int | None = None) -> Response:
    return _export(request, "json", form_id)


@app.get("/api/export/xlsx")
def export_xlsx(request: Request, form_id: int | None = None) -> Response:
    return _export(request, "xlsx", form_id)


# --------------------------------------------------------------------------- #
# Administration
# --------------------------------------------------------------------------- #
@app.get("/api/audit")
def audit_log(limit: int = 100) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT at, actor, action, target, detail FROM audit_log ORDER BY id DESC LIMIT ?", (max(1, min(limit, 500)),)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/collectors")
def collectors() -> list[dict[str, Any]]:
    with db() as conn:
        return core.list_collectors(conn)


@app.get("/api/system")
def system_info() -> dict[str, Any]:
    backups = DB_PATH.parent / "backups"
    last_backup = max((p.stat().st_mtime for p in [*backups.glob("*.sqlite3"), *backups.glob("*.db")]), default=None) if backups.exists() else None
    with db() as conn:
        counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("forms", "submissions", "attachments", "audit_log")}
        att_bytes = conn.execute("SELECT COALESCE(SUM(size),0) FROM attachments").fetchone()[0]
    return {"version": APP_VERSION, "db_bytes": DB_PATH.stat().st_size if DB_PATH.exists() else 0, "attachments_bytes": att_bytes,
            "counts": counts, "last_backup": last_backup,
            "security": {"admin_password": bool(_ADMIN_PASSWORD), "collector_account": bool(_COLLECTOR_USERNAME and _COLLECTOR_PASSWORD),
                         "production_mode": PRODUCTION, "public_url_https": os.getenv("COLLECTPLUS_PUBLIC_BASE_URL", "").startswith("https://"),
                         "cors_origins": len(_allowed_origins), "rate_limit_per_minute": _RATE_LIMIT_PUBLIC}}
