"""Tiny SQLite run log (analysis history shown on the Reports page)."""
import json
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "cultivamap.db"


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.execute("CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT, "
              "kind TEXT, dataset TEXT, params TEXT, summary TEXT)")
    return c


def log_run(kind, dataset, params, summary):
    try:
        with _conn() as c:
            c.execute("INSERT INTO runs (created, kind, dataset, params, summary) VALUES (?,?,?,?,?)",
                      (datetime.now().isoformat(timespec="seconds"), kind, dataset,
                       json.dumps(params), json.dumps(summary)))
    except Exception:
        pass            # history is a convenience, never break an analysis


def list_runs(limit=30):
    try:
        with _conn() as c:
            rows = c.execute("SELECT id, created, kind, dataset, params, summary FROM runs "
                             "ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{"id": r[0], "created": r[1], "kind": r[2], "dataset": r[3],
                 "params": json.loads(r[4]), "summary": json.loads(r[5])} for r in rows]
    except Exception:
        return []
