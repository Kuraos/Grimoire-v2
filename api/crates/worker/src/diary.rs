//! Rutas del diario (docs/tasks/fase-2-diario.md, decisiones 1, 5, 7 y 8). El `PUT` pasa por la
//! cola sin conexión (ADR 0008): repetirlo con el mismo `save_id` da 200 sin efecto. Las reglas están
//! en `grimoire_domain::diary`.

use std::collections::BTreeSet;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use chrono::{Datelike, Days, Months, NaiveDate};
use grimoire_domain::achievements::{ARCHIVIST, DIARY_CENTURY, DiaryFacts, earned_on_diary};
use grimoire_domain::diary::{
    EntryRejected, Incoming, SaveDecision, Stored, decide_save, is_written, like_pattern, snippet,
    validate, xp_for_save,
};
use grimoire_domain::xp::{XpChange, award_xp};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use worker::{D1Result, query};

use crate::habits::{AchievementRow, UnlockedAchievement, UserRow, body, parse_uuid};
use crate::{AppError, AppState, local_date_of, log_d1, now_utc, today};

fn parse_day(d: &str) -> Result<NaiveDate, AppError> {
    d.parse()
        .map_err(|_| AppError::Invalid(format!("Fecha inválida: «{d}» (YYYY-MM-DD)")))
}

#[derive(Deserialize, Serialize)]
pub struct EntryRow {
    /// `null` si el día no tiene entrada: leer no crea filas (v1).
    id: Option<String>,
    local_date: String,
    content: String,
    tags: Option<String>,
    /// `null` sin entrada. El cliente lo manda como `base_save_id` en su próximo guardado.
    save_id: Option<String>,
    updated_at: Option<String>,
}

impl EntryRow {
    fn empty(day: &str) -> Self {
        EntryRow {
            id: None,
            local_date: day.into(),
            content: String::new(),
            tags: None,
            save_id: None,
            updated_at: None,
        }
    }
}

const ENTRY: &str = "SELECT id, local_date, content, tags, save_id, updated_at FROM diary_entries \
     WHERE local_date = ?1";

#[derive(Deserialize, Serialize)]
pub struct ConflictRow {
    id: String,
    content: String,
    tags: Option<String>,
    created_at: String,
}

const CONFLICTS: &str = "SELECT id, content, tags, created_at FROM diary_conflicts \
     WHERE local_date = ?1 ORDER BY created_at, id";

fn entry_of(r: &D1Result, day: &str) -> Result<EntryRow, AppError> {
    Ok(r.results::<EntryRow>()?
        .pop()
        .unwrap_or_else(|| EntryRow::empty(day)))
}

// ---------- PUT /diary/{date} ----------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveBody {
    /// Id de la entrada, generado por el cliente. Si el día ya tiene entrada, se conserva la que hay
    /// (decisión 5).
    id: String,
    save_id: String,
    base_save_id: Option<String>,
    content: String,
    /// Ausente o `null`: se conservan las de la entrada (v1, `etiquetas_y_validacion`).
    tags: Option<String>,
}

#[derive(Serialize)]
pub struct SaveOut {
    entry: EntryRow,
    /// Copias de este día en `diary_conflicts`, con las de este guardado. Un reintento las ve igual.
    conflicts: i64,
    xp_earned: i64,
    new_xp: i64,
    new_level: u32,
    title: &'static str,
    leveled_up: bool,
    achievements_unlocked: Vec<UnlockedAchievement>,
}

#[derive(Deserialize)]
struct Count {
    v: i64,
}

fn count(r: &D1Result) -> Result<i64, AppError> {
    Ok(r.results::<Count>()?.pop().map_or(0, |c| c.v))
}

// Guardar es una escritura concurrente: la cola reintenta y dos dispositivos pueden escribir el mismo
// día. Todo el `batch` (una transacción) se condiciona a que la entrada siga en el `save_id` leído:
// si otro guardado ganó en medio, nada se escribe y se vuelve a leer y decidir. El XP exige que la
// entrada quede con este `save_id` y escrita, y que no haya concesión con `mark_id` = id.

/// ?1 id de la copia (= `save_id` que llega) · ?2 día · ?3 `save_id` leído · ?4 instante.
pub(crate) const COPY_CONFLICT: &str = "INSERT INTO diary_conflicts \
     (id, local_date, content, tags, save_id, created_at) \
     SELECT ?1, local_date, content, tags, save_id, ?4 FROM diary_entries \
     WHERE local_date = ?2 AND save_id = ?3 ON CONFLICT (id) DO NOTHING";
/// ?1 id · ?2 día · ?3 texto · ?4 etiquetas · ?5 conservar etiquetas · ?6 escrita · ?7 `save_id` ·
/// ?8 instante · ?9 `save_id` leído (`NULL` si no había entrada). Sin fila devuelta: otro guardado
/// ganó. El id de una entrada existente no cambia.
pub(crate) const UPSERT_ENTRY: &str = "INSERT INTO diary_entries \
     (id, local_date, content, tags, written, save_id, updated_at) \
     VALUES (?1, ?2, ?3, ?4, ?6, ?7, ?8) \
     ON CONFLICT (local_date) DO UPDATE SET content = excluded.content, \
     tags = CASE WHEN ?5 THEN diary_entries.tags ELSE excluded.tags END, \
     written = excluded.written, save_id = excluded.save_id, updated_at = excluded.updated_at \
     WHERE diary_entries.save_id = ?9 RETURNING id";
/// ?1 XP · ?2 usuario · ?3 día · ?4 `save_id`
pub(crate) const ENTRY_USER: &str = "UPDATE users SET xp = xp + ?1 WHERE id = ?2 AND ?1 > 0 \
     AND EXISTS (SELECT 1 FROM diary_entries e WHERE e.local_date = ?3 AND e.save_id = ?4 \
     AND e.written = 1 AND NOT EXISTS (SELECT 1 FROM xp_log WHERE mark_id = e.id))";
/// ?1 id · ?2 XP · ?3 día · ?4 `save_id` · ?5 instante
pub(crate) const ENTRY_GRANT: &str = "INSERT INTO xp_log \
     (id, source, source_id, amount, created_at, mark_id) \
     SELECT ?1, 'diary', e.id, ?2, ?5, e.id FROM diary_entries e \
     WHERE ?2 > 0 AND e.local_date = ?3 AND e.save_id = ?4 AND e.written = 1 \
     AND NOT EXISTS (SELECT 1 FROM xp_log WHERE mark_id = e.id)";
/// ?1 instante · ?2 claves (arreglo JSON) · ?3 día · ?4 `save_id`. Como `UNLOCK_ACHIEVEMENTS`, pero
/// solo si este guardado ganó.
pub(crate) const ENTRY_UNLOCK: &str = "UPDATE achievements SET unlocked_at = ?1 \
     WHERE unlocked_at IS NULL AND key IN (SELECT value FROM json_each(?2)) \
     AND EXISTS (SELECT 1 FROM diary_entries WHERE local_date = ?3 AND save_id = ?4) \
     RETURNING key, name, icon";
/// ?1 día
const CONFLICT_COUNT: &str = "SELECT COUNT(*) AS v FROM diary_conflicts WHERE local_date = ?1";
/// ?1 día · ?2 id del cliente: la concesión es por id de la entrada, la que haya o la nueva.
const GRANTED: &str = "SELECT EXISTS (SELECT 1 FROM xp_log WHERE mark_id = \
     COALESCE((SELECT id FROM diary_entries WHERE local_date = ?1), ?2)) AS v";
/// ?1 día: escritas sin contar la de este día, que la decide el dominio.
const WRITTEN_OTHERS: &str = "SELECT COUNT(*) AS v FROM diary_entries \
     WHERE written = 1 AND local_date != ?1";

/// Intentos ante un guardado que gana en medio. Más de uno seguido en el mismo día es raro: es la
/// misma persona en otro dispositivo.
const ATTEMPTS: usize = 3;

#[worker::send]
pub async fn save(
    State(s): State<AppState>,
    Path(date): Path<String>,
    json: Result<Json<SaveBody>, JsonRejection>,
) -> Result<Json<SaveOut>, AppError> {
    let day = parse_day(&date)?.to_string();
    let b = body(json)?;
    let id = parse_uuid(&b.id)?;
    let save_id = parse_uuid(&b.save_id)?;
    let base = b.base_save_id.as_deref().map(parse_uuid).transpose()?;
    validate(&b.content).map_err(|EntryRejected::TooLong| {
        AppError::Invalid("La entrada pasa de 200 000 caracteres".into())
    })?;
    let written = is_written(&b.content);

    for _ in 0..ATTEMPTS {
        let res =
            s.db.batch(vec![
                s.db.prepare("SELECT id, xp FROM users LIMIT 1"),
                query!(&s.db, ENTRY, day)?,
                s.db.prepare("SELECT key FROM achievements WHERE unlocked_at IS NOT NULL"),
                query!(&s.db, GRANTED, day, id)?,
                query!(&s.db, CONFLICT_COUNT, day)?,
            ])
            .await?;
        log_d1("PUT /diary: estado", &res);
        let user = res[0]
            .results::<UserRow>()?
            .pop()
            .ok_or_else(|| AppError::Internal("no hay usuario".into()))?;
        let current = res[1].results::<EntryRow>()?.pop();
        let unlocked: BTreeSet<String> = res[2]
            .results::<AchievementRow>()?
            .into_iter()
            .map(|r| r.key)
            .collect();
        let granted = count(&res[3])? != 0;

        let stored = current.as_ref().map(|e| Stored {
            save_id: e.save_id.as_deref().unwrap_or(""),
            content: &e.content,
        });
        let incoming = Incoming {
            save_id: &save_id,
            base_save_id: base.as_deref(),
            content: &b.content,
        };
        let decision = decide_save(stored, incoming);
        if decision == SaveDecision::Replay {
            return Ok(Json(save_out(
                current.unwrap_or_else(|| EntryRow::empty(&day)),
                count(&res[4])?,
                award_xp(user.xp, 0),
                Vec::new(),
            )));
        }

        let xp = award_xp(user.xp, xp_for_save(&b.content, granted));
        let earned = if xp.applied > 0 {
            earned_achievements(&s, &unlocked, xp.new_level, &day, written).await?
        } else {
            Vec::new()
        };

        let now = now_utc();
        let read_save_id = current.as_ref().and_then(|e| e.save_id.clone());
        let mut writes = Vec::new();
        if decision == SaveDecision::Conflict {
            writes.push(query!(
                &s.db,
                COPY_CONFLICT,
                save_id,
                day,
                read_save_id,
                now
            )?);
        }
        let upsert = writes.len();
        writes.push(query!(
            &s.db,
            UPSERT_ENTRY,
            id,
            day,
            b.content,
            b.tags,
            i64::from(b.tags.is_none()),
            i64::from(written),
            save_id,
            now,
            read_save_id
        )?);
        writes.push(query!(
            &s.db, ENTRY_USER, xp.applied, user.id, day, save_id
        )?);
        writes.push(query!(
            &s.db,
            ENTRY_GRANT,
            Uuid::now_v7().to_string(),
            xp.applied,
            day,
            save_id,
            now
        )?);
        let read_back = writes.len();
        writes.push(query!(&s.db, ENTRY, day)?);
        writes.push(query!(&s.db, CONFLICT_COUNT, day)?);
        if !earned.is_empty() {
            let earned_json =
                serde_json::to_string(&earned).map_err(|e| AppError::Internal(e.to_string()))?;
            writes.push(query!(&s.db, ENTRY_UNLOCK, now, earned_json, day, save_id)?);
        }
        let res = s.db.batch(writes).await?;
        log_d1("PUT /diary: escritura", &res);
        if res[upsert].results::<IdOnly>()?.is_empty() {
            continue; // otro guardado ganó entre la lectura y la escritura
        }
        let mut new = if earned.is_empty() {
            Vec::new()
        } else {
            res.last().unwrap().results::<UnlockedAchievement>()?
        };
        return Ok(Json(save_out(
            entry_of(&res[read_back], &day)?,
            count(&res[read_back + 1])?,
            xp,
            // RETURNING no garantiza orden: se conserva el del dominio
            earned
                .into_iter()
                .filter_map(|k| {
                    let i = new.iter().position(|r| r.key == k)?;
                    Some(new.swap_remove(i))
                })
                .collect(),
        )));
    }
    Err(AppError::Conflict(
        "El diario de ese día cambió varias veces seguidas; vuelve a intentarlo".into(),
    ))
}

fn save_out(
    entry: EntryRow,
    conflicts: i64,
    x: XpChange,
    unlocked: Vec<UnlockedAchievement>,
) -> SaveOut {
    SaveOut {
        entry,
        conflicts,
        xp_earned: x.applied,
        new_xp: x.new_xp,
        new_level: x.new_level,
        title: x.title,
        leveled_up: x.leveled_up,
        achievements_unlocked: unlocked,
    }
}

#[derive(Deserialize)]
struct IdOnly {
    #[allow(dead_code)]
    id: String,
}

/// Los logros que aún faltan y que esta entrada cumple. Solo cuenta entradas si alguno del diario
/// sigue bloqueado.
async fn earned_achievements(
    s: &AppState,
    unlocked: &BTreeSet<String>,
    level: u32,
    day: &str,
    written: bool,
) -> Result<Vec<&'static str>, AppError> {
    let written_entries = if unlocked.contains(ARCHIVIST) && unlocked.contains(DIARY_CENTURY) {
        0
    } else {
        let res =
            s.db.batch(vec![query!(&s.db, WRITTEN_OTHERS, day)?])
                .await?;
        log_d1("PUT /diary: logros", &res);
        count(&res[0])? + i64::from(written)
    };
    let mut earned = earned_on_diary(DiaryFacts {
        level,
        written_entries: written_entries as u32,
    });
    earned.retain(|k| !unlocked.contains(*k));
    Ok(earned)
}

// ---------- GET /diary/{date} ----------

#[derive(Deserialize, Serialize)]
pub struct HabitDone {
    name: String,
    color: String,
    category: String,
}

#[derive(Deserialize, Serialize)]
pub struct SessionDone {
    work_minutes: i64,
    task_title: Option<String>,
    finished_at: String,
}

/// Decisión 8: sin check-in (fila 36).
#[derive(Serialize)]
pub struct DaySummary {
    habits_done: Vec<HabitDone>,
    pomodoro_sessions: Vec<SessionDone>,
    pomodoro_minutes: i64,
    xp_earned: i64,
}

#[derive(Serialize)]
pub struct DayOut {
    entry: EntryRow,
    conflicts: Vec<ConflictRow>,
    summary: DaySummary,
}

#[derive(Deserialize)]
struct XpRow {
    amount: i64,
    created_at: String,
}

/// ?1 día
const HABITS_DONE: &str = "SELECT h.name, h.color, h.category FROM habit_logs l \
     JOIN habits h ON h.id = l.habit_id WHERE l.local_date = ?1 ORDER BY l.completed_at, l.id";
/// ?1 día
const SESSIONS_DONE: &str = "SELECT p.work_minutes, t.title AS task_title, p.finished_at \
     FROM pomodoro_sessions p LEFT JOIN tasks t ON t.id = p.task_id \
     WHERE p.local_date = ?1 AND p.completed = 1 ORDER BY p.finished_at, p.started_at, p.id";
/// ?1 desde · ?2 hasta (instantes). `xp_log` no tiene `local_date`: se trae un margen de un día a
/// cada lado y el día local de cada fila lo decide `local_date_of`, sin suponer el desfase de la zona.
const XP_AROUND: &str =
    "SELECT amount, created_at FROM xp_log WHERE created_at >= ?1 AND created_at < ?2";

/// La entrada del día, sus copias en conflicto y el resumen, en una sola request (decisión 7).
#[worker::send]
pub async fn day(
    State(s): State<AppState>,
    Path(date): Path<String>,
) -> Result<Json<DayOut>, AppError> {
    let d = parse_day(&date)?;
    let day = d.to_string();
    let from = format!("{}T00:00:00Z", d - Days::new(1));
    let to = format!("{}T00:00:00Z", d + Days::new(2));
    let res =
        s.db.batch(vec![
            query!(&s.db, ENTRY, day)?,
            query!(&s.db, CONFLICTS, day)?,
            query!(&s.db, HABITS_DONE, day)?,
            query!(&s.db, SESSIONS_DONE, day)?,
            query!(&s.db, XP_AROUND, from, to)?,
        ])
        .await?;
    log_d1("GET /diary/{date}", &res);
    let sessions: Vec<SessionDone> = res[3].results()?;
    let mut xp_earned = 0;
    for r in res[4].results::<XpRow>()? {
        if local_date_of(&r.created_at, &s.tz)? == d {
            xp_earned += r.amount;
        }
    }
    Ok(Json(DayOut {
        entry: entry_of(&res[0], &day)?,
        conflicts: res[1].results()?,
        summary: DaySummary {
            habits_done: res[2].results()?,
            pomodoro_minutes: sessions.iter().map(|x| x.work_minutes).sum(),
            pomodoro_sessions: sessions,
            xp_earned,
        },
    }))
}

// ---------- GET /diary/volume ----------

#[derive(Deserialize, Serialize)]
pub struct VolumePoint {
    local_date: String,
    length: i64,
}

#[derive(Serialize)]
pub struct VolumeOut {
    /// Entradas escritas desde el primer día de hace 11 meses, de la más antigua a la más nueva.
    points: Vec<VolumePoint>,
    /// Todas las escritas, para «N entradas en el volumen».
    total: i64,
}

#[derive(Deserialize)]
pub struct VolumeQuery {
    /// Por defecto, hoy. Lo usa la reproducción de los goldens, que tienen fechas fijas.
    today: Option<String>,
}

/// Primer día del mes de hace 11 meses: los 12 meses que dibuja `DiaryVolume` (ADR 0007).
pub(crate) fn volume_start(today: NaiveDate) -> NaiveDate {
    today.with_day(1).unwrap() - Months::new(11)
}

/// ?1 desde. `length()` cuenta caracteres.
pub(crate) const VOLUME: &str = "SELECT local_date, length(content) AS length FROM diary_entries \
     WHERE written = 1 AND local_date >= ?1 ORDER BY local_date";

#[worker::send]
pub async fn volume(
    State(s): State<AppState>,
    Query(q): Query<VolumeQuery>,
) -> Result<Json<VolumeOut>, AppError> {
    let today = match q.today.as_deref() {
        None => today(&s.tz)?,
        Some(d) => parse_day(d)?,
    };
    let res =
        s.db.batch(vec![
            query!(&s.db, VOLUME, volume_start(today).to_string())?,
            s.db.prepare("SELECT COUNT(*) AS v FROM diary_entries WHERE written = 1"),
        ])
        .await?;
    log_d1("GET /diary/volume", &res);
    Ok(Json(VolumeOut {
        points: res[0].results()?,
        total: count(&res[1])?,
    }))
}

// ---------- GET /diary/search ----------

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    q: String,
}

#[derive(Serialize)]
pub struct SearchHit {
    local_date: String,
    snippet: String,
}

#[derive(Deserialize)]
struct SearchRow {
    local_date: String,
    content: String,
}

/// Fila 38: las 50 más recientes.
const SEARCH_LIMIT: i64 = 50;
/// ?1 patrón · ?2 límite
pub(crate) const SEARCH: &str = "SELECT local_date, content FROM diary_entries \
     WHERE written = 1 AND content LIKE ?1 ESCAPE '\\' ORDER BY local_date DESC LIMIT ?2";

/// Fecha y fragmento, no el texto entero (fila 38).
#[worker::send]
pub async fn search(
    State(s): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<SearchHit>>, AppError> {
    let res =
        s.db.batch(vec![query!(
            &s.db,
            SEARCH,
            like_pattern(&q.q),
            SEARCH_LIMIT
        )?])
        .await?;
    log_d1("GET /diary/search", &res);
    Ok(Json(
        res[0]
            .results::<SearchRow>()?
            .into_iter()
            .map(|r| SearchHit {
                snippet: snippet(&r.content, &q.q),
                local_date: r.local_date,
            })
            .collect(),
    ))
}

// ---------- DELETE /diary/conflicts/{id} ----------

/// Descartar una copia. Repetirlo da 204 igual: cumple el contrato de la cola.
#[worker::send]
pub async fn discard_conflict(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let id = parse_uuid(&id)?;
    let res =
        s.db.batch(vec![query!(
            &s.db,
            "DELETE FROM diary_conflicts WHERE id = ?1",
            id
        )?])
        .await?;
    log_d1("DELETE /diary/conflicts", &res);
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    //! Las sentencias reales, contra SQLite (D1 es SQLite). Un `batch` se aplica como transacción.
    use super::*;
    use rusqlite::{Connection, OptionalExtension, params};

    const USER: &str = "00000000-0000-7000-8000-000000000001";
    const DAY: &str = "2026-03-02";

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(concat!(
            include_str!("../../../migrations/0001_init.sql"),
            include_str!("../../../migrations/0002_lives.sql"),
            include_str!("../../../migrations/0003_achievements.sql"),
            include_str!("../../../migrations/0004_undo_and_categories.sql"),
            include_str!("../../../migrations/0005_tasks.sql"),
            include_str!("../../../migrations/0006_pomodoro.sql"),
            include_str!("../../../migrations/0007_diary.sql"),
        ))
        .unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        c
    }

    /// Lo que el handler leyó: `save_id` vigente, texto y si ya pagó.
    fn read(c: &Connection, client_id: &str) -> (Option<String>, String, bool) {
        let cur: Option<(String, String)> = c
            .query_row(
                "SELECT save_id, content FROM diary_entries WHERE local_date = ?1",
                [DAY],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .unwrap();
        let granted: bool = c
            .query_row(GRANTED, params![DAY, client_id], |r| r.get(0))
            .unwrap();
        match cur {
            Some((s, t)) => (Some(s), t, granted),
            None => (None, String::new(), granted),
        }
    }

    struct Save<'a> {
        id: &'a str,
        save_id: &'a str,
        base: Option<&'a str>,
        content: &'a str,
        tags: Option<&'a str>,
    }

    /// Lo que hace `save` con un estado leído: decide con el dominio y escribe. Devuelve si ganó.
    fn write(c: &mut Connection, s: &Save, seen: &(Option<String>, String, bool)) -> bool {
        let stored = seen.0.as_deref().map(|id| Stored {
            save_id: id,
            content: &seen.1,
        });
        let decision = decide_save(
            stored,
            Incoming {
                save_id: s.save_id,
                base_save_id: s.base,
                content: s.content,
            },
        );
        if decision == SaveDecision::Replay {
            return false;
        }
        let xp = xp_for_save(s.content, seen.2);
        let now = "2026-03-02T17:00:00Z";
        let tx = c.transaction().unwrap();
        if decision == SaveDecision::Conflict {
            tx.execute(COPY_CONFLICT, params![s.save_id, DAY, seen.0, now])
                .unwrap();
        }
        let won = tx
            .prepare(UPSERT_ENTRY)
            .unwrap()
            .query(params![
                s.id,
                DAY,
                s.content,
                s.tags,
                s.tags.is_none(),
                is_written(s.content),
                s.save_id,
                now,
                seen.0
            ])
            .unwrap()
            .next()
            .unwrap()
            .is_some();
        tx.execute(ENTRY_USER, params![xp, USER, DAY, s.save_id])
            .unwrap();
        tx.execute(
            ENTRY_GRANT,
            params![format!("log-{}", s.save_id), xp, DAY, s.save_id, now],
        )
        .unwrap();
        tx.commit().unwrap();
        won
    }

    /// Reintenta como el handler: relee y decide otra vez si perdió.
    fn save(c: &mut Connection, s: &Save) {
        for _ in 0..ATTEMPTS {
            let seen = read(c, s.id);
            if write(c, s, &seen) || seen.0.as_deref() == Some(s.save_id) {
                return;
            }
        }
        panic!("no ganó en {ATTEMPTS} intentos");
    }

    fn entry(c: &Connection) -> (String, String, Option<String>, String) {
        c.query_row(
            "SELECT id, content, tags, save_id FROM diary_entries WHERE local_date = ?1",
            [DAY],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap()
    }

    fn copies(c: &Connection) -> Vec<String> {
        let mut st = c
            .prepare("SELECT content FROM diary_conflicts ORDER BY id")
            .unwrap();
        st.query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn xp(c: &Connection) -> (i64, i64) {
        let user = c
            .query_row("SELECT xp FROM users", [], |r| r.get(0))
            .unwrap();
        let log = c
            .query_row("SELECT COALESCE(SUM(amount), 0) FROM xp_log", [], |r| {
                r.get(0)
            })
            .unwrap();
        (user, log)
    }

    fn put<'a>(id: &'a str, save_id: &'a str, base: Option<&'a str>, content: &'a str) -> Save<'a> {
        Save {
            id,
            save_id,
            base,
            content,
            tags: None,
        }
    }

    /// Dos requests con el mismo `save_id`, a partir del mismo estado leído: una escritura y una
    /// concesión.
    #[test]
    fn same_save_twice_from_the_same_read_writes_and_pays_once() {
        let mut c = db();
        let s = put("e", "s1", None, "Hola");
        let seen = read(&c, "e");
        assert!(write(&mut c, &s, &seen));
        assert!(!write(&mut c, &s, &seen));
        assert_eq!(xp(&c), (5, 5));
        // y repetido con el estado nuevo, es un reintento
        let seen = read(&c, "e");
        assert!(!write(&mut c, &s, &seen));
        assert_eq!(xp(&c), (5, 5));
        assert!(copies(&c).is_empty());
    }

    /// Dos dispositivos sobre la misma base: uno guarda y el otro deja una copia de lo que pisa.
    #[test]
    fn two_devices_on_the_same_base_lose_no_text() {
        let mut c = db();
        save(&mut c, &put("e", "base", None, "Mañana"));
        let seen = read(&c, "e");
        assert!(write(
            &mut c,
            &put("e", "pc", Some("base"), "Mañana. Tarde en el PC."),
            &seen
        ));
        // el teléfono leyó lo mismo y pierde la carrera: no escribe nada
        let tel = put("e", "tel", Some("base"), "Mañana. Noche en el teléfono.");
        assert!(!write(&mut c, &tel, &seen));
        assert!(copies(&c).is_empty());
        // relee, ve un conflicto y gana; lo del PC queda aparte
        save(&mut c, &tel);
        assert_eq!(entry(&c).1, "Mañana. Noche en el teléfono.");
        assert_eq!(copies(&c), ["Mañana. Tarde en el PC."]);
        assert_eq!(xp(&c), (5, 5));
        // repetir el guardado no duplica la copia
        save(&mut c, &tel);
        assert_eq!(copies(&c).len(), 1);
    }

    /// Dos dispositivos crean el mismo día con ids distintos: una fila, con el primer id, y una
    /// concesión.
    #[test]
    fn two_devices_create_the_same_day() {
        let mut c = db();
        let empty = read(&c, "a");
        assert!(write(&mut c, &put("a", "sa", None, "Desde el PC"), &empty));
        let b = put("b", "sb", None, "Desde el teléfono");
        // leyó antes de que el PC creara la entrada
        assert!(!write(&mut c, &b, &(None, String::new(), false)));
        save(&mut c, &b);
        let (id, content, _, _) = entry(&c);
        assert_eq!((id.as_str(), content.as_str()), ("a", "Desde el teléfono"));
        assert_eq!(copies(&c), ["Desde el PC"]);
        assert_eq!(xp(&c), (5, 5));
    }

    /// Vaciar y reescribir no paga otra vez; una entrada de espacios no paga hasta tener texto.
    #[test]
    fn pays_once_when_first_written() {
        let mut c = db();
        save(&mut c, &put("e", "s1", None, "  \n\t"));
        assert_eq!(xp(&c), (0, 0));
        save(&mut c, &put("e", "s2", Some("s1"), "Ahora sí"));
        save(&mut c, &put("e", "s3", Some("s2"), ""));
        save(&mut c, &put("e", "s4", Some("s3"), "Otra vez"));
        assert_eq!(xp(&c), (5, 5));
        assert!(copies(&c).is_empty());
    }

    #[test]
    fn tags_absent_keep_and_present_replace() {
        let mut c = db();
        let mut s = put("e", "s1", None, "a");
        s.tags = Some("reflexion, foco");
        save(&mut c, &s);
        save(&mut c, &put("e", "s2", Some("s1"), "b"));
        assert_eq!(entry(&c).2.as_deref(), Some("reflexion, foco"));
        let mut s = put("e", "s3", Some("s2"), "c");
        s.tags = Some("");
        save(&mut c, &s);
        assert_eq!(entry(&c).2.as_deref(), Some(""));
    }

    #[test]
    fn written_counts_ignore_whitespace_entries() {
        let mut c = db();
        save(&mut c, &put("e", "s1", None, "   "));
        let n: i64 = c
            .query_row(WRITTEN_OTHERS, ["2026-01-01"], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        let points: i64 = c
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM ({})",
                    VOLUME.replace("?1", "'2025-01-01'")
                ),
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(points, 0);
    }

    #[test]
    fn search_treats_wildcards_literally_and_skips_unwritten() {
        let c = db();
        for (i, (d, t, w)) in [
            ("2026-02-01", "100% concentrado", 1),
            ("2026-02-02", "sin simbolos", 1),
            ("2026-02-03", "snake_case", 1),
            ("2026-02-04", "  ", 0),
        ]
        .iter()
        .enumerate()
        {
            c.execute(
                "INSERT INTO diary_entries VALUES (?1, ?2, ?3, NULL, ?4, ?1, 't')",
                params![i.to_string(), d, t, w],
            )
            .unwrap();
        }
        let hits = |q: &str| -> Vec<String> {
            let mut st = c.prepare(SEARCH).unwrap();
            st.query_map(params![like_pattern(q), SEARCH_LIMIT], |r| r.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        assert_eq!(hits("%"), ["2026-02-01"]);
        assert_eq!(hits("_"), ["2026-02-03"]);
        assert_eq!(hits("SIN"), ["2026-02-02"]);
        assert_eq!(hits(""), ["2026-02-03", "2026-02-02", "2026-02-01"]);
    }

    #[test]
    fn volume_covers_twelve_months_ending_this_month() {
        let d = |s: &str| s.parse::<NaiveDate>().unwrap();
        assert_eq!(volume_start(d("2026-11-14")), d("2025-12-01"));
        assert_eq!(volume_start(d("2026-03-31")), d("2025-04-01"));
    }
}
