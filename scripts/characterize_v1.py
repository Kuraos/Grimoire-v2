"""Graba las respuestas de la v1 a escenarios fijos (docs/tasks/caracterizacion-v1.md).

Uso, con el intérprete del entorno de la v1:
    <v1>/backend/.venv/Scripts/python.exe -I scripts/characterize_v1.py <v1>/backend

Cada escenario corre en su propio subproceso (mismo intérprete, -I) con una base
temporal nueva vía GRIMOIRE_DB: `database.py` crea el engine al importar, así que
dos escenarios en el mismo proceso compartirían base. El padre solo recoge el JSON
que imprime cada hijo y escribe api/crates/domain/tests/golden/<modulo>/<escenario>.json.

Reloj: se sustituye `tz.datetime` por una subclase con `now()` congelado. Todos los
`from tz import now as _now` de la v1 son el mismo objeto `tz.now`, que busca
`datetime` en `tz` en cada llamada, así que un solo parche cubre los alias y los
`default=_now` de SQLAlchemy en models.py. El hijo verifica ambas cosas.
"""
import json
import os
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

ZONE = "America/Bogota"
HOUR = "12:00:00"  # hora de pared en ZONE de todas las llamadas
# Sin GRIMOIRE_TZ: el reloj congelado ya es la hora de pared en ZONE, y en Windows
# ZoneInfo("America/Bogota") exige `tzdata`, que el .venv de la v1 no tiene.
REPO = Path(__file__).resolve().parent.parent
GOLDEN_ROOT = REPO / "api/crates/domain/tests/golden"


# ---------- escenarios ----------
# Un paso: {"hoy", "llamada": "MÉTODO /ruta", "cuerpo"?, "alias"?}. Las rutas usan
# `{alias}` para referirse a un hábito creado antes con ese alias.

def _d(s: str) -> date:
    return date.fromisoformat(s)


def _days(start: str, n: int) -> list[str]:
    return [(_d(start) + timedelta(days=i)).isoformat() for i in range(n)]


def step(hoy, llamada, cuerpo=None, alias=None):
    s = {"hoy": hoy, "llamada": llamada}
    if cuerpo is not None:
        s["cuerpo"] = cuerpo
    if alias is not None:
        s["alias"] = alias
    return s


def habit(hoy, alias, **kw):
    return step(hoy, "POST /habits", {"name": alias.capitalize(), "category": "Otro", **kw}, alias)


def diario_simple():
    """Diario, 10 días seguidos desde el lunes 2026-03-02, xp_reward 100: XP por marca
    con multiplicador desde el día 7, nivel y título. Segunda marca del mismo día → 400."""
    days = _days("2026-03-02", 10)
    s = [habit(days[0], "lectura", xp_reward=100)]
    for i, d in enumerate(days):
        s.append(step(d, "POST /habits/{lectura}/complete"))
        if i == 0:
            s.append(step(d, "POST /habits/{lectura}/complete"))
    s += [step(days[-1], "GET /habits/{lectura}"), step(days[-1], "GET /user")]
    return s


# En la v1 el día en que corre evaluate-streaks nunca se evalúa (guarda
# last_streak_eval = hoy y la siguiente empieza en last_streak_eval + 1; ver
# «Hallazgos» en caracterizacion-v1.md). Por eso los escenarios de vidas evalúan solo
# en ciertos días: los que deben contar son días sin evaluación.

def _marks(plan: dict[str, list[str]]) -> list[dict]:
    """día → hábitos marcados ese día; "eval" en la lista evalúa antes de marcar."""
    s = []
    for d, items in plan.items():
        for h in items:
            s.append(step(d, "POST /user/evaluate-streaks") if h == "eval"
                     else step(d, "POST /habits/{%s}/complete" % h))
    return s


def diario_lv():
    """Diario L–V creado el lunes 2026-03-02: semana completa, fin de semana sin marcar,
    lunes siguiente. Se evalúa el lunes 2, el domingo 8 (cubre L–S: el sábado no toca y
    no cuesta vida) y el martes 10 (cubre el lunes 9, cuya ocasión anterior es el viernes)."""
    s = [habit("2026-03-02", "ingles", days="0,1,2,3,4")]
    for d in _days("2026-03-02", 9):  # lunes 2 → martes 10
        if d in ("2026-03-02", "2026-03-08", "2026-03-10"):
            s.append(step(d, "POST /user/evaluate-streaks"))
        s.append(step(d, "GET /habits/{ingles}"))
        if _d(d).weekday() < 5:
            s.append(step(d, "POST /habits/{ingles}/complete"))
    s.append(step("2026-03-10", "GET /user"))
    return s


def racha_rota():
    """Un hábito: marca, salto de un día, evaluación al día siguiente → vida perdida.
    Repetido hasta 0 vidas; el siguiente día roto cuesta 15 XP. Con la v1 los días
    marcados son días de evaluación y no se evalúan, así que no devuelven la vida.
    Al final, evaluaciones en días seguidos: el día roto entre ellas (03-11) no se cobra."""
    s = [habit("2026-03-02", "lectura", xp_reward=50)]
    s += _marks({
        "2026-03-02": ["eval", "lectura"],
        "2026-03-04": ["eval", "lectura"],  # 03-03 roto → 2
        "2026-03-06": ["eval", "lectura"],  # 03-05 roto → 1
        "2026-03-08": ["eval", "lectura"],  # 03-07 roto → 0
        "2026-03-10": ["eval", "lectura"],  # 03-09 roto → −15 XP
    })
    s.append(step("2026-03-10", "GET /habits/{lectura}"))
    s.append(step("2026-03-10", "GET /user"))
    s += _marks({"2026-03-11": ["eval"], "2026-03-12": ["eval"], "2026-03-13": ["eval"]})
    s.append(step("2026-03-13", "GET /user"))
    return s


def dia_perfecto():
    """Dos hábitos. Cada día con uno solo marcado (y el otro marcado el día anterior)
    cuesta una vida; cada día con ambos la devuelve, hasta MAX_LIVES (3) y no más.
    Se evalúa el 5, el 8 y el 10; los días 5 y 8, por ser de evaluación, no cuentan."""
    s = [habit("2026-03-02", "lectura"), habit("2026-03-02", "agua")]
    s += _marks({
        "2026-03-02": ["lectura", "agua"],
        "2026-03-03": ["lectura"],          # agua roto
        "2026-03-04": ["agua"],             # lectura roto
        "2026-03-05": ["eval", "lectura", "agua"],  # → 1 vida
        "2026-03-06": ["lectura", "agua"],
        "2026-03-07": ["lectura", "agua"],
        "2026-03-08": ["eval", "lectura", "agua"],  # 06 y 07 perfectos → 3
        "2026-03-09": ["lectura", "agua"],
        "2026-03-10": ["eval"],             # 09 perfecto, ya en el máximo
    })
    s.append(step("2026-03-10", "GET /user"))
    return s


def semanal_2x():
    """Semanal 2×/semana desde el lunes 2026-03-02. Semana 1 incompleta (1 marca),
    semanas 2–7 completas (lunes y jueves), tercera marca rechazada en la semana 2, y
    semana 8 con la racha en 6 semanas: la primera marca, que no cierra la semana,
    ya paga con racha 7 (multiplicador 1.10)."""
    s = [habit("2026-03-02", "gimnasio", frequency="weekly", target_per_week=2),
         step("2026-03-04", "POST /habits/{gimnasio}/complete"),
         step("2026-03-04", "GET /habits/{gimnasio}")]
    for w in range(1, 7):
        mon = _d("2026-03-02") + timedelta(weeks=w)
        for d in (mon, mon + timedelta(days=3)):
            s.append(step(d.isoformat(), "POST /habits/{gimnasio}/complete"))
        if w == 1:
            s.append(step((mon + timedelta(days=4)).isoformat(), "POST /habits/{gimnasio}/complete"))
            s.append(step((mon + timedelta(days=4)).isoformat(), "GET /habits/{gimnasio}"))
    s += [
        step("2026-04-20", "GET /habits/{gimnasio}"),
        step("2026-04-20", "POST /habits/{gimnasio}/complete"),
        step("2026-04-20", "GET /habits/{gimnasio}"),
        step("2026-04-23", "POST /habits/{gimnasio}/complete"),
        step("2026-04-23", "GET /habits/{gimnasio}"),
    ]
    return s


def deshacer():
    """DELETE /habits/{id}/complete. Piso en 0: dos hábitos de 10 XP marcados en días
    alternos del 02 al 15 sin evaluar; el 16 se marca uno y la primera evaluación cobra
    13 días rotos (3 vidas + 10 × 15 XP), dejando menos XP que lo que devuelve el
    deshacer. Después, un hábito de 100 XP: deshacer devuelve el XP de la marca de hoy,
    sin marca hoy → 400, y deshacer a 400 XP baja de nivel."""
    s = [habit("2026-03-02", "lectura", xp_reward=10), habit("2026-03-02", "agua", xp_reward=10)]
    s += _marks({d: ["lectura" if i % 2 == 0 else "agua"] for i, d in enumerate(_days("2026-03-02", 14))})
    s += [
        step("2026-03-16", "GET /user"),
        step("2026-03-16", "POST /habits/{lectura}/complete"),
        step("2026-03-16", "POST /user/evaluate-streaks"),
        step("2026-03-16", "DELETE /habits/{lectura}/complete"),
        step("2026-03-16", "GET /habits/{lectura}"),
        step("2026-03-16", "GET /user"),
        habit("2026-03-17", "estudio", xp_reward=100),
        step("2026-03-17", "POST /habits/{estudio}/complete"),
        step("2026-03-17", "DELETE /habits/{estudio}/complete"),
        step("2026-03-17", "DELETE /habits/{estudio}/complete"),
    ]
    s += _marks({d: ["estudio"] for d in _days("2026-03-17", 4)})  # 400 XP → nivel 2
    s += [
        step("2026-03-20", "DELETE /habits/{estudio}/complete"),
        step("2026-03-20", "GET /habits/{estudio}"),
        step("2026-03-20", "GET /user"),
    ]
    return s


def logros():
    """Logros que dispara marcar hábitos: first_blood (1.ª marca), iron_constancy y
    total_discipline (día 7, la respuesta solo informa uno), ascension (nivel 5),
    iron_month (racha 30) y polymath (4 categorías activas)."""
    days = _days("2026-03-02", 30)
    s = [habit(days[0], "lectura", xp_reward=100), step(days[0], "GET /achievements")]
    for i, d in enumerate(days):
        s.append(step(d, "POST /habits/{lectura}/complete"))
        if i + 1 in (1, 7, 30):
            s.append(step(d, "GET /achievements"))
    d = "2026-04-01"
    s += [
        step(d, "POST /habits", {"name": "Correr", "category": "Físico"}, "correr"),
        step(d, "POST /habits", {"name": "Alemán", "category": "Idioma"}, "aleman"),
        step(d, "POST /habits", {"name": "Derivadas", "category": "Académico"}, "derivadas"),
        step(d, "POST /habits/{correr}/complete"),
        step(d, "GET /achievements"),
        step(d, "GET /user"),
    ]
    return s


# ---------- tareas ----------
# Un id de tarea, proyecto o ítem se guarda con su alias, como los de hábitos.

def task(hoy, alias, **kw):
    return step(hoy, "POST /tasks", {"title": alias.capitalize(), **kw}, alias)


def project(hoy, alias, **kw):
    return step(hoy, "POST /projects", {"name": alias.capitalize(), **kw}, alias)


def crear_y_validar():
    """Crear con valores por defecto y con todos los campos; rechazos de validación;
    filtros y orden de la lista; etiquetas como texto; editar con null; borrar. El filtro
    `tag` es una subcadena sin distinguir mayúsculas: `a` también trae `casa`."""
    d = "2026-03-02"
    return [
        task(d, "minima"),
        project(d, "tesis"),
        task(d, "completa", description="Detalle", category="Académico", priority="high",
             project_id="{tesis}", due_date="2026-03-10", xp_reward=50, status="doing",
             remind_at="2026-03-09T08:30:00", tags="casa, Urgente", vault_note_path="Notas/t.md"),
        task(d, "baja", priority="low", due_date="2026-03-05", xp_reward=5, tags="a"),
        step(d, "POST /tasks", {"title": ""}),
        step(d, "POST /tasks", {"title": "X", "priority": "urgente"}),
        step(d, "POST /tasks", {"title": "X", "status": "inventado"}),
        step(d, "POST /tasks", {"title": "X", "xp_reward": 4}),
        step(d, "POST /tasks", {"title": "X", "xp_reward": 51}),
        step(d, "POST /tasks", {"title": "Sin proyecto real", "project_id": 999}, "huerfana"),
        step(d, "GET /tasks"),
        step(d, "GET /tasks?sort=due_date"),
        step(d, "GET /tasks?completed=false&priority=high"),
        step(d, "GET /tasks?project_id={tesis}"),
        step(d, "GET /tasks?category=Académico"),
        step(d, "GET /tasks?tag=a"),
        step(d, "GET /tasks?tag=URGENTE"),
        step(d, "GET /tags"),
        step(d, "PATCH /tasks/{completa}", {"tags": None, "remind_at": None, "due_date": None,
                                             "vault_note_path": None, "project_id": None}),
        step(d, "PATCH /tasks/999", {"title": "Nada"}),
        step(d, "PATCH /tasks/{baja}", {"title": ""}),
        step(d, "DELETE /tasks/{baja}"),
        step(d, "DELETE /tasks/{baja}"),
    ]


def completar_xp():
    """Completar concede `xp_reward` y un segundo intento da 400. Ocho tareas de 50 XP
    llegan a 400 XP (nivel 2). Borrar una tarea completada no devuelve su XP."""
    d = "2026-03-02"
    s = [task(d, "t0"), step(d, "POST /tasks/{t0}/complete"), step(d, "POST /tasks/{t0}/complete"),
         step(d, "GET /tasks?completed=true"), step(d, "POST /tasks/999/complete"), step(d, "GET /user")]
    for i in range(1, 9):
        s += [task(d, f"t{i}", xp_reward=50), step(d, "POST /tasks/{t%d}/complete" % i)]
    s += [step(d, "GET /user"), step("2026-03-03", "DELETE /tasks/{t1}"), step("2026-03-03", "GET /user")]
    return s


def descompletar_piso():
    """Descompletar devuelve lo concedido y deja `todo`, aunque viniera de `doing`. La v1
    suma TODAS las concesiones históricas de la tarea: el segundo ciclo devuelve 30 de 15
    concedidos. Sola, esa resta toca el piso en 0. Editar `xp_reward` después de completar
    no cambia lo que se devuelve."""
    d = "2026-03-02"
    return [
        task(d, "nunca"), step(d, "POST /tasks/{nunca}/uncomplete"), step(d, "POST /tasks/999/uncomplete"),
        task(d, "piso", status="doing"),
        step(d, "POST /tasks/{piso}/complete"),
        step(d, "POST /tasks/{piso}/uncomplete"),
        step(d, "GET /tasks"),
        step(d, "POST /tasks/{piso}/complete"),
        step(d, "POST /tasks/{piso}/uncomplete"),
        step(d, "GET /user"),
        task(d, "base", xp_reward=50), step(d, "POST /tasks/{base}/complete"),
        task(d, "ciclo"),
        step(d, "POST /tasks/{ciclo}/complete"),
        step(d, "POST /tasks/{ciclo}/uncomplete"),
        step(d, "POST /tasks/{ciclo}/complete"),
        step(d, "POST /tasks/{ciclo}/uncomplete"),
        step(d, "GET /user"),
        task(d, "edita"),
        step(d, "POST /tasks/{edita}/complete"),
        step(d, "PATCH /tasks/{edita}", {"xp_reward": 50}),
        step(d, "POST /tasks/{edita}/uncomplete"),
        step(d, "GET /user"),
    ]


def kanban_estado():
    """PATCH de `status` sincroniza `completed` sin tocar XP; por eso la v1 llama a
    complete/uncomplete antes al cruzar «hecho». Salir por PATCH conserva el XP, y
    completar otra vez lo concede de nuevo. `completed: true` solo no toca `status`.
    Crear con `status: done` no completa. `position` se guarda, pero la lista no ordena
    por ella: el tablero ordena en el cliente."""
    d = "2026-03-02"
    return [
        task(d, "a"), task(d, "b"), task(d, "c"),
        step(d, "PATCH /tasks/{a}", {"status": "doing"}),
        step(d, "PATCH /tasks/{a}", {"status": "done"}),
        step(d, "GET /user"),
        step("2026-03-03", "PATCH /tasks/{a}", {"status": "done"}),
        step("2026-03-03", "PATCH /tasks/{a}", {"status": "todo"}),
        step("2026-03-03", "POST /tasks/{b}/complete"),
        step("2026-03-03", "PATCH /tasks/{b}", {"status": "doing"}),
        step("2026-03-03", "POST /tasks/{b}/complete"),
        step("2026-03-03", "GET /user"),
        step("2026-03-03", "PATCH /tasks/{c}", {"completed": True}),
        step("2026-03-03", "PATCH /tasks/{c}", {"completed": False, "status": "done"}),
        task("2026-03-03", "nace_hecha", status="done"),
        step("2026-03-03", "POST /tasks/{nace_hecha}/complete"),
        task("2026-03-03", "d1"), task("2026-03-03", "d2"), task("2026-03-03", "d3"),
        step("2026-03-03", "PATCH /tasks/{d3}", {"position": 0}),
        step("2026-03-03", "PATCH /tasks/{d1}", {"position": 1}),
        step("2026-03-03", "PATCH /tasks/{d2}", {"position": 2}),
        step("2026-03-03", "GET /tasks?completed=false"),
    ]


def checklist():
    """Posiciones max + 1 (con huecos al borrar), texto vacío aceptado, listas ordenadas
    por `position`, conteos en la tarea, 404, y que marcarla toda no completa la tarea ni
    tenerla pendiente impide completarla. Borrar la tarea borra sus ítems."""
    d = "2026-03-02"

    def item(alias, text, on="t"):
        return step(d, "POST /tasks/{%s}/checklist" % on, {"text": text}, alias)

    return [
        task(d, "t"), task(d, "otra"),
        item("i1", "Uno"), item("i2", "Dos"), item("i3", "Tres"), item("vacio", ""),
        step(d, "POST /tasks/999/checklist", {"text": "Nada"}),
        step(d, "GET /tasks/999/checklist"),
        step(d, "PATCH /tasks/checklist/{i1}", {"done": True}),
        step(d, "PATCH /tasks/checklist/{i2}", {"text": "Dos bis"}),
        step(d, "PATCH /tasks/checklist/{i3}", {"position": -1}),
        step(d, "PATCH /tasks/checklist/999", {"done": True}),
        step(d, "GET /tasks/{t}/checklist"),
        step(d, "DELETE /tasks/checklist/{i2}"),
        step(d, "DELETE /tasks/checklist/{i2}"),
        item("i4", "Cuatro"),
        step(d, "GET /tasks/{t}/checklist"),
        step(d, "GET /tasks"),
        step(d, "POST /tasks/{t}/complete"),
        item("o1", "Única", "otra"),
        step(d, "PATCH /tasks/checklist/{o1}", {"done": True}),
        step(d, "GET /tasks"),
        step(d, "DELETE /tasks/{t}"),
        step(d, "PATCH /tasks/checklist/{i1}", {"done": False}),
        step(d, "GET /tasks/{t}/checklist"),
    ]


def proyectos():
    """CRUD, contadores, orden por creación descendente y validación. Borrar un proyecto
    deja sus tareas sin proyecto. Un proyecto cerrado sigue aceptando tareas."""
    d = "2026-03-03"
    return [
        project("2026-03-02", "viejo"),
        project(d, "nuevo", description="D", status="paused", color="#7f8fc4",
                category="Académico", vault_note_path="Proyectos/n.md"),
        step(d, "POST /projects", {"name": ""}),
        step(d, "POST /projects", {"name": "X", "status": "inventado"}),
        task(d, "t1", project_id="{viejo}"),
        task(d, "t2", project_id="{viejo}"),
        step(d, "POST /tasks/{t1}/complete"),
        step(d, "GET /projects"),
        step(d, "PATCH /projects/{viejo}", {"status": "closed", "vault_note_path": None}),
        step(d, "PATCH /projects/999", {"name": "Nada"}),
        task(d, "t3", project_id="{viejo}"),
        step(d, "PATCH /tasks/{t3}", {"project_id": "{nuevo}"}),
        step(d, "GET /projects"),
        step(d, "DELETE /projects/{viejo}"),
        step(d, "DELETE /projects/{viejo}"),
        step(d, "GET /tasks"),
        step(d, "GET /projects"),
    ]


def logros_tareas():
    """`task_complete`: un proyecto vacío no cuenta. La tarea 50 (2500 XP) cierra un proyecto:
    desbloquea `ascension` y `project_master`, y la respuesta solo informa el primero.
    Descompletarla no bloquea ninguno, y completarla de nuevo no vuelve a informarlos. La 100
    da `task_centurion`. `first_blood` es de hábitos: las tareas no lo desbloquean."""
    d = "2026-03-02"
    s = [project(d, "vacio"), project(d, "p1"),
         task(d, "a1", project_id="{p1}", xp_reward=50), task(d, "a2", project_id="{p1}", xp_reward=50),
         step(d, "POST /tasks/{a1}/complete"), step(d, "GET /achievements")]
    for i in range(2, 50):
        s += [task(d, f"t{i}", xp_reward=50), step(d, "POST /tasks/{t%d}/complete" % i)]
    s += [step(d, "GET /achievements"), step(d, "POST /tasks/{a2}/complete"),
          step(d, "GET /achievements"), step(d, "GET /user"),
          step(d, "POST /tasks/{a2}/uncomplete"), step(d, "GET /achievements"), step(d, "GET /user"),
          step(d, "POST /tasks/{a2}/complete")]
    for i in range(51, 100):
        s += [task(d, f"t{i}", xp_reward=5), step(d, "POST /tasks/{t%d}/complete" % i)]
    s.append(step(d, "GET /achievements"))
    s += [task(d, "t100", xp_reward=5), step(d, "POST /tasks/{t100}/complete"), step(d, "GET /achievements")]
    return s


def logro_por_patch():
    """Terminar por PATCH cuenta para los logros, pero no los evalúa: el proyecto cerrado
    con `status: done` solo da `project_master` cuando otra tarea cualquiera se completa."""
    d = "2026-03-02"
    return [
        project(d, "p"), task(d, "dentro", project_id="{p}"), task(d, "fuera"),
        step(d, "PATCH /tasks/{dentro}", {"status": "done"}),
        step(d, "GET /achievements"),
        step(d, "POST /tasks/{fuera}/complete"),
        step(d, "GET /achievements"),
    ]


MODULES = {
    "habits": (diario_simple, diario_lv, racha_rota, dia_perfecto, semanal_2x, deshacer, logros),
    "tasks": (crear_y_validar, completar_xp, descompletar_piso, kanban_estado, checklist,
              proyectos, logros_tareas, logro_por_patch),
}
SCENARIOS = {f.__name__: f for fs in MODULES.values() for f in fs}


# ---------- hijo: un escenario, una base, un proceso ----------

def _project(llamada: str, body):
    """La parte relevante de la respuesta. Los logros se reducen a claves: el catálogo
    entero (nombres, iconos) no es comportamiento de hábitos."""
    if llamada == "GET /achievements":
        return sorted(a["key"] for a in body if a["unlocked"])
    if isinstance(body, dict) and body.get("achievement_unlocked"):
        body["achievement_unlocked"] = body["achievement_unlocked"]["key"]
    return body


def run_child(backend: Path, name: str) -> None:
    db_path = Path(os.environ["GRIMOIRE_DB"])
    assert not db_path.exists(), f"la base del escenario ya existe: {db_path}"
    real_stdout, sys.stdout = sys.stdout, sys.stderr  # los print() de la v1 no ensucian el JSON
    sys.path.insert(0, str(backend))

    import tz

    class Frozen(datetime):
        current: datetime  # pared local (naive)

        @classmethod
        def now(cls, tz=None):
            return cls.current.replace(tzinfo=tz)

    def set_clock(hoy: str) -> str:
        Frozen.current = datetime.fromisoformat(f"{hoy}T{HOUR}")
        return Frozen.current.isoformat()

    tz.datetime = Frozen
    steps = SCENARIOS[name]()
    set_clock(steps[0]["hoy"])

    from fastapi.testclient import TestClient
    import database
    import main

    assert database.DB_PATH == db_path, database.DB_PATH
    # verificación 1: ningún módulo de la v1 tiene una copia propia del reloj
    allowed = {tz.now, tz.today, tz.to_naive}
    for mod in list(sys.modules.values()):
        f = getattr(mod, "__file__", None)
        if not f or not Path(f).resolve().is_relative_to(backend) or mod is tz:
            continue
        for attr, val in vars(mod).items():
            if getattr(val, "__module__", None) == "tz" and callable(val):
                assert val in allowed, f"{mod.__name__}.{attr} no es tz.now/today/to_naive"
    assert tz.now() == Frozen.current, "tz.now() no devuelve el reloj congelado"

    out = []
    with TestClient(main.app) as c:
        # el seed mete hábitos de ejemplo en una base vacía; se quitan para partir de cero
        import sqlite3
        with sqlite3.connect(db_path) as con:
            con.execute("DELETE FROM habits")
        con.close()
        assert c.get("/habits", params={"include_archived": "true"}).json() == [], \
            "la base del escenario no arranca vacía de hábitos"
        assert c.get("/tasks").json() == [] and c.get("/projects").json() == [], \
            "la base del escenario no arranca vacía de tareas y proyectos"

        ids: dict[str, int] = {}
        for s in steps:
            clock = set_clock(s["hoy"])
            method, path = s["llamada"].split(" ", 1)
            cuerpo = s.get("cuerpo")
            if isinstance(cuerpo, dict):  # "{tesis}" en el cuerpo: el id entero del alias
                cuerpo = {k: ids[v[1:-1]] if isinstance(v, str) and v[:1] == "{" else v
                          for k, v in cuerpo.items()}
            r = c.request(method, path.format(**ids), json=cuerpo)
            body = r.json() if r.content else None
            if "alias" in s and r.status_code == 201:
                # verificación 2: los defaults de SQLAlchemy también ven el reloj congelado
                if "created_at" in body:
                    assert body["created_at"] == clock, (body["created_at"], clock)
                ids[s["alias"]] = body["id"]
            out.append({**s, "esperado": {"status": r.status_code, "cuerpo": _project(s["llamada"], body)}})

    real_stdout.write(json.dumps(out))  # ASCII: el pipe va en la página de códigos de Windows


# ---------- padre ----------

def main_parent(backend: Path) -> None:
    commit = subprocess.run(
        ["git", "-C", str(backend), "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    module_of = {f.__name__: m for m, fs in MODULES.items() for f in fs}
    for name, fn in SCENARIOS.items():
        with tempfile.TemporaryDirectory() as tmp:
            env = {k: v for k, v in os.environ.items() if k != "GRIMOIRE_TZ"}
            env["GRIMOIRE_DB"] = str(Path(tmp) / "grimoire.db")
            r = subprocess.run(
                [sys.executable, "-I", __file__, "--child", str(backend), name],
                env=env, cwd=tmp, capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            if r.returncode != 0:
                sys.exit(f"{name}: falló\n{r.stderr}")
            pasos = json.loads(r.stdout)
        golden = {
            "escenario": name,
            "descripcion": " ".join(fn.__doc__.split()),
            "entrada": {"v1_commit": commit, "zona": ZONE, "hora_local": HOUR},
            "pasos": pasos,
        }
        path = GOLDEN_ROOT / module_of[name] / f"{name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(golden, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"{name}: {len(pasos)} pasos -> {path.relative_to(REPO)}")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--child":
        run_child(Path(sys.argv[2]).resolve(), sys.argv[3])
    elif len(sys.argv) == 2:
        main_parent(Path(sys.argv[1]).resolve())
    else:
        sys.exit(__doc__)
