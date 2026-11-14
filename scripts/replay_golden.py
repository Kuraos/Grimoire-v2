"""Reproduce los goldens de tareas, pomodoro y diario de la v1 contra la API de la v2 (`wrangler dev`).

Uso, con `wrangler dev --persist-to <dir>` corriendo y la migración aplicada en ese mismo dir:
    python scripts/replay_golden.py <url> <persist-dir>

Traduce alias a UUID y genera lo que la v1 no tenía (`rank`, ids, concesiones). Cada paso se
compara con la v1; lo que difiere a propósito está en DIFS, con su fila de «Diferencias
permitidas» (docs/tasks/caracterizacion-v1.md), y se imprime. Cualquier otra diferencia hace
fallar el script. Cada escritura se repite una vez para comprobar la idempotencia.

Solo para la base local: entre escenarios borra diario, hábitos, sesiones, tareas, proyectos y XP.
El token sale de la variable GRIMOIRE_TOKEN o, si no está, de `.dev.vars`.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKER = ROOT / "api/crates/worker"
GOLDEN = [ROOT / "api/crates/domain/tests/golden" / d for d in ("tasks", "pomodoro", "diary")]
USER_ID = "00000000-0000-7000-8000-000000000001"
NOWHERE = "00000000-0000-7000-8000-0000000000ff"  # el id 999 de los goldens

# (escenario, paso) → qué hace la v2 en vez de lo que grabó la v1.
#   status: status esperado; se omite el cuerpo. fila: cita. xp: `GET /user` tras divergir.
#   skip: la ruta no existe en la v2.
DIFS = {
    ("crear_y_validar", 9): {"status": 422, "fila": 17},
    ("crear_y_validar", 17): {"skip": True, "fila": 21},
    ("crear_y_validar", 22): {"status": 204, "fila": 15},
    ("kanban_estado", 4): {"status": 422, "fila": 12},
    ("kanban_estado", 6): {"status": 422, "fila": 12},
    ("kanban_estado", 9): {"status": 409, "fila": 12},
    ("kanban_estado", 10): {"status": 409, "fila": 16},
    ("kanban_estado", 11): {"xp": 15, "fila": 12},
    ("kanban_estado", 12): {"status": 422, "fila": 13},
    ("kanban_estado", 13): {"status": 422, "fila": 13},
    ("kanban_estado", 14): {"status": 422, "fila": 13},
    ("kanban_estado", 15): {"skip": True, "fila": 13},
    ("checklist", 5): {"status": 422, "fila": 18},
    ("checklist", 7): {"skip": True, "fila": 19},
    ("checklist", 10): {"status": 422, "fila": 19},
    ("checklist", 12): {"skip": True, "fila": 19},
    ("checklist", 14): {"status": 204, "fila": 15},
    ("checklist", 15): {"status": 201, "fila": 18},  # position 3: el ítem vacío no existe
    ("checklist", 16): {"skip": True, "fila": 19},
    ("checklist", 24): {"skip": True, "fila": 19},
    ("proyectos", 14): {"status": 204, "fila": 15},
    ("logro_por_patch", 3): {"status": 422, "fila": 12},
    ("logro_por_patch", 5): {"unlocked": None, "fila": 12},
    ("logro_por_patch", 6): {"achievements": [], "fila": 12},
    # pomodoro
    ("validacion_sesion", 0): {"status": 422, "fila": 28},
    ("validacion_sesion", 1): {"status": 422, "fila": 28},
    ("validacion_sesion", 2): {"status": 422, "fila": 28},
    ("validacion_sesion", 3): {"status": 422, "fila": 28},
    ("validacion_sesion", 8): {"fila": 28},  # las cuatro sesiones no existen
    ("validacion_sesion", 9): {"xp": 0, "fila": 28},
    ("rango_dias", 6): {"skip": True, "fila": 33},
    ("rango_dias", 7): {"skip": True, "fila": 33},
    ("rango_dias", 8): {"skip": True, "fila": 33},
    ("rango_dias", 9): {"skip": True, "fila": 33},
    # diario
    ("solo_espacios", 32): {"achievements": [], "fila": 35},
    ("etiquetas_y_validacion", 12): {"fila": 40},  # PATCH: la v2 lo manda como PUT
    ("resumen_dia", 8): {"skip": True, "gap": -5, "fila": 36},  # sin check-ins ni sus 5 XP
    # fila 43: la marca de ayer se registra hoy (ventana de gracia), y su XP cuenta hoy
    ("resumen_dia", 10): {"xp_earned": 90 - 5 + 20, "fila": 43},
    ("resumen_dia", 11): {"xp_earned": 0, "fila": 43},
}
# Escenarios que dependen de «hoy» de verdad: la ventana de gracia de las marcas (ADR 0005) y el
# reloj del servidor. Sus fechas se trasladan para que el día central sea hoy.
SHIFTED = {"resumen_dia": "2026-03-03"}
TASK_FIELDS = ("title", "description", "category", "priority", "due_date", "xp_reward", "status",
               "completed", "tags")
PROJECT_FIELDS = ("name", "description", "status", "color", "category", "tasks_total", "tasks_pending")
XP_FIELDS = ("new_xp", "new_level", "title", "leveled_up")


class Replay:
    def __init__(self, url, persist, token):
        self.url, self.persist, self.token = url, persist, token

    def reset(self):
        self.sql("DELETE FROM diary_entries; DELETE FROM diary_conflicts; DELETE FROM habit_logs; "
                 "DELETE FROM habits; DELETE FROM pomodoro_sessions; DELETE FROM checklist_items; "
                 "DELETE FROM tasks; DELETE FROM projects; DELETE FROM xp_log; UPDATE users SET xp = 0; "
                 "UPDATE achievements SET unlocked_at = NULL")

    def sql(self, sql):
        subprocess.run(
            f'npx wrangler d1 execute grimoire --local --persist-to "{self.persist}" --command "{sql}"',
            cwd=WORKER, shell=True, check=True, capture_output=True,
        )

    def call(self, method, path, body=None):
        req = urllib.request.Request(
            self.url + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req) as r:
                raw, status = r.read(), r.status
        except urllib.error.HTTPError as e:
            raw, status = e.read(), e.code
        return status, json.loads(raw) if raw else None


class Scenario:
    def __init__(self, api, name, module):
        self.api, self.name, self.module = api, name, module
        self.entries = {}  # día → {"id", "save_id", "content"} de la v2
        self.shift = {}
        self.ids, self.by_v1, self.grants = {}, {}, {}
        self.diffs, self.retries, self.gap = [], 0, 0
        self.unlocked = set()
        self.rank = 0
        self.position_order = []
        self.sessions = 0  # último id que la v1 asignó a una sesión
        self.deleted = set()

    def fail(self, i, step, what):
        sys.exit(f"{self.name}, paso {i} ({step['llamada']}): {what}")

    def uid(self, alias):
        return self.ids.get(alias)

    def translate_path(self, path):
        path = path.replace("/999", f"/{NOWHERE}")
        for alias, value in self.ids.items():
            path = path.replace("{%s}" % alias, value)
        return path

    def next_rank(self):
        self.rank += 1
        return f"a{self.rank:05d}"

    def translate_body(self, step):
        body = dict(step.get("cuerpo") or {})
        body.pop("vault_note_path", None)  # decisión 4: la API no lo recibe
        for key in ("project_id",):
            v = body.get(key)
            if v == 999:
                body[key] = NOWHERE
            elif isinstance(v, str) and v.startswith("{"):
                body[key] = self.ids[v[1:-1]]
        if body.get("remind_at"):  # la v1 guarda hora de pared en Bogotá (UTC−5)
            at = datetime.fromisoformat(body["remind_at"]) + timedelta(hours=5)
            body["remind_at"] = at.isoformat() + "Z"
        if "position" in body and "/checklist/" not in step["llamada"]:  # fila 14
            body["rank"] = f"b{body.pop('position')}"
        return body

    def check_task(self, i, step, want, got):
        for f in TASK_FIELDS:
            if want[f] != got[f]:
                self.fail(i, step, f"{f}: v1 {want[f]!r} frente a v2 {got[f]!r}")
        if (want["completed_at"] is None) != (got["completed_at"] is None):
            self.fail(i, step, "completed_at")
        project = self.by_v1.get(("project", want["project_id"]))
        if want["project_id"] is not None and project != got["project_id"]:
            self.fail(i, step, f"project_id: {got['project_id']}")
        if (want["remind_at"] is None) != (got["remind_at"] is None):
            self.fail(i, step, "remind_at")
        # fila 18: los ítems vacíos de la v1 no existen en la v2
        items = [x for x in want["checklist"] if x["text"]]
        if len(items) != got["checklist_total"] or \
                sum(x["done"] for x in items) != got["checklist_done"]:
            self.fail(i, step, f"conteos de checklist: {got['checklist_total']}")
        if sorted((x["text"], x["done"]) for x in items) != \
                sorted((x["text"], x["done"]) for x in got["checklist"]):
            self.fail(i, step, "ítems de la checklist")

    def check_list(self, i, step, path, want, got):
        by_id = {t["id"]: t for t in got}
        expected = set()
        for w in want:
            uid = self.by_v1.get(("task", w["id"]))
            if uid is None:
                continue  # rechazada al crear (filas 13 y 17)
            expected.add(uid)
            if uid not in by_id:
                self.fail(i, step, f"falta la tarea {w['title']}")
            self.check_task(i, step, w, by_id[uid])
        if "?" not in path and expected != set(by_id):
            self.fail(i, step, "tareas de más en la lista")
        ranks = [t["rank"] for t in got]
        if ranks != sorted(ranks):
            self.fail(i, step, "la lista no viene en orden de rank")

    def check_xp(self, i, step, want, got):
        for f in XP_FIELDS:
            w = want[f] + self.gap if f == "new_xp" else want[f]
            if w != got[f]:
                self.fail(i, step, f"{f}: v1 {w!r} frente a v2 {got[f]!r}")

    def retry(self, i, step, method, path, body, got):
        """La cola puede repetir cualquier escritura: mismo efecto y sin XP nuevo."""
        status, again = self.api.call(method, path, body)
        self.retries += 1
        if method == "DELETE":
            ok = status == 204
        elif method == "POST" and path.endswith(("/complete", "/uncomplete")):
            ok = status == 200 and again["xp_earned"] == 0 and again["new_xp"] == got["new_xp"]
        elif method == "POST":
            ok = status == 200 and again["id"] == got["id"]
        else:
            ok = status == 200 and again == got
        if not ok:
            self.fail(i, step, f"reintento: {status} {again}")

    def step(self, i, step):
        for old, new in self.shift.items():
            step = json.loads(json.dumps(step).replace(old, new))
        dif = DIFS.get((self.name, i), {})
        if dif:
            self.diffs.append((i, step["llamada"], dif["fila"]))
        self.gap += dif.get("gap", 0)
        if dif.get("skip"):
            return
        method, path = step["llamada"].split(" ", 1)
        if path.startswith("/pomodoro/"):
            return self.pomodoro(i, step, method, path, dif)
        if self.module == "diary" and path not in ("/user", "/achievements"):
            return self.diary(i, step, method, path, dif)
        want_status = step["esperado"]["status"]
        want = step["esperado"]["cuerpo"]
        alias = step.get("alias")
        path = self.translate_path(path)
        body = self.translate_body(step) if method in ("POST", "PATCH") else None

        if method == "POST" and path in ("/tasks", "/projects"):
            body["id"] = self.ids[alias] = str(uuid.uuid4()) if alias else str(uuid.uuid4())
            if path == "/tasks":
                body["rank"] = self.next_rank()
        elif method == "POST" and path.endswith("/checklist"):
            body["id"] = str(uuid.uuid4())
            if alias:
                self.ids[alias] = body["id"]
        elif method == "POST" and path.endswith("/complete"):
            # sin `local_date`: las fechas de los goldens quedarían fuera de la ventana (fila 23)
            body = {"id": str(uuid.uuid4())}
        elif method == "POST" and path.endswith("/uncomplete"):
            body = {"grant_id": self.grants.get(path.split("/")[2])}
        # fila 16: el rechazo de regla es 409. Fila 15: repetir un DELETE da 204.
        expected = dif.get("status", 409 if want_status == 400 else want_status)
        if method == "DELETE" and want_status == 404:
            expected = 204

        if method == "GET" and path == "/user":
            status, got = self.api.call("GET", path)
            xp = dif.get("xp", want["xp"] + self.gap)
            if status != 200 or got["xp"] != xp or got["level"] != want["level"] \
                    or got["title"] != want["title"]:
                self.fail(i, step, f"usuario: {got}")
            return
        if method == "GET" and path == "/achievements":  # sin ruta aún: lo informado por las respuestas
            expected_set = set(dif.get("achievements", want))
            if self.unlocked != expected_set:
                self.fail(i, step, f"logros: {self.unlocked} frente a {expected_set}")
            return

        # Filtros y orden son del cliente: la v2 los ignora y aquí se compara cada tarea de la v1.
        status, got = self.api.call(method, path.split("?")[0], body)
        if status != expected:
            self.fail(i, step, f"status {status}, esperado {expected}: {got}")
        if status >= 400:
            if want_status != status and "fila" not in dif and want_status not in (400, 404):
                self.fail(i, step, "rechazo inesperado")
            if method == "POST" and path in ("/tasks", "/projects") and alias:
                del self.ids[alias]
            return

        if method == "GET" and path.startswith("/tasks"):
            self.check_list(i, step, path, want, got)
        elif method == "GET" and path == "/projects":
            # la v1 congela el reloj: con `created_at` empatado, el orden es el de inserción
            if len({p["created_at"] for p in want}) < len(want):
                got = sorted(got, key=lambda g: [p["name"] for p in want].index(g["name"]))
            if [p["name"] for p in want] != [p["name"] for p in got]:
                self.fail(i, step, "orden de proyectos")
            for w, g in zip(want, got):
                for f in PROJECT_FIELDS:
                    if w[f] != g[f]:
                        self.fail(i, step, f"{f}: {w[f]!r} frente a {g[f]!r}")
                # fila 31: minutos enteros; `round` de Python reproduce el float de la v1
                if round(g["pomodoro_minutes"] / 60, 1) != w["pomodoro_hours"]:
                    self.fail(i, step, f"pomodoro_minutes {g['pomodoro_minutes']}")
        elif path.endswith("/complete"):
            self.grants[path.split("/")[2]] = body["id"]
            self.check_xp(i, step, want, got)
            new = [a["key"] for a in got["achievements_unlocked"]]
            first = new[0] if new else None
            w = dif["unlocked"] if "unlocked" in dif else want["achievement_unlocked"]
            if first != w:  # fila 4: la v1 solo informa el primero
                self.fail(i, step, f"logro {first} frente a {w}")
            self.unlocked.update(new)
        elif path.endswith("/uncomplete"):
            if want["xp_earned"] != got["xp_earned"]:
                if got["xp_earned"] <= want["xp_earned"]:
                    self.fail(i, step, f"xp_earned {got['xp_earned']}")
                self.gap += got["xp_earned"] - want["xp_earned"]  # fila 11
                self.diffs.append((i, step["llamada"], 11))
            self.check_xp(i, step, want, got)
        elif path.endswith("/checklist") or "/checklist/" in path:
            if method != "DELETE":
                if want["text"] != got["text"] or want["done"] != got["done"]:
                    self.fail(i, step, f"ítem: {got}")
                if not dif and want["position"] != got["position"]:
                    self.fail(i, step, f"position {got['position']}")
                if dif:
                    assert got["position"] == 3, got
        elif path.startswith("/tasks") and method != "DELETE":
            self.check_task(i, step, want, got)
            self.by_v1[("task", want["id"])] = got["id"]
        elif path.startswith("/projects") and method != "DELETE":
            for f in PROJECT_FIELDS:
                if want[f] != got[f]:
                    self.fail(i, step, f"{f}: {want[f]!r} frente a {got[f]!r}")
            self.by_v1[("project", want["id"])] = got["id"]

        if method == "DELETE":
            self.deleted.add(path.split("/")[2])
        if method != "GET":
            self.retry(i, step, method, path, body, got)

    # ---------- pomodoro ----------

    def ref(self, kind, v1_id):
        """Lo que la v2 guarda para una referencia de la v1: NULL si no existe (filas 29 y 30)."""
        uid = self.by_v1.get((kind, v1_id))
        return None if uid is None or uid in self.deleted else uid

    def session_body(self, step):
        body = dict(step.get("cuerpo") or {})
        for key in ("task_id", "project_id"):
            v = body.get(key)
            if v == 999:
                body[key] = NOWHERE
            elif isinstance(v, str) and v.startswith("{"):
                body[key] = self.ids[v[1:-1]]
        # la v1 sella `finished_at` con la hora del servidor; la v2 recibe `ends_at` (fila 25). Nunca
        # en el futuro: un escenario trasladado a hoy puede correr antes del mediodía.
        end = min(utc(step["hoy"] + "T12:00:00"),
                  datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=1))
        body["id"] = str(uuid.uuid4())
        body["finished_at"] = rfc3339(end)
        minutes = body.get("work_minutes", 25)
        start = body.get("started_at")
        if start is None:  # la v1 lo deducía: fin − minutos
            body["started_at"] = rfc3339(end - timedelta(minutes=minutes if isinstance(minutes, int) else 25))
        else:
            try:
                body["started_at"] = rfc3339(utc(start))
            except ValueError:
                pass  # «ayer»: que lo rechace la API
        return body

    def pomodoro(self, i, step, method, path, dif):
        want_status, want = step["esperado"]["status"], step["esperado"]["cuerpo"]
        if method == "GET" and path == "/pomodoro/today":
            status, got = self.api.call("GET", f"{path}?date={step['hoy']}")
            if status != 200:
                self.fail(i, step, f"status {status}")
            self.check_sessions(i, step, want, got)
            return
        body = self.session_body(step)
        expected = dif.get("status", want_status)
        status, got = self.api.call("POST", path, body)
        if status != expected:
            self.fail(i, step, f"status {status}, esperado {expected}: {got}")
        if want_status == 200:
            self.sessions += 1
        if status != 200:
            return
        self.by_v1[("session", self.sessions)] = body["id"]
        self.check_xp(i, step, want, got)
        if got["total_today_minutes"] != want["total_today_minutes"]:
            self.fail(i, step, f"total_today_minutes {got['total_today_minutes']}")
        new = [a["key"] for a in got["achievements_unlocked"]]
        if (new[0] if new else None) != want["achievement_unlocked"]:  # fila 4
            self.fail(i, step, f"logro {new} frente a {want['achievement_unlocked']}")
        self.unlocked.update(new)
        status, again = self.api.call("POST", path, body)
        self.retries += 1
        if status != 200 or again["xp_earned"] != 0 or again["new_xp"] != got["new_xp"] \
                or again["total_today_minutes"] != got["total_today_minutes"] \
                or again["achievements_unlocked"]:
            self.fail(i, step, f"reintento: {status} {again}")

    def check_sessions(self, i, step, want, got):
        want = [w for w in want if ("session", w["id"]) in self.by_v1]  # fila 28: rechazadas
        if sorted(self.by_v1[("session", w["id"])] for w in want) != sorted(g["id"] for g in got):
            self.fail(i, step, f"sesiones: {got}")
        starts = [g["started_at"] for g in got]
        if starts != sorted(starts, reverse=True):
            self.fail(i, step, "orden por started_at")
        by_id = {g["id"]: g for g in got}
        for w in want:
            g = by_id[self.by_v1[("session", w["id"])]]
            for f in ("work_minutes", "completed", "task_title"):
                if w[f] != g[f]:
                    self.fail(i, step, f"{f}: v1 {w[f]!r} frente a v2 {g[f]!r}")
            for f in ("started_at", "finished_at"):
                if utc(w[f]) != utc(g[f]):
                    self.fail(i, step, f"{f}: v1 {w[f]} frente a v2 {g[f]}")
            for f, kind in (("task_id", "task"), ("project_id", "project")):
                expected = self.ref(kind, w[f])
                if expected != g[f]:
                    self.fail(i, step, f"{f}: {g[f]} frente a {expected}")
                if w[f] is not None and expected is None:
                    fila = 29 if w[f] == 999 else 30
                    if (i, step["llamada"], fila) not in self.diffs:
                        self.diffs.append((i, step["llamada"], fila))


    # ---------- diario ----------

    def diary(self, i, step, method, path, dif):
        want_status, want = step["esperado"]["status"], step["esperado"]["cuerpo"]
        hoy = step["hoy"]
        if method == "POST" and path == "/habits":
            body = {**step["cuerpo"], "id": str(uuid.uuid4())}
            status, got = self.api.call("POST", path, body)
            if status != 201:
                self.fail(i, step, f"status {status}: {got}")
            self.ids[step["alias"]] = body["id"]
            # una marca no puede ser anterior al hábito (ADR 0005): nace el día del escenario
            self.api.sql(f"UPDATE habits SET created_at = '{hoy}T05:00:00Z' WHERE id = '{body['id']}'")
            return
        if method == "POST" and path.endswith("/complete"):
            status, got = self.api.call("POST", self.translate_path(path),
                                        {"id": str(uuid.uuid4()), "local_date": hoy})
            if status != 200 or got["xp_earned"] != want["xp_earned"]:
                self.fail(i, step, f"marca: {status} {got}")
            self.check_xp(i, step, want, got)
            self.unlocked.update(a["key"] for a in got["achievements_unlocked"])
            return

        rest = path[len("/diary/"):]
        if method in ("PUT", "PATCH"):
            return self.diary_save(i, step, rest, want_status, want)
        if rest in ("dates", "volume"):
            status, got = self.api.call("GET", f"/diary/volume?today={hoy}")
            if status != 200:
                self.fail(i, step, f"status {status}")
            start = volume_start(date.fromisoformat(hoy)).isoformat()
            points = [(p["entry_date"], p["length"]) if rest == "volume" else (p, None) for p in want]
            # fila 35: sin las de solo espacios; fila 37: `dates` sale del volumen, de 12 meses
            expected = sorted((d, n) for d, n in points
                              if written(self.entries[d]["content"]) and d >= start)
            got = [(p["local_date"], p["length"] if rest == "volume" else None) for p in got["points"]]
            if got != expected:
                self.fail(i, step, f"volumen {got} frente a {expected}")
            if rest == "dates":
                self.diffs.append((i, step["llamada"], 37))
            elif len(expected) < len(want):
                self.diffs.append((i, step["llamada"], 35))
            return
        if rest.startswith("search"):
            status, got = self.api.call("GET", path)
            # fila 38: fragmento en vez del texto; estos textos caben enteros
            expected = [(w["entry_date"], w["content"].strip()) for w in want if written(w["content"])]
            got = [(h["local_date"], h["snippet"]) for h in got]
            if status != 200 or got != expected:
                self.fail(i, step, f"búsqueda {got} frente a {expected}")
            self.diffs.append((i, step["llamada"], 38))
            return
        day = rest.split("/")[0]
        status, got = self.api.call("GET", f"/diary/{day}")
        if status != 200:
            self.fail(i, step, f"status {status}")
        if rest.endswith("/summary"):  # decisión 7: viene con la entrada
            s = got["summary"]
            # sin orden: aquí las sesiones terminan en el mismo segundo (`session_body`)
            sessions = sorted((x["work_minutes"], x["task_title"] or "") for x in s["pomodoro_sessions"])
            if s["habits_done"] != want["habits_done"] \
                    or sessions != sorted((x["work_minutes"], x["task_title"] or "")
                                          for x in want["pomodoro_sessions"]) \
                    or s["pomodoro_minutes"] != want["pomodoro_minutes"] \
                    or s["xp_earned"] != dif.get("xp_earned", want["xp_earned"]):
                self.fail(i, step, f"resumen {s}")
            if want["checkin"] is not None:
                self.diffs.append((i, step["llamada"], 36))
            return
        e = got["entry"]
        if (e["id"] is None) != (want["id"] is None) or e["content"] != want["content"] \
                or e["tags"] != want["tags"] or e["local_date"] != want["entry_date"] or got["conflicts"]:
            self.fail(i, step, f"entrada {got}")

    def diary_save(self, i, step, day, want_status, want):
        src = step.get("cuerpo") or {}
        prev = self.entries.get(day)
        body = {"id": prev["id"] if prev else str(uuid.uuid4()), "save_id": str(uuid.uuid4()),
                "base_save_id": prev["save_id"] if prev else None,
                **{k: src[k] for k in ("content", "tags") if k in src}}
        status, got = self.api.call("PUT", f"/diary/{day}", body)
        if status != want_status:
            self.fail(i, step, f"status {status}, esperado {want_status}: {got}")
        if status != 200:
            return
        e = got["entry"]
        if (e["content"], e["tags"], e["local_date"]) != (want["content"], want["tags"], want["entry_date"]) \
                or got["conflicts"] != 0:
            self.fail(i, step, f"entrada {got}")
        self.entries[day] = {"id": e["id"], "save_id": body["save_id"], "content": e["content"]}
        self.unlocked.update(a["key"] for a in got["achievements_unlocked"])
        status, again = self.api.call("PUT", f"/diary/{day}", body)
        self.retries += 1
        if status != 200 or again["xp_earned"] != 0 or again["new_xp"] != got["new_xp"] \
                or again["entry"] != e or again["achievements_unlocked"] or again["conflicts"]:
            self.fail(i, step, f"reintento: {status} {again}")


def written(content):
    """`diary::is_written`: texto tras quitar espacios (fila 35)."""
    return bool(content.strip())


def volume_start(today):
    """Primer día del mes de hace 11 meses (`diary::volume_start`)."""
    m = today.year * 12 + today.month - 1 - 11
    return date(m // 12, m % 12 + 1, 1)


def utc(s):
    """Instante de la v1 (hora de pared en Bogotá, sin zona) o de la v2 (RFC 3339) → UTC."""
    t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone(timedelta(hours=-5)))
    return t.astimezone(timezone.utc)


def rfc3339(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def check_window(api):
    """Fila 23: la lista trae abiertas y lo completado en 90 días; lo demás sale paginado."""
    today = (datetime.now(timezone.utc) - timedelta(hours=5)).date()
    api.reset()

    def new(title):
        uid = str(uuid.uuid4())
        status, _ = api.call("POST", "/tasks", {"id": uid, "title": title, "rank": "a0"})
        assert status == 201
        return uid

    def done(title, days_ago):
        uid = new(title)
        day = (today - timedelta(days=days_ago)).isoformat()
        status, _ = api.call("POST", f"/tasks/{uid}/complete", {"id": str(uuid.uuid4()), "local_date": day})
        assert status == 200
        return uid

    opened, edge = new("abierta"), done("borde", 90)
    old = [done(f"vieja {i}", 91 + i % 3) for i in range(51)]
    _, listed = api.call("GET", "/tasks")
    assert {t["id"] for t in listed} == {opened, edge}, "ventana"
    status, page = api.call("GET", "/tasks/history")
    assert status == 200 and len(page["tasks"]) == 50 and page["next_cursor"], "primera página"
    status, rest = api.call("GET", "/tasks/history?cursor=" + page["next_cursor"])
    assert status == 200 and len(rest["tasks"]) == 1 and rest["next_cursor"] is None, "segunda página"
    assert {t["id"] for t in page["tasks"] + rest["tasks"]} == set(old), "sin saltos ni repeticiones"
    assert api.call("GET", "/tasks/history?cursor=basura")[0] == 422
    task = rest["tasks"][0]
    status, _ = api.call("POST", f"/tasks/{task['id']}/uncomplete", {"grant_id": task["grant_id"]})
    assert status == 200, "descompletar desde el historial"
    _, listed = api.call("GET", "/tasks")
    assert task["id"] in {t["id"] for t in listed}, "reabierta vuelve a la lista"
    print("ventana y /tasks/history: OK")


def main():
    url, persist = sys.argv[1].rstrip("/"), sys.argv[2]
    token = os.environ.get("GRIMOIRE_TOKEN") or next(
        line.split("=", 1)[1].strip().strip('"')
        for line in (WORKER / ".dev.vars").read_text().splitlines()
        if line.startswith("GRIMOIRE_TOKEN"))
    api = Replay(url, persist, token)
    for path in [p for d in GOLDEN for p in sorted(d.glob("*.json"))]:
        golden = json.loads(path.read_text(encoding="utf-8"))
        api.reset()
        sc = Scenario(api, golden["escenario"], path.parent.name)
        if sc.name in SHIFTED:
            today = (datetime.now(timezone.utc) - timedelta(hours=5)).date()
            center = date.fromisoformat(SHIFTED[sc.name])
            for k in (-1, 0, 1):
                sc.shift[(center + timedelta(days=k)).isoformat()] = (today + timedelta(days=k)).isoformat()
        for i, step in enumerate(golden["pasos"]):
            sc.step(i, step)
        status, user = api.call("GET", "/user")
        print(f"{sc.name}: {len(golden['pasos'])} pasos, {sc.retries} reintentos, "
              f"{len(sc.diffs)} diferencias permitidas, xp final {user['xp']}")
        for i, call, fila in sc.diffs:
            print(f"  paso {i}: {call} (fila {fila})")
    check_window(api)
    print("OK")


if __name__ == "__main__":
    main()
