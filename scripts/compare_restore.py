"""Compara la API de producción con la de una base restaurada (fase-3-respaldo.md, 3.3).

Pide los mismos GET a los dos workers y lista las rutas JSON que difieren. No imprime tokens ni
valores (traen el diario y las finanzas), solo la ruta y si cambió el valor o la forma.

Uso: python -I scripts/compare_restore.py URL_A TOKEN_A_FILE URL_B TOKEN_B_FILE
         --date AAAA-MM-DD [--diary-day AAAA-MM-DD ...] [--ignore CLAVE ...]
Sale con 1 si hay diferencias fuera de las claves ignoradas.
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path


def get(base: str, token: str, path: str):
    req = urllib.request.Request(base.rstrip("/") + path, headers={
        "Authorization": f"Bearer {token}", "User-Agent": "grimoire-restore-check"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def diff(a, b, path: str, ignore: set[str], out: list[str]) -> None:
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k in ignore:
                continue
            if k not in a or k not in b:
                out.append(f"{path}.{k}: solo en {'B' if k not in a else 'A'}")
            else:
                diff(a[k], b[k], f"{path}.{k}", ignore, out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path}: {len(a)} frente a {len(b)} elementos")
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", ignore, out)
    elif a != b:
        out.append(f"{path}: valor distinto")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("url_a")
    p.add_argument("token_a", type=Path)
    p.add_argument("url_b")
    p.add_argument("token_b", type=Path)
    p.add_argument("--date", required=True)
    p.add_argument("--diary-day", action="append", default=[])
    p.add_argument("--ignore", action="append", default=[])
    a = p.parse_args()
    ta, tb = a.token_a.read_text().strip(), a.token_b.read_text().strip()
    paths = ["/user", "/habits", "/tasks", "/projects", f"/pomodoro/today?date={a.date}"]
    paths += [f"/diary/{d}" for d in a.diary_day]

    bad = 0
    for path in paths:
        found: list[str] = []
        diff(get(a.url_a, ta, path), get(a.url_b, tb, path), "$", set(a.ignore), found)
        print(f"{path}: {'igual' if not found else f'{len(found)} diferencias'}")
        for line in found[:20]:
            print("   ", line)
        bad += bool(found)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
