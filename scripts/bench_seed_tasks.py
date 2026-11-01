"""Seeds sintéticos para medir `GET /tasks` y `GET /projects`. Sin datos reales.

- `realista`: la forma de los datos de la v1 (100 abiertas, 5 completadas recientes, ~3,4 ítems
  por tarea, 10 proyectos).
- `pesado`: 500 tareas (40 % hechas, repartidas en dos años), 0–4 ítems por tarea, 20 proyectos.

Títulos `Bench tarea …` y proyectos `Bench proyecto …`. Nada otorga XP: solo se mide la lectura.

Uso: python scripts/bench_seed_tasks.py <realista|pesado> seed_tasks.sql
     npx wrangler d1 execute grimoire --local --file seed_tasks.sql
Limpiar, una sentencia por comando (las dos juntas fallaron en remoto con `incomplete input`):
     npx wrangler d1 execute grimoire --local --command "DELETE FROM tasks WHERE title LIKE 'Bench tarea %'"
     npx wrangler d1 execute grimoire --local --command "DELETE FROM projects WHERE name LIKE 'Bench proyecto %'"
"""
import random
import sys
import uuid
from datetime import date, timedelta

TODAY = date(2026, 11, 1)
CREATED = "2024-01-01T05:00:00Z"
rng = random.Random(20261031)


def uid() -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def main(profile: str, path: str) -> None:
    if profile == "realista":
        n_projects, n_open, n_done, max_age = 10, 100, 5, 60
        items_for = lambda: rng.choice([3, 3, 3, 4, 4])  # ~3,4 por tarea, máx. 4 como la v1
    else:
        n_projects, n_open, n_done, max_age = 20, 300, 200, 730
        items_for = lambda: rng.randint(0, 4)

    projects = [uid() for _ in range(n_projects)]
    out = [
        "INSERT INTO projects (id, name, created_at) VALUES "
        + ",".join(f"('{p}','Bench proyecto {i}','{CREATED}')" for i, p in enumerate(projects))
        + ";"
    ]
    tasks, items = [], []
    for i in range(n_open + n_done):
        tid = uid()
        project = f"'{rng.choice(projects)}'" if rng.random() < 0.8 else "NULL"
        if i < n_open:
            status, at, on = rng.choice(["todo", "doing"]), "NULL", "NULL"
        else:
            day = TODAY - timedelta(days=rng.randint(1, max_age))
            status, at, on = "done", f"'{day}T17:00:00Z'", f"'{day}'"
        tasks.append(
            f"('{tid}','Bench tarea {i}',{project},'{status}','a{i:05d}',{at},{on},'{CREATED}')"
        )
        for pos in range(items_for()):
            items.append(f"('{uid()}','{tid}','Paso {pos}',{rng.randint(0, 1)},{pos})")

    # D1 limita el tamaño de cada sentencia
    for i in range(0, len(tasks), 200):
        out.append(
            "INSERT INTO tasks (id, title, project_id, status, rank, completed_at, completed_on, "
            "created_at) VALUES " + ",".join(tasks[i:i + 200]) + ";"
        )
    for i in range(0, len(items), 300):
        out.append(
            "INSERT INTO checklist_items (id, task_id, text, done, position) VALUES "
            + ",".join(items[i:i + 300]) + ";"
        )
    open(path, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
    print(f"{profile}: proyectos {n_projects}, abiertas {n_open}, hechas {n_done}, "
          f"items {len(items)}, sentencias {len(out)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
