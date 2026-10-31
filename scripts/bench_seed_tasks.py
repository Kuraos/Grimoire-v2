"""Seed sintético para medir `GET /tasks` y `GET /projects`. Sin datos reales.

20 proyectos `Bench proyecto …`, 500 tareas `Bench tarea …` (40 % hechas, 80 % con proyecto) y
de 0 a 4 ítems por tarea. Nada otorga XP: solo se mide la lectura.

Uso: python scripts/bench_seed_tasks.py seed_tasks.sql
     npx wrangler d1 execute grimoire --local --file seed_tasks.sql
Limpiar:
     npx wrangler d1 execute grimoire --local --command "DELETE FROM tasks WHERE title LIKE 'Bench tarea %'; DELETE FROM projects WHERE name LIKE 'Bench proyecto %'"
"""
import random
import sys
import uuid

PROJECTS, TASKS = 20, 500
CREATED = "2026-01-01T05:00:00Z"
rng = random.Random(20261031)


def uid() -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


projects = [uid() for _ in range(PROJECTS)]
out = [
    "INSERT INTO projects (id, name, created_at) VALUES "
    + ",".join(f"('{p}','Bench proyecto {i}','{CREATED}')" for i, p in enumerate(projects))
    + ";"
]
tasks, items = [], []
for i in range(TASKS):
    tid = uid()
    done = rng.random() < 0.4
    project = f"'{rng.choice(projects)}'" if rng.random() < 0.8 else "NULL"
    status = "done" if done else rng.choice(["todo", "doing"])
    completed = f"'{CREATED}'" if done else "NULL"
    tasks.append(
        f"('{tid}','Bench tarea {i}',{project},'{status}','a{i:05d}',{completed},'{CREATED}')"
    )
    for pos in range(rng.randint(0, 4)):
        items.append(f"('{uid()}','{tid}','Paso {pos}',{rng.randint(0, 1)},{pos})")

# D1 limita el tamaño de cada sentencia
for i in range(0, len(tasks), 200):
    out.append(
        "INSERT INTO tasks (id, title, project_id, status, rank, completed_at, created_at) VALUES "
        + ",".join(tasks[i:i + 200]) + ";"
    )
for i in range(0, len(items), 300):
    out.append(
        "INSERT INTO checklist_items (id, task_id, text, done, position) VALUES "
        + ",".join(items[i:i + 300]) + ";"
    )
open(sys.argv[1], "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
print(f"proyectos: {PROJECTS}  tareas: {TASKS}  ítems: {len(items)}  sentencias: {len(out)}")
