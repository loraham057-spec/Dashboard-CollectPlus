from __future__ import annotations

import csv
import io
import json
import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = ROOT_DIR / "data"
DB_PATH = Path(os.getenv("COLLECTPLUS_DB", str(DATA_DIR / "collectplus.db")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="CollectPlus",
    version="0.5.0",
    description="Plateforme de collecte mobile, partage public anonyme, cartographie GPS et tableaux de bord dynamiques.",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


MAPEPI_FORM: dict[str, Any] = {
    "key": "mapepi-incidents-v1",
    "title": "Fiche d’enregistrement et de suivi d’incident",
    "short_title": "Incidents MAPEPI",
    "description": "Déclaration, suivi et clôture des incidents liés au transport et à la traçabilité des échantillons biologiques.",
    "version": 1,
    "sections": [
        {
            "title": "1. Identification de l’incident",
            "description": "Renseignez les informations disponibles au moment de la déclaration.",
            "questions": [
                {"name": "reference_incident", "label": "Référence de l’incident", "type": "text", "required": True, "placeholder": "Ex. INC-HL-2026-001"},
                {"name": "numero_epid", "label": "N° EPID", "type": "text", "required": False},
                {"name": "date_detection", "label": "Date de détection", "type": "date", "required": True},
                {"name": "heure_detection", "label": "Heure de détection", "type": "time"},
                {"name": "date_declaration", "label": "Date de déclaration", "type": "date", "required": True},
                {"name": "heure_declaration", "label": "Heure de déclaration", "type": "time"},
                {"name": "province", "label": "Province", "type": "select", "required": True, "options": ["Bas-Uele","Équateur","Haut-Katanga","Haut-Lomami","Haut-Uele","Ituri","Kasaï","Kasaï Central","Kasaï Oriental","Kinshasa","Kongo Central","Kwango","Kwilu","Lomami","Lualaba","Mai-Ndombe","Maniema","Mongala","Nord-Kivu","Nord-Ubangi","Sankuru","Sud-Kivu","Sud-Ubangi","Tanganyika","Tshopo","Tshuapa","Autre"]},
                {"name": "zone_sante", "label": "Zone de santé", "type": "text", "required": True},
                {"name": "site_prelevement", "label": "Site de prélèvement / aire de santé / structure", "type": "text", "required": True},
                {"name": "destination", "label": "Point de destination / laboratoire", "type": "text", "required": True},
                {"name": "declare_par", "label": "Déclaré par (nom et fonction)", "type": "text", "required": True},
                {"name": "telephone", "label": "Téléphone / contact", "type": "phone"},
                {"name": "organisation", "label": "Organisation / service", "type": "text"},
            ],
        },
        {
            "title": "2. Étape du circuit concernée",
            "description": "Plusieurs réponses sont possibles.",
            "questions": [
                {"name": "etapes_circuit", "label": "Étape(s) du circuit", "type": "multiselect", "required": True, "options": [
                    "Transport Communauté/AS vers le BCZ", "Transport BCZ vers l’antenne PEV", "Transport Communauté/AS vers l’antenne PEV", "Transport Antenne PEV vers Chef-Lieu Province ou point de sortie", "Transport Chef-Lieu Province vers Labo", "Réception au BCZ", "Réception à l’antenne PEV", "Réception au laboratoire d’analyse", "Autre"
                ]},
                {"name": "autre_etape", "label": "Autre étape (préciser)", "type": "text"},
            ],
        },
        {
            "title": "3. Type et niveau de l’incident",
            "description": "Sélectionnez tous les motifs constatés.",
            "questions": [
                {"name": "motifs_incident", "label": "Motif(s) de l’incident", "type": "multiselect", "required": True, "options": [
                    "Retard dans la collecte ou l’acheminement de l’échantillon", "Doublon du numéro EPID", "Échantillon mal étiqueté ou non étiqueté", "Échantillon prélevé dans un contenant inapproprié", "Réception d’un seul échantillon de selles au lieu des deux requis (PFA)", "Échantillon non localisé ou perte de traçabilité", "Fiche papier incomplète ou mal renseignée", "Échantillon reçu sans fiche d’accompagnement ou de notification", "Données DHIS2 manquantes ou erronées", "Absence de réseau ou difficulté de synchronisation des données", "Discordance entre la fiche papier et les données du Tracker DHIS2", "Problème de conditionnement ou d’emballage de l’échantillon", "Fuite ou déversement de l’échantillon", "Volume d’échantillon insuffisant", "Non-respect de la chaîne du froid pendant l’acheminement", "Accident de circulation impliquant le transporteur", "Refus de réception de l’échantillon par la structure destinataire", "Indisponibilité du moyen de transport", "Incident lié à la sécurité sur l’itinéraire", "Autre"
                ]},
                {"name": "autre_motif", "label": "Autre motif (préciser)", "type": "textarea"},
                {"name": "maladie_echantillon", "label": "Type de maladie / échantillon concerné", "type": "multiselect", "required": True, "options": ["PFA", "Cas contacts PFA", "Mpox", "Choléra", "Rougeole", "Fièvre jaune", "Fièvres hémorragiques virales"]},
            ],
        },
        {
            "title": "4. Impact sur le transport et la traçabilité",
            "description": "Cochez les conséquences observées ou les risques identifiés.",
            "questions": [
                {"name": "impacts", "label": "Impact(s) constaté(s)", "type": "multiselect", "options": [
                    "Aucun impact constaté", "Dépassement du délai recommandé de collecte ou d’acheminement", "Retard dans la transmission au laboratoire destinataire", "Risque de rejet de l’échantillon par le laboratoire", "Altération de la qualité ou de l’intégrité de l’échantillon", "Perte de traçabilité ou interruption du suivi", "Données de suivi incomplètes, manquantes ou erronées", "Exposition accidentelle du personnel à un échantillon biologique", "Risque de contamination du personnel ou de l’environnement", "Rupture de la chaîne du froid pendant l’acheminement", "Nécessité de procéder à un nouveau prélèvement", "Autre"
                ]},
                {"name": "autre_impact", "label": "Autre impact (préciser)", "type": "textarea"},
                {"name": "verification_effectuee", "label": "Vérification avec la fiche papier / le registre / le terrain effectuée ?", "type": "select", "required": True, "options": ["Oui", "Non"]},
            ],
        },
        {
            "title": "5. Notification et suivi",
            "questions": [
                {"name": "partage_whatsapp", "label": "Incident partagé au groupe WhatsApp de suivi ?", "type": "select", "options": ["Oui", "Non"]},
                {"name": "date_partage_whatsapp", "label": "Date du partage", "type": "date"},
                {"name": "presente_reunion", "label": "Présenté à la réunion hebdomadaire / bi-hebdomadaire ?", "type": "select", "options": ["Oui", "Non"]},
                {"name": "date_reunion", "label": "Date de la réunion", "type": "date"},
            ],
        },
        {
            "title": "6. Mesures immédiates prises",
            "description": "Saisissez les mesures principales. Le détail peut être complété dans les commentaires.",
            "questions": [
                {"name": "mesure_immediate", "label": "Mesure(s) immédiate(s) prise(s)", "type": "textarea", "required": True},
                {"name": "responsable_mesure", "label": "Responsable", "type": "text"},
                {"name": "date_heure_mesure", "label": "Date et heure", "type": "datetime"},
                {"name": "resultat_mesure", "label": "Résultat obtenu", "type": "textarea"},
            ],
        },
        {
            "title": "7. Mesures correctives et clôture",
            "questions": [
                {"name": "action_corrective", "label": "Action corrective / préventive convenue", "type": "textarea", "required": True},
                {"name": "responsable_action", "label": "Responsable de l’action", "type": "text", "required": True},
                {"name": "echeance_action", "label": "Échéance", "type": "date"},
                {"name": "statut_incident", "label": "Statut de l’incident", "type": "select", "required": True, "options": ["Ouvert", "En cours", "Résolu"]},
                {"name": "date_resolution", "label": "Date de résolution", "type": "date"},
                {"name": "preuve_cloture", "label": "Preuve / commentaire de clôture", "type": "textarea"},
            ],
        },
    ],
}


def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with db_conn() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS forms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            short_title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            schema_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            is_system INTEGER NOT NULL DEFAULT 0
        )""")
        # Backward-compatible migrations for form sharing.
        columns = {row[1] for row in conn.execute("PRAGMA table_info(forms)").fetchall()}
        if "public_token" not in columns:
            conn.execute("ALTER TABLE forms ADD COLUMN public_token TEXT")
        if "public_enabled" not in columns:
            conn.execute("ALTER TABLE forms ADD COLUMN public_enabled INTEGER NOT NULL DEFAULT 0")
        if "status" not in columns:
            conn.execute("ALTER TABLE forms ADD COLUMN status TEXT NOT NULL DEFAULT 'published'")
        conn.execute("""CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'enqueteur', active INTEGER NOT NULL DEFAULT 1)""")
        if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            conn.execute("INSERT INTO users(name, role) VALUES ('Berly LORA', 'admin')")
        conn.execute("""CREATE TABLE IF NOT EXISTS submissions (
            id TEXT PRIMARY KEY,
            form_id INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            submitted_at TEXT NOT NULL,
            FOREIGN KEY(form_id) REFERENCES forms(id)
        )""")
        row = conn.execute("SELECT id FROM forms WHERE short_title = ?", (MAPEPI_FORM["short_title"],)).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO forms(title, short_title, description, schema_json, created_at, is_system) VALUES (?, ?, ?, ?, ?, 1)",
                (MAPEPI_FORM["title"], MAPEPI_FORM["short_title"], MAPEPI_FORM["description"], json.dumps(MAPEPI_FORM, ensure_ascii=False), utc_now()),
            )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def form_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    schema = json.loads(row["schema_json"])
    schema["id"] = row["id"]
    schema["created_at"] = row["created_at"]
    schema["is_system"] = bool(row["is_system"])
    schema["public_enabled"] = bool(row["public_enabled"]) if "public_enabled" in row.keys() else False
    schema["public_token"] = row["public_token"] if "public_token" in row.keys() else None
    schema["status"] = row["status"] if "status" in row.keys() else "published"
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


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/p/{token}")
def public_form_page(token: str) -> FileResponse:
    with db_conn() as conn:
        row = conn.execute("SELECT id FROM forms WHERE public_token=? AND public_enabled=1", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Ce formulaire public est indisponible ou a été fermé.")
    return FileResponse(STATIC_DIR / "public.html")


@app.get("/api/public/forms/{token}")
def get_public_form(token: str) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT * FROM forms WHERE public_token=? AND public_enabled=1", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Formulaire public indisponible")
    schema = form_to_dict(row)
    # Do not expose management fields or internal form database identifiers to respondents.
    return {"key": schema.get("key"), "title": schema.get("title"), "short_title": schema.get("short_title"), "description": schema.get("description"), "sections": schema.get("sections", [])}


@app.post("/api/public/forms/{token}/submissions")
def submit_public_form(token: str, submission: dict[str, Any]) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT * FROM forms WHERE public_token=? AND public_enabled=1", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Formulaire public indisponible")
    schema = form_to_dict(row)
    data = submission.get("data")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Les réponses doivent être fournies sous forme d'objet.")
    # Honeypot field: silently acknowledge automated spam without storing it.
    if str(data.get("website", "")).strip():
        return {"ok": True, "id": str(uuid.uuid4()), "submitted_at": utc_now(), "message": "Votre réponse a été enregistrée."}
    # Enforce required questions server-side as well as in the public browser form.
    for section in schema.get("sections", []):
        for question in section.get("questions", []):
            if question.get("required") and not question.get("type") == "note":
                value = data.get(question.get("name"))
                if value is None or value == "" or value == []:
                    raise HTTPException(status_code=422, detail=f"Réponse obligatoire manquante : {question.get('label', question.get('name'))}")
    sub_id = str(uuid.uuid4())
    submitted_at = utc_now()
    data["_submission_channel"] = "public_link_anonymous"
    with db_conn() as conn:
        conn.execute("INSERT INTO submissions(id, form_id, payload_json, submitted_at) VALUES (?, ?, ?, ?)", (sub_id, row["id"], json.dumps(data, ensure_ascii=False), submitted_at))
    return {"ok": True, "id": sub_id, "submitted_at": submitted_at, "message": "Votre réponse a été enregistrée."}


@app.post("/api/forms/{form_id}/publish")
def publish_form(form_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    enabled = bool(payload.get("enabled", True))
    with db_conn() as conn:
        row = conn.execute("SELECT id, public_token FROM forms WHERE id=?", (form_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Enquête introuvable")
        token = row["public_token"] or uuid.uuid4().hex + uuid.uuid4().hex[:16]
        conn.execute("UPDATE forms SET public_token=?, public_enabled=? WHERE id=?", (token, int(enabled), form_id))
    return {"form_id": form_id, "public_enabled": enabled, "public_token": token, "public_url": f"/p/{token}" if enabled else None}


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


@app.post("/api/forms")
def create_form(form: FormCreate) -> dict[str, Any]:
    if not form.sections:
        raise HTTPException(status_code=400, detail="Ajoutez au moins une section au formulaire.")
    for section in form.sections:
        if not isinstance(section, dict) or not section.get("questions"):
            raise HTTPException(status_code=400, detail="Chaque section doit contenir au moins une question.")
        for question in section["questions"]:
            if not question.get("name") or not question.get("label") or not question.get("type"):
                raise HTTPException(status_code=400, detail="Chaque question doit avoir un nom, un libellé et un type.")
    schema = {
        "key": f"custom-{uuid.uuid4().hex[:8]}",
        "title": form.title.strip(),
        "short_title": form.short_title.strip(),
        "description": form.description.strip(),
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


@app.delete("/api/forms/{form_id}")
def delete_form(form_id: int) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute("SELECT is_system FROM forms WHERE id = ?", (form_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Enquête introuvable")
        if row["is_system"]:
            raise HTTPException(status_code=400, detail="Le formulaire MAPEPI intégré ne peut pas être supprimé.")
        conn.execute("DELETE FROM submissions WHERE form_id = ?", (form_id,))
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
    if not rows:
        raise HTTPException(status_code=400, detail="La feuille survey est vide.")
    headers = [str(v).strip().lower() if v is not None else "" for v in rows[0]]
    table = [dict(zip(headers, row)) for row in rows[1:]]
    settings: dict[str, Any] = {}
    if "settings" in workbook.sheetnames:
        srows = list(workbook["settings"].iter_rows(values_only=True))
        if srows:
            sh = [str(v).strip().lower() if v is not None else "" for v in srows[0]]
            if len(srows) > 1:
                settings = dict(zip(sh, srows[1]))
    choices: dict[str, list[dict[str, str]]] = {}
    if "choices" in workbook.sheetnames:
        crows = list(workbook["choices"].iter_rows(values_only=True))
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
            q["type"] = {"integer": "number", "decimal": "number", "note": "note", "geopoint": "text", "image": "text", "audio": "text", "barcode": "text"}.get(raw_type, raw_type)
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
    filename = file.filename or "formulaire"
    content = await file.read()
    suffix = Path(filename).suffix.lower()
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
    get_form_or_404(resolved_form_id)
    sub_id = submission.id or str(uuid.uuid4())
    submitted_at = submission.submitted_at or utc_now()
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
def dashboard(start_date: str | None = None, end_date: str | None = None, form_id: int | None = None, province: str | None = None) -> dict[str, Any]:
    records = read_submissions(form_id)
    filtered = []
    for rec in records:
        date_part = str(rec.get("submitted_at", ""))[:10]
        if start_date and date_part < start_date: continue
        if end_date and date_part > end_date: continue
        if province and province != "all":
            pv = str(rec.get("data", {}).get("province", ""))
            if pv.replace("-", " ").casefold() != province.replace("-", " ").casefold(): continue
        filtered.append(rec)
    all_forms = list_forms()
    statuses: dict[str, int] = {"Ouvert": 0, "En cours": 0, "Résolu": 0}
    disease_counts: dict[str, int] = {}
    by_form_counts: dict[str, int] = {}
    monthly: dict[str, int] = {}
    points: list[dict[str, Any]] = []
    for rec in filtered:
        payload = rec["data"]
        status = payload.get("statut_incident") or payload.get("status")
        if status in statuses: statuses[status] += 1
        diseases = payload.get("maladie_echantillon", [])
        if isinstance(diseases, str): diseases = [diseases]
        if isinstance(diseases, list):
            for disease in diseases: disease_counts[str(disease)] = disease_counts.get(str(disease), 0) + 1
        title = rec.get("short_title") or rec.get("form_title") or "Enquête"
        by_form_counts[title] = by_form_counts.get(title, 0) + 1
        month = str(rec.get("submitted_at", ""))[:7]
        if month: monthly[month] = monthly.get(month, 0) + 1
        lat, lon = extract_coordinates(payload)
        if lat is not None and lon is not None:
            points.append({"id": rec["id"], "lat": lat, "lon": lon, "title": title, "submitted_at": rec["submitted_at"], "province": payload.get("province", ""), "primary": payload.get("reference_incident") or payload.get("name") or rec["id"][:8]})
    all_recs = read_submissions(form_id)
    def in_range(rec, a, b):
        d = str(rec.get("submitted_at", ""))[:10]
        return (not a or d >= a) and (not b or d <= b)
    prev_count = None
    if start_date and end_date:
        try:
            a, b = datetime.fromisoformat(start_date), datetime.fromisoformat(end_date)
            span = (b - a).days + 1
            pa, pb = (a - timedelta(days=span)).date().isoformat(), (a - timedelta(days=1)).date().isoformat()
            prev_count = sum(1 for r in all_recs if in_range(r, pa, pb))
        except ValueError:
            pass
    daily: dict[str, list[int]] = {}
    by_province: dict[str, int] = {}
    by_zone: dict[str, int] = {}
    last_by_form: dict[str, list[str]] = {}
    geo = 0
    comp_sum = 0.0
    schemas = {f["id"]: f for f in all_forms}
    for rec in filtered:
        d = str(rec["submitted_at"])[:10]
        has_gps = extract_coordinates(rec["data"])[0] is not None
        geo += has_gps
        row = daily.setdefault(d, [0, 0]); row[0] += 1; row[1] += int(has_gps)
        pv = str(rec["data"].get("province") or "Autres"); by_province[pv] = by_province.get(pv, 0) + 1
        zs = rec["data"].get("zone_sante")
        if zs: by_zone[str(zs)] = by_zone.get(str(zs), 0) + 1
        qs = [q for sec in schemas.get(rec["form_id"], {}).get("sections", []) for q in sec.get("questions", []) if q.get("type") != "note"]
        req = [q for q in qs if q.get("required")] or qs
        if req:
            comp_sum += sum(1 for q in req if rec["data"].get(q["name"]) not in (None, "", [])) / len(req)
        dates = last_by_form.setdefault(rec["short_title"], [rec["submitted_at"][:10], rec["submitted_at"][:10]])
        dates[0] = min(dates[0], rec["submitted_at"][:10]); dates[1] = max(dates[1], rec["submitted_at"][:10])
    counts_by_form = {f["id"]: 0 for f in all_forms}
    for rec in filtered: counts_by_form[rec["form_id"]] = counts_by_form.get(rec["form_id"], 0) + 1
    published = sum(1 for f in all_forms if f.get("status", "published") == "published")
    with db_conn() as conn:
        users = [dict(r) for r in conn.execute("SELECT role, COUNT(*) n FROM users WHERE active=1 GROUP BY role").fetchall()]
    n = len(filtered)
    return {
        "form_count": len(all_forms), "published_count": published, "draft_count": len(all_forms) - published,
        "submission_count": n, "previous_count": prev_count, "geo_count": geo,
        "province_count": len([p for p in by_province if p != "Autres"]), "zone_count": len(by_zone),
        "completeness": round(100 * comp_sum / n) if n else 0,
        "users": {u["role"]: u["n"] for u in users},
        "status_counts": statuses, "disease_counts": disease_counts,
        "by_form": [{"label": k, "value": v} for k, v in sorted(by_form_counts.items(), key=lambda x: -x[1])],
        "by_province": [{"label": k, "value": v} for k, v in sorted(by_province.items(), key=lambda x: -x[1])],
        "by_zone": [{"label": k, "value": v} for k, v in sorted(by_zone.items(), key=lambda x: -x[1])],
        "daily": [{"label": k, "value": v[0], "gps": v[1]} for k, v in sorted(daily.items())],
        "monthly": [{"label": k, "value": v} for k, v in sorted(monthly.items())],
        "forms_table": [{"id": f["id"], "title": f.get("short_title") or f["title"], "status": f.get("status", "published"), "count": counts_by_form.get(f["id"], 0),
                         "from": (last_by_form.get(f.get("short_title"), [None, None])[0]), "to": (last_by_form.get(f.get("short_title"), [None, None])[1])} for f in all_forms],
        "points": points, "recent": filtered[:7],
        "filter_context": {"start_date": start_date, "end_date": end_date, "form_id": form_id, "province": province}
    }


def extract_coordinates(payload: dict[str, Any]) -> tuple[float | None, float | None]:
    # Supports explicit latitude/longitude fields and common XLSForm geopoint representations.
    for lat_key, lon_key in (("latitude", "longitude"), ("lat", "lon"), ("gps_latitude", "gps_longitude")):
        try:
            if payload.get(lat_key) is not None and payload.get(lon_key) is not None:
                lat, lon = float(payload[lat_key]), float(payload[lon_key])
                if -90 <= lat <= 90 and -180 <= lon <= 180: return lat, lon
        except (TypeError, ValueError): pass
    for key, value in payload.items():
        if str(key).lower() in ("location", "geopoint", "gps", "point_gps", "position"):
            try:
                if isinstance(value, (list, tuple)) and len(value) >= 2:
                    lat, lon = float(value[0]), float(value[1])
                else:
                    parts = str(value).replace(",", " ").split()
                    lat, lon = float(parts[0]), float(parts[1])
                if -90 <= lat <= 90 and -180 <= lon <= 180: return lat, lon
            except (TypeError, ValueError, IndexError): pass
    return None, None


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
            values.append("" if value is None else str(value))
        output.append(values)
    return headers, output


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


@app.post("/api/forms/{form_id}/status")
def set_form_status(form_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    status = "draft" if payload.get("status") == "draft" else "published"
    with db_conn() as conn:
        if conn.execute("UPDATE forms SET status=? WHERE id=?", (status, form_id)).rowcount == 0:
            raise HTTPException(status_code=404, detail="Enquête introuvable")
    return {"form_id": form_id, "status": status}


@app.get("/api/users")
def list_users() -> list[dict[str, Any]]:
    with db_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM users ORDER BY id").fetchall()]


@app.get("/download/apk")
def download_apk() -> FileResponse:
    apk = DATA_DIR / "CollectPlus.apk"
    if not apk.exists():
        raise HTTPException(status_code=404, detail="APK non compilé : voir android-wrapper/README_ANDROID.md")
    return FileResponse(apk, media_type="application/vnd.android.package-archive", filename="CollectPlus.apk")
