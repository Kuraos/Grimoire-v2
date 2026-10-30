"""Seed sintético para medir GET /habits y complete (tarea 0.3). Sin datos reales.

10 hábitos `Bench …`: 7 diarios, 2 L–V, 1 semanal 4×. Marcas desde hace 3 años
hasta ayer (2026-10-28, Bogotá), 95 % de cumplimiento, y racha intacta los
últimos 400 días en dos hábitos (peor caso para recorrer la racha).

Uso: python scripts/bench_seed.py seed.sql
     npx wrangler d1 execute grimoire --remote --file seed.sql
"""
import random
import sys
import uuid
from datetime import date, timedelta

rng = random.Random(20261029)
YESTERDAY = date(2026, 10, 28)
START = YESTERDAY - timedelta(days=3 * 365)
CREATED = f"{START.isoformat()}T05:00:00Z"  # medianoche en Bogotá


def uid() -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def esc(s: str) -> str:
    return s.replace("'", "''")


habits = (
    [("daily", None, 1, f"Bench diario {i}") for i in range(1, 8)]
    + [("daily", "0,1,2,3,4", 1, f"Bench L-V {i}") for i in range(1, 3)]
    + [("weekly", None, 4, "Bench semanal 4x")]
)

out = []
logs = []
for n, (freq, days, target, name) in enumerate(habits):
    hid = uid()
    out.append(
        "INSERT INTO habits (id, name, category, frequency, days, target_per_week, "
        f"xp_reward, created_at) VALUES ('{hid}', '{esc(name)}', 'Otro', '{freq}', "
        f"{'NULL' if days is None else repr(days)}, {target}, 20, '{CREATED}');"
    )
    unbroken_from = YESTERDAY - timedelta(days=400) if n < 2 else None
    d = START
    week_count = {}
    while d <= YESTERDAY:
        keep = (unbroken_from is not None and d >= unbroken_from) or rng.random() < 0.95
        if freq == "daily":
            on = days is None or str(d.weekday()) in days.split(",")
        else:
            monday = d - timedelta(days=d.weekday())
            on = d.weekday() < target and week_count.get(monday, 0) < target
            if on and keep:
                week_count[monday] = week_count.get(monday, 0) + 1
        if on and keep:
            logs.append((uid(), hid, d.isoformat(), f"{d.isoformat()}T23:00:00Z"))
        d += timedelta(days=1)

# D1 limita el tamaño de cada sentencia: INSERT multifila en bloques de 400
for i in range(0, len(logs), 400):
    rows = ",".join(f"('{a}','{b}','{c}','{e}')" for a, b, c, e in logs[i:i + 400])
    out.append(f"INSERT INTO habit_logs (id, habit_id, local_date, completed_at) VALUES {rows};")

open(sys.argv[1], "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
print(f"hábitos: {len(habits)}  marcas: {len(logs)}  sentencias: {len(out)}  "
      f"rango: {START} .. {YESTERDAY}")
