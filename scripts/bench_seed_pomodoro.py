"""Seed sintético para medir `GET /projects` y `POST /pomodoro/sessions` (fase-2-pomodoro.md,
decisión 5). Sin datos reales.

5 000 sesiones repartidas en dos años (90 % completas), 20 proyectos `Bench proyecto …`; el 80 %
de las sesiones con proyecto. Nada otorga XP: solo se mide la lectura.

Uso: python scripts/bench_seed_pomodoro.py seed_pomodoro.sql
     npx wrangler d1 execute grimoire --local --file seed_pomodoro.sql
Limpiar, una sentencia por comando:
     npx wrangler d1 execute grimoire --local --command "DELETE FROM pomodoro_sessions WHERE id LIKE 'b%'"
     npx wrangler d1 execute grimoire --local --command "DELETE FROM projects WHERE name LIKE 'Bench proyecto %'"
"""
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

N_SESSIONS, N_PROJECTS, DAYS = 5000, 20, 730
END = datetime(2026, 11, 1, 17, 0, tzinfo=timezone.utc)
rng = random.Random(20261105)


def uid(prefix: str = "") -> str:
    # las sesiones empiezan por «b» para poder borrarlas sin tocar las reales
    return prefix + str(uuid.UUID(int=rng.getrandbits(128), version=4))[len(prefix):]


def rfc3339(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def main(path: str) -> None:
    projects = [uid() for _ in range(N_PROJECTS)]
    out = [
        "INSERT INTO projects (id, name, created_at) VALUES "
        + ",".join(f"('{p}','Bench proyecto {i}','2024-01-01T05:00:00Z')" for i, p in enumerate(projects))
        + ";"
    ]
    rows = []
    for _ in range(N_SESSIONS):
        end = END - timedelta(minutes=rng.randrange(DAYS * 24 * 60))
        minutes = rng.choice([25, 25, 25, 50, 15])
        project = f"'{rng.choice(projects)}'" if rng.random() < 0.8 else "NULL"
        day = (end - timedelta(hours=5)).date().isoformat()  # Bogotá, UTC−5
        rows.append(
            f"('{uid('b')}',{project},{minutes},{int(rng.random() < 0.9)},"
            f"'{rfc3339(end - timedelta(minutes=minutes))}','{rfc3339(end)}','{day}')"
        )
    for i in range(0, len(rows), 500):
        out.append(
            "INSERT INTO pomodoro_sessions (id, project_id, work_minutes, completed, started_at, "
            "finished_at, local_date) VALUES " + ",".join(rows[i:i + 500]) + ";"
        )
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
