"""Seed sintético para medir las rutas del diario (fase-2-diario.md, 2.4.3). Sin datos reales.

1 000 entradas de ~2 000 caracteres de palabras inventadas, una por día hacia atrás desde el
2026-11-10, todas escritas. Ids y `save_id` empiezan por «b» para borrarlas sin tocar nada más. Nada
otorga XP: solo se mide la lectura.

Uso: python scripts/bench_seed_diary.py seed_diary.sql
     npx wrangler d1 execute grimoire --local --file seed_diary.sql
Limpiar:
     npx wrangler d1 execute grimoire --local --command "DELETE FROM diary_entries WHERE id LIKE 'b%'"
"""
import random
import sys
import uuid
from datetime import date, timedelta

N_ENTRIES, CHARS = 1000, 2000
END = date(2026, 11, 10)
WORDS = "luz piedra camino tinta vela norte hierro bruma sal raíz eco umbral ceniza río".split()
rng = random.Random(20261114)


def uid() -> str:
    return "b" + str(uuid.UUID(int=rng.getrandbits(128), version=4))[1:]


def text() -> str:
    out = []
    while sum(len(w) + 1 for w in out) < CHARS:
        out.append(rng.choice(WORDS))
    return " ".join(out)[:CHARS]


def main(path: str) -> None:
    rows = [
        f"('{uid()}','{END - timedelta(days=i)}','{text()}',NULL,1,'{uid()}','2026-11-10T17:00:00Z')"
        for i in range(N_ENTRIES)
    ]
    # D1 limita cada sentencia a 100 KB (SQLITE_TOOBIG): lotes de 20 filas (~42 KB)
    stmts = [
        "INSERT INTO diary_entries (id, local_date, content, tags, written, save_id, updated_at) VALUES "
        + ",".join(rows[i:i + 20]) + ";"
        for i in range(0, len(rows), 20)
    ]
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(stmts) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
