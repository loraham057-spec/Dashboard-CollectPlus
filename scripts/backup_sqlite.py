#!/usr/bin/env python3
"""Create a consistent SQLite backup using SQLite's online backup API.

Usage: python scripts/backup_sqlite.py [source_db] [backup_dir] [retention_days]
Do not publish backup files; they may contain personal data and photos.
"""
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os
import sqlite3
import sys

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "data" / "collectplus.db"
target_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "data" / "backups"
retention_days = int(sys.argv[3]) if len(sys.argv) > 3 else 30
if retention_days < 1 or retention_days > 3650:
    raise SystemExit("La rétention doit être comprise entre 1 et 3650 jours.")
if not source.exists():
    raise SystemExit(f"Base source introuvable : {source}")
target_dir.mkdir(parents=True, exist_ok=True)
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
target = target_dir / f"collectplus_{stamp}.sqlite3"
with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
    src.backup(dst)
    result = dst.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        target.unlink(missing_ok=True)
        raise SystemExit(f"Échec de contrôle d’intégrité : {result}")
try:
    os.chmod(target, 0o600)
except OSError:
    pass
cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
for item in target_dir.glob("collectplus_*.sqlite3"):
    try:
        modified = datetime.fromtimestamp(item.stat().st_mtime, timezone.utc)
        if modified < cutoff and item != target:
            item.unlink()
    except OSError:
        pass
print(f"Sauvegarde vérifiée : {target}")
