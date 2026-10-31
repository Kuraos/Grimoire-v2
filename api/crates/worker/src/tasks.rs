//! Rutas de tareas y checklist. Todas pasan por la cola sin conexión (ADR 0008): repetir una
//! escritura con el mismo id da lo mismo. Las reglas están en `grimoire_domain::tasks`.

use std::collections::{BTreeSet, HashMap};

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use grimoire_domain::achievements::{
    PROJECT_MASTER, TASK_CENTURION, TaskFacts, earned_on_task_complete,
};
use grimoire_domain::tasks::{
    CompleteDecision, CompleteRejected, TaskStatus, UncompleteDecision, UncompleteInput,
    UncompleteRejected, XP_REWARD, complete as decide_complete, uncomplete as decide_uncomplete,
    valid_checklist_text, valid_priority, valid_rank,
};
use grimoire_domain::xp::{XpChange, award_xp};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use worker::wasm_bindgen::JsValue;
use worker::{D1Result, query};

use crate::habits::{
    AchievementRow, UNLOCK_ACHIEVEMENTS, UnlockedAchievement, UserRow, body, int_bool, opt_text,
    parse_uuid, present,
};
use crate::{AppError, AppState, log_d1, now_utc, today};

const TASK_COLUMNS: &str = "id, title, description, category, priority, project_id, due_date, \
     xp_reward, status, rank, grant_id, completed_at, completed_on, remind_at, tags, created_at";
const ITEM_COLUMNS: &str = "id, task_id, text, done, position";

// `vault_note_path` no aparece a propósito: solo la escribe la migración de datos.
#[derive(Deserialize, Serialize)]
struct TaskRow {
    id: String,
    title: String,
    description: Option<String>,
    category: Option<String>,
    priority: String,
    project_id: Option<String>,
    due_date: Option<String>,
    xp_reward: i64,
    status: String,
    rank: String,
    grant_id: Option<String>,
    completed_at: Option<String>,
    completed_on: Option<String>,
    remind_at: Option<String>,
    tags: Option<String>,
    created_at: String,
}

impl TaskRow {
    fn status(&self) -> Result<TaskStatus, AppError> {
        TaskStatus::parse(&self.status)
            .ok_or_else(|| AppError::Internal("tarea con status inválido".into()))
    }
}

#[derive(Deserialize, Serialize)]
pub struct ItemRow {
    id: String,
    task_id: String,
    text: String,
    #[serde(deserialize_with = "int_bool")]
    done: bool,
    position: i64,
}

#[derive(Serialize)]
pub struct TaskOut {
    #[serde(flatten)]
    task: TaskRow,
    /// Derivado de `status`: no hay columna que pueda contradecirlo (fila 13).
    completed: bool,
    checklist_total: usize,
    checklist_done: usize,
    checklist: Vec<ItemRow>,
}

fn task_out(task: TaskRow, checklist: Vec<ItemRow>) -> TaskOut {
    TaskOut {
        completed: task.status == "done",
        checklist_total: checklist.len(),
        checklist_done: checklist.iter().filter(|i| i.done).count(),
        task,
        checklist,
    }
}

fn select_task(s: &AppState, id: &str) -> Result<worker::D1PreparedStatement, AppError> {
    Ok(query!(
        &s.db,
        &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1"),
        id
    )?)
}

fn select_items(s: &AppState, task_id: &str) -> Result<worker::D1PreparedStatement, AppError> {
    Ok(query!(
        &s.db,
        &format!("SELECT {ITEM_COLUMNS} FROM checklist_items WHERE task_id = ?1 ORDER BY position"),
        task_id
    )?)
}

// ---------- GET /tasks ----------

/// Todas las tareas con su checklist, en dos consultas y sin N+1. Filtros y orden son del
/// cliente; aquí solo el orden del tablero.
#[worker::send]
pub async fn list(State(s): State<AppState>) -> Result<Json<Vec<TaskOut>>, AppError> {
    let res =
        s.db.batch(vec![
            s.db.prepare(format!(
                "SELECT {TASK_COLUMNS} FROM tasks ORDER BY rank, id"
            )),
            s.db.prepare(format!(
                "SELECT {ITEM_COLUMNS} FROM checklist_items ORDER BY task_id, position"
            )),
        ])
        .await?;
    log_d1("GET /tasks", &res);
    let mut items: HashMap<String, Vec<ItemRow>> = HashMap::new();
    for item in res[1].results::<ItemRow>()? {
        items.entry(item.task_id.clone()).or_default().push(item);
    }
    Ok(Json(
        res[0]
            .results::<TaskRow>()?
            .into_iter()
            .map(|t| {
                let checklist = items.remove(&t.id).unwrap_or_default();
                task_out(t, checklist)
            })
            .collect(),
    ))
}

// ---------- validación ----------

fn check_title(t: &str) -> Result<(), AppError> {
    if t.is_empty() {
        return Err(AppError::Invalid("El título es obligatorio".into()));
    }
    Ok(())
}

fn check_priority(p: &str) -> Result<(), AppError> {
    if valid_priority(p) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Prioridad inválida: «{p}»")))
    }
}

fn check_xp_reward(x: i64) -> Result<(), AppError> {
    if XP_REWARD.contains(&x) {
        Ok(())
    } else {
        Err(AppError::Invalid("El XP debe estar entre 5 y 50".into()))
    }
}

fn check_rank(r: &str) -> Result<(), AppError> {
    if valid_rank(r) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Orden inválido: «{r}»")))
    }
}

/// `done` solo se alcanza completando (filas 12 y 13).
fn writable_status(s: &str) -> Result<&'static str, AppError> {
    match TaskStatus::parse_writable(s) {
        Some(TaskStatus::Todo) => Ok("todo"),
        Some(TaskStatus::Doing) => Ok("doing"),
        _ => Err(AppError::Invalid(format!("Estado no permitido: «{s}»"))),
    }
}

fn parse_day(d: &str) -> Result<NaiveDate, AppError> {
    d.parse()
        .map_err(|_| AppError::Invalid(format!("Fecha inválida: «{d}» (YYYY-MM-DD)")))
}

/// Instante con zona → UTC (invariante 3).
fn parse_instant(t: &str) -> Result<String, AppError> {
    DateTime::parse_from_rfc3339(t)
        .map(|d| {
            d.with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Secs, true)
        })
        .map_err(|_| AppError::Invalid(format!("Instante inválido: «{t}» (RFC 3339)")))
}

fn opt_uuid(v: Option<&str>) -> Result<Option<String>, AppError> {
    v.map(parse_uuid).transpose()
}

/// Traduce un `project_id` o `task_id` sin destino: lo rechaza la clave foránea.
fn missing_reference(e: worker::Error, rejection: AppError) -> AppError {
    if e.to_string().contains("FOREIGN KEY constraint failed") {
        rejection
    } else {
        e.into()
    }
}

fn no_project() -> AppError {
    AppError::Invalid("Ese proyecto no existe".into())
}

// ---------- POST /tasks ----------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewTask {
    id: String,
    title: String,
    /// Clave del tablero, calculada por el cliente al crear.
    rank: String,
    description: Option<String>,
    category: Option<String>,
    priority: Option<String>,
    project_id: Option<String>,
    due_date: Option<String>,
    xp_reward: Option<i64>,
    status: Option<String>,
    remind_at: Option<String>,
    tags: Option<String>,
}

/// Repetir el id devuelve la tarea existente (200); crearla, 201.
#[worker::send]
pub async fn create(
    State(s): State<AppState>,
    json: Result<Json<NewTask>, JsonRejection>,
) -> Result<(StatusCode, Json<TaskOut>), AppError> {
    let t = body(json)?;
    let id = parse_uuid(&t.id)?;
    check_title(&t.title)?;
    check_rank(&t.rank)?;
    let priority = t.priority.as_deref().unwrap_or("medium");
    check_priority(priority)?;
    let xp_reward = t.xp_reward.unwrap_or(15);
    check_xp_reward(xp_reward)?;
    let status = writable_status(t.status.as_deref().unwrap_or("todo"))?;
    if let Some(d) = &t.due_date {
        parse_day(d)?;
    }
    let remind_at = t.remind_at.as_deref().map(parse_instant).transpose()?;
    let project_id = opt_uuid(t.project_id.as_deref())?;

    let res =
        s.db.batch(vec![
            query!(
                &s.db,
                "INSERT INTO tasks (id, title, description, category, priority, project_id, \
                 due_date, xp_reward, status, rank, remind_at, tags, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) \
                 ON CONFLICT (id) DO NOTHING",
                id,
                t.title,
                t.description,
                t.category,
                priority,
                project_id,
                t.due_date,
                xp_reward,
                status,
                t.rank,
                remind_at,
                t.tags,
                now_utc()
            )?,
            select_task(&s, &id)?,
            select_items(&s, &id)?,
        ])
        .await
        .map_err(|e| missing_reference(e, no_project()))?;
    log_d1("POST /tasks", &res);
    let created = res[0].meta()?.and_then(|m| m.changes).unwrap_or(0) > 0;
    let task = res[1]
        .results::<TaskRow>()?
        .pop()
        .ok_or_else(|| AppError::Internal("tarea recién creada no encontrada".into()))?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(task_out(task, res[2].results()?))))
}

// ---------- PATCH /tasks/{id} ----------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskPatch {
    title: Option<String>,
    #[serde(default, deserialize_with = "present")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    category: Option<Option<String>>,
    priority: Option<String>,
    #[serde(default, deserialize_with = "present")]
    project_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    due_date: Option<Option<String>>,
    xp_reward: Option<i64>,
    status: Option<String>,
    rank: Option<String>,
    #[serde(default, deserialize_with = "present")]
    remind_at: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    tags: Option<Option<String>>,
}

/// Solo asigna lo que viene. Mover en el tablero es `{status?, rank?}`: una sola fila.
#[worker::send]
pub async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    json: Result<Json<TaskPatch>, JsonRejection>,
) -> Result<Json<TaskOut>, AppError> {
    let p = body(json)?;
    let id = parse_uuid(&id)?;
    let mut sets: Vec<(&str, JsValue)> = Vec::new();
    if let Some(t) = &p.title {
        check_title(t)?;
        sets.push(("title", t.as_str().into()));
    }
    if let Some(v) = &p.description {
        sets.push(("description", opt_text(v.as_deref())));
    }
    if let Some(v) = &p.category {
        sets.push(("category", opt_text(v.as_deref())));
    }
    if let Some(v) = &p.priority {
        check_priority(v)?;
        sets.push(("priority", v.as_str().into()));
    }
    if let Some(v) = &p.project_id {
        let project = opt_uuid(v.as_deref())?;
        sets.push(("project_id", opt_text(project.as_deref())));
    }
    if let Some(v) = &p.due_date {
        if let Some(d) = v {
            parse_day(d)?;
        }
        sets.push(("due_date", opt_text(v.as_deref())));
    }
    if let Some(x) = p.xp_reward {
        check_xp_reward(x)?;
        sets.push(("xp_reward", (x as f64).into()));
    }
    let status = p.status.as_deref().map(writable_status).transpose()?;
    if let Some(v) = status {
        sets.push(("status", v.into()));
    }
    if let Some(v) = &p.rank {
        check_rank(v)?;
        sets.push(("rank", v.as_str().into()));
    }
    if let Some(v) = &p.remind_at {
        let at = v.as_deref().map(parse_instant).transpose()?;
        sets.push(("remind_at", opt_text(at.as_deref())));
    }
    if let Some(v) = &p.tags {
        sets.push(("tags", opt_text(v.as_deref())));
    }

    let mut stmts = Vec::new();
    let wrote = !sets.is_empty();
    if wrote {
        let assigns: Vec<String> = sets
            .iter()
            .enumerate()
            .map(|(i, (col, _))| format!("{col} = ?{}", i + 1))
            .collect();
        let mut binds: Vec<JsValue> = sets.into_iter().map(|(_, v)| v).collect();
        binds.push(id.as_str().into());
        // salir de `done` solo por `uncomplete`, que devuelve el XP (fila 12)
        let guard = if status.is_some() {
            " AND status <> 'done'"
        } else {
            ""
        };
        stmts.push(
            s.db.prepare(format!(
                "UPDATE tasks SET {} WHERE id = ?{}{guard}",
                assigns.join(", "),
                binds.len()
            ))
            .bind(&binds)?,
        );
    }
    stmts.push(select_task(&s, &id)?);
    stmts.push(select_items(&s, &id)?);
    let res =
        s.db.batch(stmts)
            .await
            .map_err(|e| missing_reference(e, no_project()))?;
    log_d1("PATCH /tasks/{id}", &res);
    let n = res.len();
    let task = res[n - 2]
        .results::<TaskRow>()?
        .pop()
        .ok_or(AppError::NotFound("Tarea no encontrada"))?;
    if wrote && status.is_some() && res[0].meta()?.and_then(|m| m.changes).unwrap_or(0) == 0 {
        return Err(AppError::Conflict(
            "La tarea está completada: descomplétala para moverla de estado".into(),
        ));
    }
    Ok(Json(task_out(task, res[n - 1].results()?)))
}

/// Borrado real; el XP ganado se conserva (v1). Repetirlo da 204 (fila 15).
#[worker::send]
pub async fn remove(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let id = parse_uuid(&id)?;
    let res =
        s.db.batch(vec![query!(&s.db, "DELETE FROM tasks WHERE id = ?1", id)?])
            .await?;
    log_d1("DELETE /tasks/{id}", &res);
    Ok(StatusCode::NO_CONTENT)
}

// ---------- complete / uncomplete ----------

#[derive(Serialize)]
pub struct XpOut {
    xp_earned: i64,
    new_xp: i64,
    new_level: u32,
    title: &'static str,
    leveled_up: bool,
    achievements_unlocked: Vec<UnlockedAchievement>,
}

fn xp_out(x: XpChange, achievements_unlocked: Vec<UnlockedAchievement>) -> Json<XpOut> {
    Json(XpOut {
        xp_earned: x.applied,
        new_xp: x.new_xp,
        new_level: x.new_level,
        title: x.title,
        leveled_up: x.leveled_up,
        achievements_unlocked,
    })
}

#[derive(Deserialize)]
struct GrantState {
    n: i64,
    total: i64,
}

struct TaskState {
    task: TaskRow,
    user: UserRow,
    grant: GrantState,
    unlocked: BTreeSet<String>,
}

const GRANT_STATE: &str = "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM xp_log \
     WHERE mark_id = ?1 AND source = 'task' AND source_id = ?2";

async fn read_state(s: &AppState, id: &str, grant: Option<&str>) -> Result<TaskState, AppError> {
    let res =
        s.db.batch(vec![
            select_task(s, id)?,
            s.db.prepare("SELECT id, xp FROM users LIMIT 1"),
            query!(&s.db, GRANT_STATE, grant, id)?,
            s.db.prepare("SELECT key FROM achievements WHERE unlocked_at IS NOT NULL"),
        ])
        .await?;
    log_d1("tarea: estado", &res);
    Ok(TaskState {
        task: res[0]
            .results::<TaskRow>()?
            .pop()
            .ok_or(AppError::NotFound("Tarea no encontrada"))?,
        user: res[1]
            .results::<UserRow>()?
            .pop()
            .ok_or_else(|| AppError::Internal("no hay usuario".into()))?,
        grant: res[2]
            .results::<GrantState>()?
            .pop()
            .ok_or_else(|| AppError::Internal("sin saldo de concesión".into()))?,
        unlocked: res[3]
            .results::<AchievementRow>()?
            .into_iter()
            .map(|r| r.key)
            .collect(),
    })
}

// Completar es una escritura concurrente: la tarea va primero y las demás sentencias exigen que
// esta concesión haya quedado vigente y sin movimientos, así que un request que pierde la carrera
// no paga nada. Sin `xp_log` previo con este id: un reintento tras descompletar tampoco.

/// ?1 concesión · ?2 instante · ?3 día · ?4 rank · ?5 tarea. Sin fila devuelta: perdió la carrera.
pub(crate) const COMPLETE_TASK: &str = "UPDATE tasks SET status = 'done', grant_id = ?1, \
     completed_at = ?2, completed_on = ?3, rank = COALESCE(?4, rank) \
     WHERE id = ?5 AND status <> 'done' \
     AND NOT EXISTS (SELECT 1 FROM xp_log WHERE mark_id = ?1) RETURNING id";
/// ?1 XP · ?2 usuario · ?3 tarea · ?4 concesión
pub(crate) const COMPLETE_USER: &str = "UPDATE users SET xp = xp + ?1 WHERE id = ?2 \
     AND EXISTS (SELECT 1 FROM tasks WHERE id = ?3 AND grant_id = ?4) \
     AND NOT EXISTS (SELECT 1 FROM xp_log WHERE mark_id = ?4)";
/// ?1 id · ?2 tarea · ?3 XP · ?4 instante · ?5 concesión
pub(crate) const COMPLETE_GRANT: &str = "INSERT INTO xp_log \
     (id, source, source_id, amount, created_at, mark_id) \
     SELECT ?1, 'task', ?2, ?3, ?4, ?5 \
     WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?2 AND grant_id = ?5) \
     AND NOT EXISTS (SELECT 1 FROM xp_log WHERE mark_id = ?5)";

/// ?1 tarea. Algún proyecto quedaría con todo hecho al completarla, sea o no el suyo (v1).
pub(crate) const PROJECT_FINISHED: &str = "SELECT EXISTS (SELECT 1 FROM tasks \
     WHERE project_id IS NOT NULL GROUP BY project_id \
     HAVING SUM(status <> 'done' AND id <> ?1) = 0) AS v";

#[derive(Deserialize)]
struct FlagRow {
    v: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompleteBody {
    /// Id de la concesión, generado por el cliente.
    id: String,
    /// Día local de la acción. Por defecto, hoy.
    local_date: Option<String>,
    /// Posición en la columna de hechas, si se soltó ahí.
    rank: Option<String>,
}

/// Los logros que aún faltan y que esta tarea cumple. Solo consulta lo que sigue bloqueado.
async fn earned_achievements(
    s: &AppState,
    st: &TaskState,
    id: &str,
    level: u32,
) -> Result<Vec<&'static str>, AppError> {
    let project_locked = !st.unlocked.contains(PROJECT_MASTER);
    let centurion_locked = !st.unlocked.contains(TASK_CENTURION);
    let mut stmts = Vec::new();
    if project_locked {
        stmts.push(query!(&s.db, PROJECT_FINISHED, id)?);
    }
    if centurion_locked {
        stmts.push(s.db.prepare("SELECT COUNT(*) AS v FROM tasks WHERE status = 'done'"));
    }
    let res: Vec<D1Result> = if stmts.is_empty() {
        Vec::new()
    } else {
        s.db.batch(stmts).await?
    };
    log_d1("complete tarea: logros", &res);
    let flag = |r: &D1Result| -> Result<i64, AppError> {
        Ok(r.results::<FlagRow>()?.pop().map_or(0, |f| f.v))
    };
    let project_finished = project_locked && flag(&res[0])? != 0;
    let completed_tasks = if centurion_locked {
        flag(res.last().unwrap())? + 1
    } else {
        0
    };
    let mut earned = earned_on_task_complete(TaskFacts {
        level,
        project_finished,
        completed_tasks: completed_tasks as u32,
    });
    earned.retain(|k| !st.unlocked.contains(*k));
    Ok(earned)
}

#[worker::send]
pub async fn complete(
    State(s): State<AppState>,
    Path(id): Path<String>,
    json: Result<Json<CompleteBody>, JsonRejection>,
) -> Result<Json<XpOut>, AppError> {
    let b = body(json)?;
    let id = parse_uuid(&id)?;
    let grant = parse_uuid(&b.id)?;
    if let Some(r) = &b.rank {
        check_rank(r)?;
    }
    let today = today(&s.tz)?;
    let on = b.local_date.as_deref().map_or(Ok(today), parse_day)?;

    let st = read_state(&s, &id, Some(&grant)).await?;
    let decision = decide_complete(
        st.task.status()?,
        st.grant.n > 0,
        st.task.xp_reward,
        on,
        today,
    )
    .map_err(|r| {
        AppError::Conflict(match r {
            CompleteRejected::AlreadyCompleted => "La tarea ya está completada".into(),
            CompleteRejected::FutureDay => format!("El día {on} todavía no ha llegado"),
        })
    })?;
    let xp = match decision {
        CompleteDecision::Replay => return Ok(xp_out(award_xp(st.user.xp, 0), Vec::new())),
        CompleteDecision::Grant { xp } => award_xp(st.user.xp, xp),
    };
    let earned = earned_achievements(&s, &st, &id, xp.new_level).await?;

    let now = now_utc();
    let mut writes = vec![
        query!(&s.db, COMPLETE_TASK, grant, now, on.to_string(), b.rank, id)?,
        query!(&s.db, COMPLETE_USER, xp.applied, st.user.id, id, grant)?,
        query!(
            &s.db,
            COMPLETE_GRANT,
            Uuid::now_v7().to_string(),
            id,
            xp.applied,
            now,
            grant
        )?,
    ];
    if !earned.is_empty() {
        let earned_json =
            serde_json::to_string(&earned).map_err(|e| AppError::Internal(e.to_string()))?;
        writes.push(query!(&s.db, UNLOCK_ACHIEVEMENTS, now, earned_json)?);
    }
    let res = s.db.batch(writes).await?;
    log_d1("complete tarea: escritura", &res);
    if res[0].results::<IdOnly>()?.is_empty() {
        // otro request ganó: el mismo id es un reintento; otro id, un rechazo
        let st = read_state(&s, &id, Some(&grant)).await?;
        if st.grant.n > 0 {
            return Ok(xp_out(award_xp(st.user.xp, 0), Vec::new()));
        }
        return Err(AppError::Conflict("La tarea ya está completada".into()));
    }
    let mut new = if earned.is_empty() {
        Vec::new()
    } else {
        res.last().unwrap().results::<UnlockedAchievement>()?
    };
    Ok(xp_out(
        xp,
        // RETURNING no garantiza orden: se conserva el del dominio
        earned
            .into_iter()
            .filter_map(|k| {
                let i = new.iter().position(|r| r.key == k)?;
                Some(new.swap_remove(i))
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
struct IdOnly {
    #[allow(dead_code)]
    id: String,
}

// Descompletar: todas las sentencias exigen que la tarea siga hecha con esta concesión, y la
// tarea va de última para que la guarda valga en las anteriores. Como en Hábitos, lo que el piso
// no deja quitar se anota aparte, para que `users.xp` siga siendo la suma de `xp_log`.

/// ?1 id · ?2 devolución · ?3 instante · ?4 concesión · ?5 usuario · ?6 tarea
pub(crate) const UNCOMPLETE_FLOOR: &str = "INSERT INTO xp_log \
     (id, source, source_id, amount, created_at, mark_id) \
     SELECT ?1, 'xp_floor', NULL, ?2 - xp, ?3, ?4 FROM users \
     WHERE id = ?5 AND xp < ?2 \
     AND EXISTS (SELECT 1 FROM tasks WHERE id = ?6 AND status = 'done' AND grant_id IS ?4)";
/// ?1 id · ?2 tarea · ?3 devolución · ?4 instante · ?5 concesión
pub(crate) const UNCOMPLETE_GRANT: &str = "INSERT INTO xp_log \
     (id, source, source_id, amount, created_at, mark_id) \
     SELECT ?1, 'task', ?2, -?3, ?4, ?5 \
     WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?2 AND status = 'done' AND grant_id IS ?5)";
/// ?1 devolución · ?2 usuario · ?3 tarea · ?4 concesión
pub(crate) const UNCOMPLETE_USER: &str = "UPDATE users SET xp = MAX(0, xp - ?1) WHERE id = ?2 \
     AND EXISTS (SELECT 1 FROM tasks WHERE id = ?3 AND status = 'done' AND grant_id IS ?4)";
/// ?1 estado · ?2 rank · ?3 tarea · ?4 concesión. Sin fila devuelta: otro request ganó.
pub(crate) const UNCOMPLETE_TASK: &str = "UPDATE tasks SET status = ?1, rank = COALESCE(?2, rank), \
     grant_id = NULL, completed_at = NULL, completed_on = NULL \
     WHERE id = ?3 AND status = 'done' AND grant_id IS ?4 RETURNING id";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UncompleteBody {
    /// La concesión que se deshace. `null` solo en una tarea migrada que se completó sin XP.
    grant_id: Option<String>,
    /// Columna de destino, si se arrastró. Por defecto, `todo` (v1).
    status: Option<String>,
    rank: Option<String>,
}

#[worker::send]
pub async fn uncomplete(
    State(s): State<AppState>,
    Path(id): Path<String>,
    json: Result<Json<UncompleteBody>, JsonRejection>,
) -> Result<Json<XpOut>, AppError> {
    let b = body(json)?;
    let id = parse_uuid(&id)?;
    let grant = opt_uuid(b.grant_id.as_deref())?;
    let status = writable_status(b.status.as_deref().unwrap_or("todo"))?;
    if let Some(r) = &b.rank {
        check_rank(r)?;
    }

    let st = read_state(&s, &id, grant.as_deref()).await?;
    let decision = decide_uncomplete(UncompleteInput {
        status: st.task.status()?,
        current_grant: st.task.grant_id.as_deref(),
        requested_grant: grant.as_deref(),
        grant_known: st.grant.n > 0,
        balance: st.grant.total,
    })
    .map_err(|r| {
        AppError::Conflict(
            match r {
                UncompleteRejected::NotCompleted => "La tarea no está completada",
                UncompleteRejected::UnknownGrant => "Esa concesión no es de esta tarea",
            }
            .into(),
        )
    })?;
    let refund = match decision {
        UncompleteDecision::Replay => return Ok(xp_out(award_xp(st.user.xp, 0), Vec::new())),
        UncompleteDecision::Reopen { refund } => refund,
    };

    let now = now_utc();
    let mut writes = Vec::new();
    if refund > 0 {
        writes.push(query!(
            &s.db,
            UNCOMPLETE_FLOOR,
            Uuid::now_v7().to_string(),
            refund,
            now,
            grant,
            st.user.id,
            id
        )?);
        writes.push(query!(
            &s.db,
            UNCOMPLETE_GRANT,
            Uuid::now_v7().to_string(),
            id,
            refund,
            now,
            grant
        )?);
    }
    writes.push(query!(
        &s.db,
        UNCOMPLETE_USER,
        refund,
        st.user.id,
        id,
        grant
    )?);
    writes.push(query!(&s.db, UNCOMPLETE_TASK, status, b.rank, id, grant)?);
    let res = s.db.batch(writes).await?;
    log_d1("uncomplete tarea: escritura", &res);
    if res.last().unwrap().results::<IdOnly>()?.is_empty() {
        let st = read_state(&s, &id, grant.as_deref()).await?;
        return Ok(xp_out(award_xp(st.user.xp, 0), Vec::new()));
    }
    Ok(xp_out(award_xp(st.user.xp, -refund), Vec::new()))
}

// ---------- checklist ----------

/// ?1 id · ?2 tarea · ?3 texto. `position` = max + 1; la cola conserva el orden.
pub(crate) const ADD_ITEM: &str = "INSERT INTO checklist_items (id, task_id, text, position) \
     SELECT ?1, ?2, ?3, COALESCE(MAX(position), -1) + 1 FROM checklist_items WHERE task_id = ?2 \
     ON CONFLICT (id) DO NOTHING";

fn check_item_text(t: &str) -> Result<(), AppError> {
    if valid_checklist_text(t) {
        Ok(())
    } else {
        Err(AppError::Invalid("El ítem necesita texto".into()))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewItem {
    id: String,
    text: String,
}

#[worker::send]
pub async fn add_item(
    State(s): State<AppState>,
    Path(task_id): Path<String>,
    json: Result<Json<NewItem>, JsonRejection>,
) -> Result<(StatusCode, Json<ItemRow>), AppError> {
    let i = body(json)?;
    let task_id = parse_uuid(&task_id)?;
    let id = parse_uuid(&i.id)?;
    check_item_text(&i.text)?;
    let res =
        s.db.batch(vec![
            query!(&s.db, ADD_ITEM, id, task_id, i.text)?,
            query!(
                &s.db,
                &format!("SELECT {ITEM_COLUMNS} FROM checklist_items WHERE id = ?1"),
                id
            )?,
        ])
        .await
        .map_err(|e| missing_reference(e, AppError::NotFound("Tarea no encontrada")))?;
    log_d1("POST checklist", &res);
    let created = res[0].meta()?.and_then(|m| m.changes).unwrap_or(0) > 0;
    let item = res[1]
        .results::<ItemRow>()?
        .pop()
        .ok_or_else(|| AppError::Internal("ítem recién creado no encontrado".into()))?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(item)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItemPatch {
    text: Option<String>,
    done: Option<bool>,
}

#[worker::send]
pub async fn update_item(
    State(s): State<AppState>,
    Path(id): Path<String>,
    json: Result<Json<ItemPatch>, JsonRejection>,
) -> Result<Json<ItemRow>, AppError> {
    let p = body(json)?;
    let id = parse_uuid(&id)?;
    if let Some(t) = &p.text {
        check_item_text(t)?;
    }
    let done = p.done.map(i64::from);
    let res =
        s.db.batch(vec![
            query!(
                &s.db,
                "UPDATE checklist_items SET text = COALESCE(?1, text), done = COALESCE(?2, done) \
                 WHERE id = ?3",
                p.text,
                done,
                id
            )?,
            query!(
                &s.db,
                &format!("SELECT {ITEM_COLUMNS} FROM checklist_items WHERE id = ?1"),
                id
            )?,
        ])
        .await?;
    log_d1("PATCH checklist", &res);
    res[1]
        .results::<ItemRow>()?
        .pop()
        .map(Json)
        .ok_or(AppError::NotFound("Ítem no encontrado"))
}

/// Repetirlo da 204 (fila 15).
#[worker::send]
pub async fn remove_item(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let id = parse_uuid(&id)?;
    let res =
        s.db.batch(vec![query!(
            &s.db,
            "DELETE FROM checklist_items WHERE id = ?1",
            id
        )?])
        .await?;
    log_d1("DELETE checklist", &res);
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    //! Las sentencias reales, contra SQLite (D1 es SQLite). Un `batch` se aplica como transacción.
    use super::*;
    use rusqlite::{Connection, params};

    const USER: &str = "00000000-0000-7000-8000-000000000001";

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(concat!(
            include_str!("../../../migrations/0001_init.sql"),
            include_str!("../../../migrations/0002_lives.sql"),
            include_str!("../../../migrations/0003_achievements.sql"),
            include_str!("../../../migrations/0004_undo_and_categories.sql"),
            include_str!("../../../migrations/0005_tasks.sql"),
        ))
        .unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        c
    }

    fn add_task(c: &Connection, id: &str, project: Option<&str>) {
        c.execute(
            "INSERT INTO tasks (id, title, rank, project_id, created_at) \
             VALUES (?1, ?1, 'a', ?2, '2026-01-01T05:00:00Z')",
            params![id, project],
        )
        .unwrap();
    }

    fn add_project(c: &Connection, id: &str) {
        c.execute(
            "INSERT INTO projects (id, name, created_at) VALUES (?1, ?1, '2026-01-01T05:00:00Z')",
            [id],
        )
        .unwrap();
    }

    /// Lo que hace `complete` con lo que leyó antes. Devuelve si ganó.
    fn apply_complete(c: &mut Connection, task: &str, grant: &str, xp: i64) -> bool {
        let tx = c.transaction().unwrap();
        let won: bool = tx
            .prepare(COMPLETE_TASK)
            .unwrap()
            .query(params![
                grant,
                "2026-03-02T17:00:00Z",
                "2026-03-02",
                None::<&str>,
                task
            ])
            .unwrap()
            .next()
            .unwrap()
            .is_some();
        tx.execute(COMPLETE_USER, params![xp, USER, task, grant])
            .unwrap();
        tx.execute(
            COMPLETE_GRANT,
            params![
                format!("log-{grant}"),
                task,
                xp,
                "2026-03-02T17:00:00Z",
                grant
            ],
        )
        .unwrap();
        tx.commit().unwrap();
        won
    }

    fn apply_uncomplete(c: &mut Connection, task: &str, grant: &str, refund: i64, n: u32) -> bool {
        let now = "2026-03-03T17:00:00Z";
        let tx = c.transaction().unwrap();
        tx.execute(
            UNCOMPLETE_FLOOR,
            params![format!("floor-{grant}-{n}"), refund, now, grant, USER, task],
        )
        .unwrap();
        tx.execute(
            UNCOMPLETE_GRANT,
            params![format!("undo-{grant}-{n}"), task, refund, now, grant],
        )
        .unwrap();
        tx.execute(UNCOMPLETE_USER, params![refund, USER, task, grant])
            .unwrap();
        let won: bool = tx
            .prepare(UNCOMPLETE_TASK)
            .unwrap()
            .query(params!["todo", None::<&str>, task, grant])
            .unwrap()
            .next()
            .unwrap()
            .is_some();
        tx.commit().unwrap();
        won
    }

    fn user_xp(c: &Connection) -> i64 {
        c.query_row("SELECT xp FROM users", [], |r| r.get(0))
            .unwrap()
    }

    fn log_sum(c: &Connection) -> i64 {
        c.query_row("SELECT COALESCE(SUM(amount), 0) FROM xp_log", [], |r| {
            r.get(0)
        })
        .unwrap()
    }

    fn task_grant(c: &Connection, id: &str) -> (String, Option<String>) {
        c.query_row(
            "SELECT status, grant_id FROM tasks WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    /// Dos dispositivos reintentan lo mismo, a partir del mismo estado leído.
    #[test]
    fn same_grant_twice_pays_once() {
        let mut c = db();
        add_task(&c, "t", None);
        assert!(apply_complete(&mut c, "t", "g", 15));
        assert!(!apply_complete(&mut c, "t", "g", 15));
        assert_eq!(user_xp(&c), 15);
        assert_eq!(log_sum(&c), 15);
    }

    /// Dos dispositivos sin conexión la completan con concesiones distintas.
    #[test]
    fn different_grants_pay_once_and_keep_the_first() {
        let mut c = db();
        add_task(&c, "t", None);
        assert!(apply_complete(&mut c, "t", "g1", 15));
        assert!(!apply_complete(&mut c, "t", "g2", 15));
        assert_eq!(user_xp(&c), 15);
        assert_eq!(log_sum(&c), 15);
        assert_eq!(task_grant(&c, "t"), ("done".into(), Some("g1".into())));
    }

    /// Un reintento de completar llega después de descompletar: ni paga ni reabre el ciclo.
    #[test]
    fn retry_after_uncomplete_does_nothing() {
        let mut c = db();
        add_task(&c, "t", None);
        apply_complete(&mut c, "t", "g", 15);
        assert!(apply_uncomplete(&mut c, "t", "g", 15, 1));
        assert!(!apply_complete(&mut c, "t", "g", 15));
        assert_eq!(user_xp(&c), 0);
        assert_eq!(log_sum(&c), 0);
        assert_eq!(task_grant(&c, "t"), ("todo".into(), None));
    }

    #[test]
    fn uncomplete_twice_refunds_once() {
        let mut c = db();
        add_task(&c, "t", None);
        apply_complete(&mut c, "t", "g", 15);
        c.execute("UPDATE users SET xp = xp + 50", []).unwrap();
        c.execute(
            "INSERT INTO xp_log (id, source, amount, created_at) \
             VALUES ('base', 'habit', 50, '2026-03-02T17:00:00Z')",
            [],
        )
        .unwrap();
        assert!(apply_uncomplete(&mut c, "t", "g", 15, 1));
        assert!(!apply_uncomplete(&mut c, "t", "g", 15, 2));
        assert_eq!(user_xp(&c), 50);
        assert_eq!(log_sum(&c), 50);
    }

    /// `descompletar_piso`: con el XP ya en otra cosa, el piso recorta y la suma sigue cuadrando.
    #[test]
    fn uncomplete_respects_the_floor() {
        let mut c = db();
        add_task(&c, "t", None);
        apply_complete(&mut c, "t", "g", 15);
        c.execute("UPDATE users SET xp = 10", []).unwrap();
        c.execute(
            "INSERT INTO xp_log (id, source, amount, created_at) \
             VALUES ('p', 'streak_penalty', -5, '2026-03-02T18:00:00Z')",
            [],
        )
        .unwrap();
        assert!(apply_uncomplete(&mut c, "t", "g", 15, 1));
        assert_eq!(user_xp(&c), 0);
        assert_eq!(log_sum(&c), 0);
    }

    /// `descompletar_piso`, ciclo: la concesión nueva devuelve lo suyo, no el historial (fila 11).
    #[test]
    fn second_cycle_refunds_only_its_grant() {
        let mut c = db();
        add_task(&c, "t", None);
        add_task(&c, "base", None);
        apply_complete(&mut c, "base", "b", 50);
        apply_complete(&mut c, "t", "g1", 15);
        apply_uncomplete(&mut c, "t", "g1", 15, 1);
        apply_complete(&mut c, "t", "g2", 15);
        let balance: i64 = c.query_row(GRANT_STATE, ["g2", "t"], |r| r.get(1)).unwrap();
        assert_eq!(balance, 15);
        apply_uncomplete(&mut c, "t", "g2", balance, 1);
        assert_eq!(user_xp(&c), 50);
    }

    fn finished(c: &Connection, task: &str) -> i64 {
        c.query_row(PROJECT_FINISHED, [task], |r| r.get(0)).unwrap()
    }

    /// `logros_tareas` y `logro_por_patch`: un proyecto vacío no cuenta, y lo cierra la última.
    #[test]
    fn project_finished_needs_tasks_and_counts_the_one_completing() {
        let mut c = db();
        add_project(&c, "vacio");
        add_task(&c, "suelta", None);
        assert_eq!(finished(&c, "suelta"), 0);
        add_project(&c, "p");
        add_task(&c, "a", Some("p"));
        add_task(&c, "b", Some("p"));
        assert_eq!(finished(&c, "a"), 0);
        apply_complete(&mut c, "a", "g", 15);
        assert_eq!(finished(&c, "b"), 1);
        assert_eq!(finished(&c, "suelta"), 0);
    }

    /// `checklist`: max + 1, sin reutilizar lo borrado; repetir el id no duplica.
    #[test]
    fn checklist_positions_and_retry() {
        let c = db();
        add_task(&c, "t", None);
        for (id, text) in [("i1", "Uno"), ("i2", "Dos"), ("i3", "Tres")] {
            c.execute(ADD_ITEM, params![id, "t", text]).unwrap();
        }
        let pos = |id: &str| -> i64 {
            c.query_row(
                "SELECT position FROM checklist_items WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!((pos("i1"), pos("i2"), pos("i3")), (0, 1, 2));
        assert_eq!(c.execute(ADD_ITEM, params!["i3", "t", "Otra"]).unwrap(), 0);
        c.execute("DELETE FROM checklist_items WHERE id = 'i2'", [])
            .unwrap();
        c.execute(ADD_ITEM, params!["i4", "t", "Cuatro"]).unwrap();
        assert_eq!(pos("i4"), 3);
    }

    #[test]
    fn checklist_on_a_missing_task_fails_the_foreign_key() {
        let c = db();
        let e = c.execute(ADD_ITEM, params!["i", "no", "x"]).unwrap_err();
        assert!(
            e.to_string().contains("FOREIGN KEY constraint failed"),
            "{e}"
        );
    }
}
