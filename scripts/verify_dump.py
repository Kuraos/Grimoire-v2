"""Verificación de un dump de D1 antes de cifrarlo (fase-3-respaldo.md, decisión C).

Importa el `.sql` en una base temporal y exige:
- `PRAGMA integrity_check` = `ok`;
- las tablas que crean las migraciones del repo (no una lista escrita a mano);
- `users.xp` = `SUM(xp_log.amount)`;
- la última migración del repo en `d1_migrations`.

Imprime solo nombres de tabla y conteos, nunca filas: el dump trae el diario y las finanzas.
Sale con 1 si algo falla.

Uso: python -I scripts/verify_dump.py dump.sql [--migrations api/migrations]
"""
import argparse
import sqlite3
import sys
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent.parent / "api" / "migrations"


def tables(db: sqlite3.Connection) -> set[str]:
    rows = db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    return {n for (n,) in rows if not n.startswith(("sqlite_", "_cf_")) and n != "d1_migrations"}


def expected(migrations: Path) -> tuple[set[str], str]:
    files = sorted(migrations.glob("*.sql"))
    db = sqlite3.connect(":memory:")
    for f in files:
        db.executescript(f.read_text(encoding="utf-8"))
    return tables(db), files[-1].name


def verify(dump: Path, migrations: Path = MIGRATIONS) -> list[str]:
    """Devuelve la lista de fallas (vacía si el dump pasa) e imprime los conteos."""
    want, last = expected(migrations)
    db = sqlite3.connect(":memory:")
    db.executescript(dump.read_text(encoding="utf-8"))
    errors = []

    check = db.execute("PRAGMA integrity_check").fetchall()
    if check != [("ok",)]:
        errors.append(f"integrity_check: {len(check)} problemas")

    have = tables(db)
    for t in sorted(have):
        (n,) = db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()
        print(f"{t}: {n}")
    if missing := want - have:
        errors.append(f"faltan tablas: {', '.join(sorted(missing))}")

    if {"users", "xp_log"} <= have:
        xp = db.execute("SELECT COALESCE(SUM(xp), 0) FROM users").fetchone()[0]
        log = db.execute("SELECT COALESCE(SUM(amount), 0) FROM xp_log").fetchone()[0]
        print(f"users.xp: {xp}  SUM(xp_log.amount): {log}")
        if xp != log:
            errors.append("users.xp distinto de SUM(xp_log.amount)")

    applied = set()
    if db.execute("SELECT 1 FROM sqlite_master WHERE name = 'd1_migrations'").fetchone():
        applied = {n for (n,) in db.execute("SELECT name FROM d1_migrations")}
    print(f"d1_migrations: {len(applied)}  última del repo: {last}")
    if last not in applied:
        errors.append(f"d1_migrations no tiene {last}")
    return errors


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("dump", type=Path)
    p.add_argument("--migrations", type=Path, default=MIGRATIONS)
    a = p.parse_args()
    errs = verify(a.dump, a.migrations)
    for e in errs:
        print(f"FALLA: {e}", file=sys.stderr)
    print("dump verificado" if not errs else "dump RECHAZADO")
    sys.exit(1 if errs else 0)
