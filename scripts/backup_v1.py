"""Respaldo de la base de la v1 (fase-3-respaldo.md, 3.5; decisión E).

Copia consistente de `grimoire.db` con la API de backup de SQLite (la v1 puede estar abierta),
`PRAGMA integrity_check` sobre la copia, cifrado con `age -r` y subida como asset a la Release
`v1-AAAA-MM-DD` de Kuraos/grimoire-backups. El texto plano solo vive en un temporal. Imprime
nombres de tabla y conteos, nunca filas.

Uso: python -I scripts/backup_v1.py [--db RUTA] [--recipient age1…] [--out ARCHIVO.age]
  --recipient  por defecto, la variable de entorno AGE_RECIPIENT.
  --out        deja el cifrado ahí y no sube nada (prueba local).
"""
import argparse
import datetime
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = "Kuraos/grimoire-backups"
DB = Path(os.environ.get("APPDATA", "")) / "Grimoire" / "grimoire.db"


def snapshot(db: Path, dest: Path) -> dict[str, int]:
    """Copia `db` en `dest` y devuelve los conteos por tabla. Falla si la copia no está íntegra."""
    src = sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True)
    dst = sqlite3.connect(dest)
    try:
        src.backup(dst)
        if (check := dst.execute("PRAGMA integrity_check").fetchall()) != [("ok",)]:
            raise SystemExit(f"FALLA: integrity_check con {len(check)} problemas")
        names = [n for (n,) in dst.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        return {n: dst.execute(f'SELECT COUNT(*) FROM "{n}"').fetchone()[0] for n in names}
    finally:
        src.close()
        dst.close()


def upload(path: Path, tag: str) -> None:
    gh = ["gh", "release"]
    exists = subprocess.run([*gh, "view", tag, "-R", REPO], capture_output=True).returncode == 0
    if not exists:
        subprocess.run([*gh, "create", tag, "-R", REPO, "--title", tag,
                        "--notes", "Respaldo cifrado de la base de la v1."], check=True)
    subprocess.run([*gh, "upload", tag, str(path), "-R", REPO, "--clobber"], check=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DB)
    p.add_argument("--recipient", default=os.environ.get("AGE_RECIPIENT"))
    p.add_argument("--out", type=Path)
    a = p.parse_args()
    if not a.recipient:
        sys.exit("falta AGE_RECIPIENT o --recipient")
    if not a.db.is_file():
        sys.exit(f"no existe {a.db}")

    stamp = datetime.date.today().isoformat()  # fecha local del PC (Bogotá)
    with tempfile.TemporaryDirectory() as tmp:
        plain = Path(tmp) / "grimoire-v1.db"
        for table, n in snapshot(a.db, plain).items():
            print(f"{table}: {n}")
        enc = a.out or Path(tmp) / f"grimoire-v1-{stamp}.db.age"
        subprocess.run(["age", "-r", a.recipient, "-o", str(enc), str(plain)], check=True)
        print(f"cifrado: {enc.stat().st_size} bytes")
        if not a.out:
            upload(enc, f"v1-{stamp}")
            print(f"subido a {REPO}, release v1-{stamp}")


if __name__ == "__main__":
    main()
