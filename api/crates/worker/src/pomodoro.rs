//! Rutas de pomodoro. El temporizador vive en el cliente: aquí solo se registra la sesión que
//! terminó (docs/tasks/fase-2-pomodoro.md, decisiones 2, 6 y 7). Pasa por la cola sin conexión
//! (ADR 0008): repetir el `POST` con el mismo id da 200 sin efecto. Las reglas están en
//! `grimoire_domain::pomodoro`.

use std::collections::BTreeSet;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Query, State};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use grimoire_domain::achievements::{
    FOCUS_CENTURION, FOCUS_LEGEND, PomodoroFacts, earned_on_pomodoro,
};
use grimoire_domain::pomodoro::{Session, SessionDecision, SessionRejected, register};
use grimoire_domain::xp::{XpChange, award_xp};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use worker::{D1Result, query};

use crate::habits::{
    AchievementRow, UNLOCK_ACHIEVEMENTS, UnlockedAchievement, UserRow, body, int_bool, parse_uuid,
};
use crate::{AppError, AppState, local_date_of, log_d1, now_utc, today};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewSession {
    /// Generado por el cliente al empezar el bloque.
    id: String,
    task_id: Option<String>,
    project_id: Option<String>,
    #[serde(default = "default_minutes")]
    work_minutes: i64,
    #[serde(default = "yes")]
    completed: bool,
    started_at: String,
    /// `ends_at` del bloque, no la hora de la request (fila 25).
    finished_at: String,
}

// los defaults de la v1
fn default_minutes() -> i64 {
    25
}

fn yes() -> bool {
    true
}

#[derive(Serialize)]
pub struct SessionOut {
    xp_earned: i64,
    new_xp: i64,
    new_level: u32,
    title: &'static str,
    leveled_up: bool,
    /// Minutos completados del día de la sesión, que es hoy salvo si se sincronizó tarde.
    total_today_minutes: i64,
    achievements_unlocked: Vec<UnlockedAchievement>,
}

fn session_out(x: XpChange, total: i64, unlocked: Vec<UnlockedAchievement>) -> Json<SessionOut> {
    Json(SessionOut {
        xp_earned: x.applied,
        new_xp: x.new_xp,
        new_level: x.new_level,
        title: x.title,
        leveled_up: x.leveled_up,
        total_today_minutes: total,
        achievements_unlocked: unlocked,
    })
}

fn instant(field: &str, t: &str) -> Result<DateTime<Utc>, AppError> {
    DateTime::parse_from_rfc3339(t)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|_| AppError::Invalid(format!("{field} inválido: «{t}» (RFC 3339)")))
}

fn rfc3339(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[derive(Deserialize)]
struct Total {
    v: i64,
}

/// ?1 día local
const DAY_TOTAL: &str = "SELECT COALESCE(SUM(work_minutes), 0) AS v FROM pomodoro_sessions \
     WHERE local_date = ?1 AND completed = 1";

fn total(r: &D1Result) -> Result<i64, AppError> {
    Ok(r.results::<Total>()?.pop().map_or(0, |t| t.v))
}

// Registrar es una escritura concurrente: la cola reintenta, y dos dispositivos pueden mandar la
// misma sesión. La sesión va primero; el XP exige que esta sesión exista, esté completa y no haya
// pagado (`xp_log.mark_id` = id de la sesión). Como un `batch` es una transacción, el request que
// pierde la carrera no inserta y no paga.

/// ?1 id · ?2 tarea · ?3 proyecto · ?4 minutos · ?5 completa · ?6 inicio · ?7 fin · ?8 día.
/// Una referencia que ya no existe se guarda `NULL` (decisión 6). Sin proyecto explícito, el de la
/// tarea (v1). El `WHERE 1` lo exige SQLite para un `INSERT … SELECT … ON CONFLICT`.
/// Sin fila devuelta: el id ya existía.
pub(crate) const INSERT_SESSION: &str = "INSERT INTO pomodoro_sessions \
     (id, task_id, project_id, work_minutes, completed, started_at, finished_at, local_date) \
     SELECT ?1, (SELECT id FROM tasks WHERE id = ?2), \
     CASE WHEN ?3 IS NULL THEN (SELECT project_id FROM tasks WHERE id = ?2) \
     ELSE (SELECT id FROM projects WHERE id = ?3) END, \
     ?4, ?5, ?6, ?7, ?8 WHERE 1 \
     ON CONFLICT (id) DO NOTHING RETURNING id";
/// ?1 XP · ?2 usuario · ?3 sesión
pub(crate) const SESSION_USER: &str = "UPDATE users SET xp = xp + ?1 WHERE id = ?2 \
     AND EXISTS (SELECT 1 FROM pomodoro_sessions WHERE id = ?3 AND completed = 1) \
     AND NOT EXISTS (SELECT 1 FROM xp_log WHERE mark_id = ?3)";
/// ?1 id · ?2 sesión · ?3 XP · ?4 instante
pub(crate) const SESSION_GRANT: &str = "INSERT INTO xp_log \
     (id, source, source_id, amount, created_at, mark_id) \
     SELECT ?1, 'pomodoro', ?2, ?3, ?4, ?2 \
     WHERE EXISTS (SELECT 1 FROM pomodoro_sessions WHERE id = ?2 AND completed = 1) \
     AND NOT EXISTS (SELECT 1 FROM xp_log WHERE mark_id = ?2)";

#[derive(Deserialize)]
struct Known {
    v: i64,
}

/// Los logros que aún faltan y que esta sesión cumple. Solo cuenta sesiones si alguno de foco
/// sigue bloqueado.
async fn earned_achievements(
    s: &AppState,
    unlocked: &BTreeSet<String>,
    level: u32,
) -> Result<Vec<&'static str>, AppError> {
    let completed_sessions =
        if unlocked.contains(FOCUS_CENTURION) && unlocked.contains(FOCUS_LEGEND) {
            0
        } else {
            let res =
                s.db.batch(vec![s.db.prepare(
                    "SELECT COUNT(*) AS v FROM pomodoro_sessions WHERE completed = 1",
                )])
                .await?;
            log_d1("pomodoro: logros", &res);
            total(&res[0])? + 1
        };
    let mut earned = earned_on_pomodoro(PomodoroFacts {
        level,
        completed_sessions: completed_sessions as u32,
    });
    earned.retain(|k| !unlocked.contains(*k));
    Ok(earned)
}

#[worker::send]
pub async fn create(
    State(s): State<AppState>,
    json: Result<Json<NewSession>, JsonRejection>,
) -> Result<Json<SessionOut>, AppError> {
    let b = body(json)?;
    let id = parse_uuid(&b.id)?;
    let task_id = b.task_id.as_deref().map(parse_uuid).transpose()?;
    let project_id = b.project_id.as_deref().map(parse_uuid).transpose()?;
    let session = Session {
        work_minutes: b.work_minutes,
        completed: b.completed,
        started_at: instant("started_at", &b.started_at)?,
        finished_at: instant("finished_at", &b.finished_at)?,
    };
    let finished_at = rfc3339(session.finished_at);
    let day = local_date_of(&finished_at, &s.tz)?.to_string();

    let res =
        s.db.batch(vec![
            s.db.prepare("SELECT id, xp FROM users LIMIT 1"),
            query!(
                &s.db,
                "SELECT EXISTS (SELECT 1 FROM pomodoro_sessions WHERE id = ?1) AS v",
                id
            )?,
            s.db.prepare("SELECT key FROM achievements WHERE unlocked_at IS NOT NULL"),
            query!(&s.db, DAY_TOTAL, day)?,
        ])
        .await?;
    log_d1("POST /pomodoro/sessions: estado", &res);
    let user = res[0]
        .results::<UserRow>()?
        .pop()
        .ok_or_else(|| AppError::Internal("no hay usuario".into()))?;
    let known = res[1].results::<Known>()?.pop().is_some_and(|k| k.v != 0);
    let unlocked: BTreeSet<String> = res[2]
        .results::<AchievementRow>()?
        .into_iter()
        .map(|r| r.key)
        .collect();

    let now: DateTime<Utc> = now_utc()
        .parse()
        .map_err(|_| AppError::Internal("reloj inválido".into()))?;
    let decision = register(session, known, now).map_err(|r| {
        AppError::Invalid(match r {
            SessionRejected::WorkMinutesOutOfRange => {
                format!("work_minutes debe estar entre 1 y 90: {}", b.work_minutes)
            }
            SessionRejected::StartsAfterEnd => "started_at debe ser anterior a finished_at".into(),
            SessionRejected::FinishedInFuture => {
                "finished_at está en el futuro: revisa el reloj del dispositivo".into()
            }
        })
    })?;
    let xp = match decision {
        SessionDecision::Replay => {
            return Ok(session_out(
                award_xp(user.xp, 0),
                total(&res[3])?,
                Vec::new(),
            ));
        }
        SessionDecision::RecordOnly => award_xp(user.xp, 0),
        SessionDecision::Grant { xp } => award_xp(user.xp, xp),
    };
    let earned = if b.completed {
        earned_achievements(&s, &unlocked, xp.new_level).await?
    } else {
        Vec::new()
    };

    let now = rfc3339(now);
    let mut writes = vec![
        query!(
            &s.db,
            INSERT_SESSION,
            id,
            task_id,
            project_id,
            b.work_minutes,
            i64::from(b.completed),
            rfc3339(session.started_at),
            finished_at,
            day
        )?,
        query!(&s.db, SESSION_USER, xp.applied, user.id, id)?,
        query!(
            &s.db,
            SESSION_GRANT,
            Uuid::now_v7().to_string(),
            id,
            xp.applied,
            now
        )?,
        query!(&s.db, DAY_TOTAL, day)?,
    ];
    if !earned.is_empty() {
        let earned_json =
            serde_json::to_string(&earned).map_err(|e| AppError::Internal(e.to_string()))?;
        writes.push(query!(&s.db, UNLOCK_ACHIEVEMENTS, now, earned_json)?);
    }
    let res = s.db.batch(writes).await?;
    log_d1("POST /pomodoro/sessions: escritura", &res);
    let total = total(&res[3])?;
    if res[0].results::<IdOnly>()?.is_empty() {
        // otro request con el mismo id ganó: es un reintento
        let res =
            s.db.batch(vec![s.db.prepare("SELECT id, xp FROM users LIMIT 1")])
                .await?;
        let user = res[0]
            .results::<UserRow>()?
            .pop()
            .ok_or_else(|| AppError::Internal("no hay usuario".into()))?;
        return Ok(session_out(award_xp(user.xp, 0), total, Vec::new()));
    }
    let mut new = if earned.is_empty() {
        Vec::new()
    } else {
        res.last().unwrap().results::<UnlockedAchievement>()?
    };
    Ok(session_out(
        xp,
        total,
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

// ---------- GET /pomodoro/today ----------

#[derive(Deserialize, Serialize)]
pub struct SessionRow {
    id: String,
    task_id: Option<String>,
    project_id: Option<String>,
    work_minutes: i64,
    #[serde(deserialize_with = "int_bool")]
    completed: bool,
    started_at: String,
    finished_at: String,
    task_title: Option<String>,
}

#[derive(Deserialize)]
pub struct DayQuery {
    /// Por defecto, hoy. Lo usa la reproducción de los goldens, que tienen fechas fijas.
    date: Option<String>,
}

/// Las del día, completas o no, de la más reciente a la más antigua por `started_at` (v1).
#[worker::send]
pub async fn today_sessions(
    State(s): State<AppState>,
    Query(q): Query<DayQuery>,
) -> Result<Json<Vec<SessionRow>>, AppError> {
    let day = match q.date.as_deref() {
        None => today(&s.tz)?,
        Some(d) => d
            .parse::<NaiveDate>()
            .map_err(|_| AppError::Invalid(format!("Fecha inválida: «{d}» (YYYY-MM-DD)")))?,
    };
    let res =
        s.db.batch(vec![query!(
            &s.db,
            "SELECT p.id, p.task_id, p.project_id, p.work_minutes, p.completed, p.started_at, \
             p.finished_at, t.title AS task_title \
             FROM pomodoro_sessions p LEFT JOIN tasks t ON t.id = p.task_id \
             WHERE p.local_date = ?1 ORDER BY p.started_at DESC, p.id DESC",
            day.to_string()
        )?])
        .await?;
    log_d1("GET /pomodoro/today", &res);
    Ok(Json(res[0].results()?))
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
            include_str!("../../../migrations/0006_pomodoro.sql"),
        ))
        .unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        c
    }

    /// Lo que hace `create` con lo que leyó antes. Devuelve si insertó.
    fn apply(
        c: &mut Connection,
        id: &str,
        task: Option<&str>,
        project: Option<&str>,
        completed: bool,
        xp: i64,
    ) -> bool {
        let tx = c.transaction().unwrap();
        let won = tx
            .prepare(INSERT_SESSION)
            .unwrap()
            .query(params![
                id,
                task,
                project,
                25,
                completed,
                "2026-03-02T16:35:00Z",
                "2026-03-02T17:00:00Z",
                "2026-03-02"
            ])
            .unwrap()
            .next()
            .unwrap()
            .is_some();
        tx.execute(SESSION_USER, params![xp, USER, id]).unwrap();
        tx.execute(
            SESSION_GRANT,
            params![format!("log-{id}-{xp}"), id, xp, "2026-03-02T17:00:01Z"],
        )
        .unwrap();
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

    fn refs(c: &Connection, id: &str) -> (Option<String>, Option<String>) {
        c.query_row(
            "SELECT task_id, project_id FROM pomodoro_sessions WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    fn add_project(c: &Connection, id: &str) {
        c.execute(
            "INSERT INTO projects (id, name, created_at) VALUES (?1, ?1, '2026-01-01T05:00:00Z')",
            [id],
        )
        .unwrap();
    }

    fn add_task(c: &Connection, id: &str, project: Option<&str>) {
        c.execute(
            "INSERT INTO tasks (id, title, rank, project_id, created_at) \
             VALUES (?1, ?1, 'a', ?2, '2026-01-01T05:00:00Z')",
            params![id, project],
        )
        .unwrap();
    }

    /// Dos requests con el mismo id, a partir del mismo estado leído (los dos creen que es nueva).
    #[test]
    fn same_id_twice_pays_once() {
        let mut c = db();
        assert!(apply(&mut c, "s", None, None, true, 15));
        assert!(!apply(&mut c, "s", None, None, true, 15));
        assert_eq!(user_xp(&c), 15);
        assert_eq!(log_sum(&c), 15);
    }

    /// Un id ya registrado como incompleta no paga aunque llegue otra vez como completa.
    #[test]
    fn incomplete_never_pays_even_if_resent_complete() {
        let mut c = db();
        assert!(apply(&mut c, "s", None, None, false, 0));
        assert!(!apply(&mut c, "s", None, None, true, 15));
        assert_eq!(user_xp(&c), 0);
        assert_eq!(log_sum(&c), 0);
    }

    #[test]
    fn distinct_sessions_each_pay() {
        let mut c = db();
        assert!(apply(&mut c, "a", None, None, true, 15));
        assert!(apply(&mut c, "b", None, None, true, 15));
        assert_eq!(user_xp(&c), 30);
        assert_eq!(log_sum(&c), 30);
    }

    /// Decisión 6 y filas 29–30: herencia del proyecto, referencias inexistentes y borrados.
    #[test]
    fn references_resolve_on_the_server() {
        let mut c = db();
        add_project(&c, "tesis");
        add_project(&c, "otro");
        add_task(&c, "con", Some("tesis"));
        add_task(&c, "sin", None);
        apply(&mut c, "1", Some("con"), None, true, 15);
        apply(&mut c, "2", Some("con"), Some("otro"), true, 15);
        apply(&mut c, "3", Some("sin"), None, true, 15);
        apply(&mut c, "4", Some("nada"), None, true, 15);
        apply(&mut c, "5", Some("con"), Some("nada"), true, 15);
        assert_eq!(refs(&c, "1"), (Some("con".into()), Some("tesis".into())));
        assert_eq!(refs(&c, "2"), (Some("con".into()), Some("otro".into())));
        assert_eq!(refs(&c, "3"), (Some("sin".into()), None));
        assert_eq!(refs(&c, "4"), (None, None));
        // un proyecto explícito que no existe no se cambia por el de la tarea
        assert_eq!(refs(&c, "5"), (Some("con".into()), None));
        c.execute("DELETE FROM tasks WHERE id = 'con'", []).unwrap();
        c.execute("DELETE FROM projects WHERE id = 'otro'", [])
            .unwrap();
        assert_eq!(refs(&c, "1"), (None, Some("tesis".into())));
        assert_eq!(refs(&c, "2"), (None, None));
        assert_eq!(user_xp(&c), 75);
    }

    #[test]
    fn day_total_counts_only_completed() {
        let mut c = db();
        apply(&mut c, "a", None, None, true, 15);
        apply(&mut c, "b", None, None, false, 0);
        let v: i64 = c
            .query_row(DAY_TOTAL, ["2026-03-02"], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 25);
    }
}
