"""Tests de verify_dump.py. Uso: python -I scripts/test_verify_dump.py."""
import contextlib
import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_dump import MIGRATIONS, verify  # noqa: E402


def dump(tmp: Path, *, skip_last=False, sql="") -> Path:
    """Base con las migraciones y su registro en d1_migrations, volcada con iterdump."""
    files = sorted(MIGRATIONS.glob("*.sql"))
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,"
               " applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    for f in files[:-1] if skip_last else files:
        db.executescript(f.read_text(encoding="utf-8"))
        db.execute("INSERT INTO d1_migrations (name) VALUES (?)", (f.name,))
    db.executescript("INSERT INTO xp_log (id, source, source_id, amount, created_at) VALUES ('x1', 'habit', 'h', 20, '2026-11-15T00:00:00Z');"
                     "UPDATE users SET xp = 20;" + sql)
    path = tmp / "dump.sql"
    path.write_text("\n".join(db.iterdump()), encoding="utf-8")
    return path


class VerifyDump(unittest.TestCase):
    def run_verify(self, path: Path) -> list[str]:
        with contextlib.redirect_stdout(io.StringIO()):
            return verify(path)

    def test_bueno_pasa(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.run_verify(dump(Path(d))), [])

    def test_xp_alterado_falla(self):
        with tempfile.TemporaryDirectory() as d:
            errs = self.run_verify(dump(Path(d), sql="UPDATE users SET xp = 21;"))
            self.assertEqual(errs, ["users.xp distinto de SUM(xp_log.amount)"])

    def test_sin_ultima_migracion_falla(self):
        with tempfile.TemporaryDirectory() as d:
            errs = self.run_verify(dump(Path(d), skip_last=True))
            self.assertEqual(errs, [f"d1_migrations no tiene {sorted(MIGRATIONS.glob('*.sql'))[-1].name}"])

    def test_tabla_faltante_falla(self):
        with tempfile.TemporaryDirectory() as d:
            errs = self.run_verify(dump(Path(d), sql="DROP TABLE diary_entries;"))
            self.assertTrue(any("faltan tablas: diary_entries" in e for e in errs), errs)


if __name__ == "__main__":
    unittest.main()
