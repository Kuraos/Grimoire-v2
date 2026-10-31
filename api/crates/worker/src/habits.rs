//! Rutas de hábitos. Cada request hace una lectura y, si escribe, una escritura,
//! ambas en `batch` (una sola subrequest a D1 cada una). El historial se lee en una
//! ventana de 90 días; solo los hábitos cuya racha llega al borde piden una segunda
//! lectura con su historial completo (ADR 0007).

use std::collections::{BTreeSet, HashMap};

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::NaiveDate;
use grimoire_domain::achievements::{
    MarkFacts, POLYMATH, TOTAL_DISCIPLINE, discipline_window_start, earned_on_mark,
    total_discipline as discipline_met,
};
use grimoire_domain::cadence::{Cadence, WeekdaySet, WeeklyTarget};
use grimoire_domain::habits::{
    MarkRejected, Marks, WindowedStreak, check_mark_day, current_streak, current_streak_since,
    history_window_start, mark,
};
use grimoire_domain::lives::DailyHabit;
use grimoire_domain::xp::award_xp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use worker::wasm_bindgen::JsValue;
use worker::{D1Result, query};

use crate::{AppError, AppState, local_date_of, log_d1, now_utc, today};

const HABIT_COLUMNS: &str = "id, name, category, frequency, days, target_per_week, \
     xp_reward, color, notes, tags, created_at";

#[derive(Debug, Deserialize, Serialize)]
pub struct Habit {
    id: String,
    name: String,
    category: String,
    frequency: String,
    days: Option<String>,
    target_per_week: u8,
    xp_reward: u32,
    color: String,
    notes: Option<String>,
    tags: Option<String>,
    created_at: String,
}

impl Habit {
    fn cadence(&self) -> Result<Cadence, AppError> {
        // sin el id: los logs llevan métricas, no datos
        let corrupt = |what| AppError::Internal(format!("hábito con {what} inválido"));
        Ok(match self.frequency.as_str() {
            "weekly" => Cadence::Weekly {
                target: WeeklyTarget::new(self.target_per_week)
                    .map_err(|_| corrupt("target_per_week"))?,
            },
            _ => Cadence::Daily {
                days: WeekdaySet::parse(self.days.as_deref().unwrap_or(""))
                    .map_err(|_| corrupt("days"))?,
            },
        })
    }
}

#[derive(Deserialize)]
struct LogRow {
    habit_id: String,
    local_date: String,
}

/// Marcas de un hábito en una sola fila: `group_concat(local_date)` (ADR 0007).
#[derive(Deserialize)]
struct MarksRow {
    habit_id: String,
    dates: Option<String>,
}

#[derive(Deserialize)]
struct UserRow {
    id: String,
    xp: i64,
}

pub(crate) fn parse_date(s: &str) -> Result<NaiveDate, AppError> {
    s.parse()
        .map_err(|_| AppError::Internal("local_date inválida en la base".into()))
}

/// `"2026-10-27,2026-10-28"` → conjunto de fechas. `None` (sin marcas) → vacío.
fn parse_marks(dates: Option<&str>) -> Result<Marks, AppError> {
    dates
        .unwrap_or("")
        .split(',')
        .filter(|d| !d.is_empty())
        .map(parse_date)
        .collect()
}

/// Filas `MarksRow` → marcas por hábito.
pub(crate) fn marks_by_habit(res: &D1Result) -> Result<HashMap<String, Marks>, AppError> {
    res.results::<MarksRow>()?
        .into_iter()
        .map(|r| Ok((r.habit_id, parse_marks(r.dates.as_deref())?)))
        .collect()
}

/// Historial completo de los hábitos cuya racha llegó al borde de la ventana
/// (ADR 0007). Una sola consulta para todos.
// ponytail: un parámetro por hábito; D1 admite 100 por consulta, partir en bloques
// si algún día hay más de 100 hábitos con rachas de más de 90 días
async fn read_full_marks(
    s: &AppState,
    what: &str,
    habit_ids: &[&str],
) -> Result<HashMap<String, Marks>, AppError> {
    let placeholders: Vec<String> = (1..=habit_ids.len()).map(|i| format!("?{i}")).collect();
    let params: Vec<JsValue> = habit_ids.iter().map(|id| JsValue::from_str(id)).collect();
    let res =
        s.db.prepare(format!(
            "SELECT habit_id, group_concat(local_date) AS dates FROM habit_logs \
             WHERE habit_id IN ({}) GROUP BY habit_id",
            placeholders.join(", ")
        ))
        .bind(&params)?
        .all()
        .await?;
    log_d1(what, std::slice::from_ref(&res));
    marks_by_habit(&res)
}

fn parse_uuid(s: &str) -> Result<String, AppError> {
    Uuid::parse_str(s)
        .map(|u| u.hyphenated().to_string())
        .map_err(|_| AppError::Invalid(format!("«{s}» no es un UUID")))
}

fn body<T>(json: Result<Json<T>, JsonRejection>) -> Result<T, AppError> {
    json.map(|Json(t)| t)
        .map_err(|e| AppError::Invalid(format!("Cuerpo inválido: {}", e.body_text())))
}

// ---------- GET /habits ----------

#[derive(Serialize)]
pub struct HabitWithStreak {
    #[serde(flatten)]
    habit: Habit,
    streak: u32,
    done_today: bool,
}

#[worker::send]
pub async fn list(State(s): State<AppState>) -> Result<Json<Vec<HabitWithStreak>>, AppError> {
    let today = today(&s.tz)?;
    let from = history_window_start(today);
    let res =
        s.db.batch(vec![
            s.db.prepare(format!(
                "SELECT {HABIT_COLUMNS} FROM habits WHERE active = 1 ORDER BY created_at"
            )),
            query!(
                &s.db,
                "SELECT habit_id, group_concat(local_date) AS dates FROM habit_logs \
                 WHERE habit_id IN (SELECT id FROM habits WHERE active = 1) \
                 AND local_date >= ?1 GROUP BY habit_id",
                from.to_string()
            )?,
        ])
        .await?;
    log_d1("GET /habits: ventana", &res);
    let habits: Vec<Habit> = res[0].results()?;
    let mut marks = marks_by_habit(&res[1])?;

    let empty = Marks::new();
    let mut at_edge = Vec::new();
    for h in &habits {
        let m = marks.get(&h.id).unwrap_or(&empty);
        if current_streak_since(h.cadence()?, m, today, from) == WindowedStreak::AtEdge {
            at_edge.push(h.id.as_str());
        }
    }
    if !at_edge.is_empty() {
        let full = read_full_marks(&s, "GET /habits: ampliación", &at_edge).await?;
        marks.extend(full);
    }

    habits
        .into_iter()
        .map(|habit| {
            let m = marks.get(&habit.id).unwrap_or(&empty);
            Ok(HabitWithStreak {
                streak: current_streak(habit.cadence()?, m, today),
                done_today: m.contains(&today),
                habit,
            })
        })
        .collect::<Result<_, _>>()
        .map(Json)
}

// ---------- POST /habits ----------

#[derive(Deserialize)]
pub struct NewHabit {
    id: String,
    name: String,
    category: String,
    #[serde(default)]
    frequency: Frequency,
    days: Option<String>,
    #[serde(default = "one")]
    target_per_week: u8,
    #[serde(default = "twenty")]
    xp_reward: u32,
    color: Option<String>,
    notes: Option<String>,
    tags: Option<String>,
}

#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Frequency {
    #[default]
    Daily,
    Weekly,
}

fn one() -> u8 {
    1
}

fn twenty() -> u32 {
    20
}

/// Crea un hábito con el ID que manda el cliente. Repetir el ID devuelve el hábito
/// existente (200) en vez de duplicarlo; crearlo devuelve 201.
#[worker::send]
pub async fn create(
    State(s): State<AppState>,
    json: Result<Json<NewHabit>, JsonRejection>,
) -> Result<(StatusCode, Json<Habit>), AppError> {
    let h = body(json)?;
    let id = parse_uuid(&h.id)?;
    let name = h.name.trim();
    let category = h.category.trim();
    if name.is_empty() || category.is_empty() {
        return Err(AppError::Invalid(
            "El nombre y la categoría son obligatorios".into(),
        ));
    }
    if !(10..=100).contains(&h.xp_reward) {
        return Err(AppError::Invalid("El XP debe estar entre 10 y 100".into()));
    }
    WeeklyTarget::new(h.target_per_week)
        .map_err(|_| AppError::Invalid("La meta semanal debe estar entre 1 y 7".into()))?;
    let days = WeekdaySet::parse(h.days.as_deref().unwrap_or(""))
        .map_err(|e| {
            AppError::Invalid(format!("Día inválido: «{}» (0 = lunes … 6 = domingo)", e.0))
        })?
        .map(|d| d.to_string());
    let frequency = match h.frequency {
        Frequency::Daily => "daily",
        Frequency::Weekly => "weekly",
    };

    let res =
        s.db.batch(vec![
            query!(
                &s.db,
                "INSERT INTO habits (id, name, category, frequency, days, target_per_week, \
                 xp_reward, color, notes, tags, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(?8, '#9b7fc4'), ?9, ?10, ?11) \
                 ON CONFLICT (id) DO NOTHING",
                id,
                name,
                category,
                frequency,
                days,
                h.target_per_week,
                h.xp_reward,
                h.color,
                h.notes,
                h.tags,
                now_utc()
            )?,
            query!(
                &s.db,
                &format!("SELECT {HABIT_COLUMNS} FROM habits WHERE id = ?1"),
                id
            )?,
        ])
        .await?;
    let created = res[0].meta()?.and_then(|m| m.changes).unwrap_or(0) > 0;
    let habit = res[1]
        .results::<Habit>()?
        .pop()
        .ok_or_else(|| AppError::Internal("hábito recién creado no encontrado".into()))?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(habit)))
}

// ---------- POST /habits/{id}/complete ----------

#[derive(Deserialize)]
pub struct CompleteBody {
    /// ID de la marca, generado por el cliente.
    id: String,
    /// Día de la marca (ADR 0005). Por defecto, hoy.
    local_date: Option<String>,
}

#[derive(Serialize)]
pub struct CompleteOut {
    xp_earned: i64,
    new_xp: i64,
    new_level: u32,
    title: &'static str,
    leveled_up: bool,
    streak: u32,
    /// Claves de los logros que desbloqueó esta marca (fila 4 de las diferencias).
    achievements_unlocked: Vec<String>,
}

/// ?1 instante · ?2 claves cumplidas (arreglo JSON). Devuelve solo las nuevas; así, dos
/// marcas concurrentes no informan el mismo logro.
pub(crate) const UNLOCK_ACHIEVEMENTS: &str = "UPDATE achievements SET unlocked_at = ?1 \
     WHERE unlocked_at IS NULL AND key IN (SELECT value FROM json_each(?2)) RETURNING key";

#[derive(Deserialize)]
struct AchievementRow {
    key: String,
}

#[derive(Deserialize)]
struct CountRow {
    n: usize,
}

#[derive(Deserialize)]
struct DisciplineRow {
    id: String,
    days: Option<String>,
    created_at: String,
}

fn rejection_message(r: MarkRejected, habit: &Habit) -> String {
    match r {
        MarkRejected::AlreadyDoneToday => "Este hábito ya fue completado ese día".into(),
        MarkRejected::WeeklyTargetMet if habit.target_per_week > 1 => format!(
            "Este hábito ya alcanzó su meta de {}× esta semana",
            habit.target_per_week
        ),
        MarkRejected::WeeklyTargetMet => "Este hábito ya fue completado esta semana".into(),
        MarkRejected::OutsideGraceWindow => "Solo se puede marcar hoy, ayer o anteayer".into(),
        MarkRejected::BeforeHabitCreated => "El hábito aún no existía ese día".into(),
    }
}

/// Lo que `complete` necesita leer, en un solo `batch`.
struct MarkState {
    habit: Habit,
    marks: Marks,
    user: UserRow,
    /// La marca con el ID que manda el cliente, si ya existe (en cualquier hábito).
    existing: Option<LogRow>,
    /// Logros ya desbloqueados: no se vuelven a evaluar.
    unlocked: BTreeSet<String>,
}

/// Lee la ventana de historial y la amplía si la racha del día que importa (`on`, o
/// el de la marca existente en un reintento) llega al borde (ADR 0007).
async fn read_mark_state(
    s: &AppState,
    habit_id: &str,
    log_id: &str,
    on: NaiveDate,
    today: NaiveDate,
) -> Result<MarkState, AppError> {
    // la ventana cubre de sobra la semana de `on` (gracia de 2 días + 7)
    let from = history_window_start(today);
    let res =
        s.db.batch(vec![
            query!(
                &s.db,
                &format!("SELECT {HABIT_COLUMNS} FROM habits WHERE id = ?1 AND active = 1"),
                habit_id
            )?,
            query!(
                &s.db,
                "SELECT habit_id, group_concat(local_date) AS dates FROM habit_logs \
                 WHERE habit_id = ?1 AND local_date >= ?2 GROUP BY habit_id",
                habit_id,
                from.to_string()
            )?,
            s.db.prepare("SELECT id, xp FROM users LIMIT 1"),
            query!(
                &s.db,
                "SELECT habit_id, local_date FROM habit_logs WHERE id = ?1",
                log_id
            )?,
            s.db.prepare("SELECT key FROM achievements WHERE unlocked_at IS NOT NULL"),
        ])
        .await?;
    log_d1("complete: ventana", &res);
    let mut st = MarkState {
        habit: res[0]
            .results::<Habit>()?
            .pop()
            .ok_or(AppError::NotFound("Hábito no encontrado"))?,
        marks: parse_marks(
            res[1]
                .results::<MarksRow>()?
                .pop()
                .and_then(|r| r.dates)
                .as_deref(),
        )?,
        user: res[2]
            .results::<UserRow>()?
            .pop()
            .ok_or_else(|| AppError::Internal("no hay usuario".into()))?,
        existing: res[3].results::<LogRow>()?.pop(),
        unlocked: res[4]
            .results::<AchievementRow>()?
            .into_iter()
            .map(|r| r.key)
            .collect(),
    };
    let day = match &st.existing {
        Some(e) => parse_date(&e.local_date)?,
        None => on,
    };
    // la respuesta da la racha real de hoy (caracterizacion-v1.md, fila 6); el
    // multiplicador, la del día de la marca: hacen falta exactas las dos
    let cadence = st.habit.cadence()?;
    if [day, today]
        .into_iter()
        .any(|d| current_streak_since(cadence, &st.marks, d, from) == WindowedStreak::AtEdge)
    {
        st.marks = read_full_marks(s, "complete: ampliación", &[habit_id])
            .await?
            .remove(habit_id)
            .unwrap_or_default();
    }
    Ok(st)
}

/// Reintento de una marca ya guardada (ADR 0004): 200 con el estado actual y sin
/// sumar XP. La racha es la real de hoy, como en la primera respuesta.
fn replay(
    st: &MarkState,
    existing: &LogRow,
    today: NaiveDate,
) -> Result<Json<CompleteOut>, AppError> {
    if existing.habit_id != st.habit.id {
        return Err(AppError::Conflict(
            "Ese id de marca ya pertenece a otro hábito".into(),
        ));
    }
    let xp = award_xp(st.user.xp, 0);
    Ok(Json(CompleteOut {
        xp_earned: 0,
        new_xp: xp.new_xp,
        new_level: xp.new_level,
        title: xp.title,
        leveled_up: false,
        streak: current_streak(st.habit.cadence()?, &st.marks, today),
        achievements_unlocked: Vec::new(),
    }))
}

/// Los logros nuevos que deja la marca del día `on`. Solo corre para una marca aceptada.
/// La racha es la del hábito marcado, ya calculada: marcar H no cambia la de los demás
/// (caracterizacion-v1.md, fila 8). `polymath` y `total_discipline` solo leen mientras
/// estén bloqueados, y lo justo: el conteo de categorías y 7 días de marcas (ADR 0007).
async fn earned_achievements(
    s: &AppState,
    st: &MarkState,
    on: NaiveDate,
    today: NaiveDate,
    streak: u32,
    level: u32,
) -> Result<Vec<&'static str>, AppError> {
    let check_polymath = !st.unlocked.contains(POLYMATH);
    let check_discipline = !st.unlocked.contains(TOTAL_DISCIPLINE);
    let mut reads = Vec::new();
    if check_polymath {
        reads.push(
            s.db.prepare("SELECT COUNT(DISTINCT category) AS n FROM habits WHERE active = 1"),
        );
    }
    if check_discipline {
        reads.push(s.db.prepare(
            "SELECT id, days, created_at FROM habits WHERE active = 1 AND frequency = 'daily'",
        ));
        reads.push(query!(
            &s.db,
            "SELECT habit_id, group_concat(local_date) AS dates FROM habit_logs              WHERE habit_id IN (SELECT id FROM habits WHERE active = 1 AND frequency = 'daily')              AND local_date >= ?1 GROUP BY habit_id",
            discipline_window_start(today).to_string()
        )?);
    }
    let res = if reads.is_empty() {
        Vec::new()
    } else {
        s.db.batch(reads).await?
    };
    log_d1("complete: logros", &res);
    let mut res = res.into_iter();

    let active_categories = if check_polymath {
        let counted = res.next().unwrap().results::<CountRow>()?.pop();
        counted.map_or(0, |c| c.n)
    } else {
        0
    };
    let total_discipline = if check_discipline {
        let habits = res.next().unwrap().results::<DisciplineRow>()?;
        let mut marks = marks_by_habit(&res.next().unwrap())?;
        marks.entry(st.habit.id.clone()).or_default().insert(on);
        let empty = Marks::new();
        let mut daily = Vec::new();
        for h in &habits {
            daily.push(DailyHabit {
                id: &h.id,
                days: WeekdaySet::parse(h.days.as_deref().unwrap_or(""))
                    .map_err(|_| AppError::Internal("hábito con days inválido".into()))?,
                created_on: local_date_of(&h.created_at, &s.tz)?,
                marks: marks.get(&h.id).unwrap_or(&empty),
            });
        }
        discipline_met(&daily, today)
    } else {
        false
    };

    let mut earned = earned_on_mark(MarkFacts {
        level,
        streak,
        active_categories,
        total_discipline,
    });
    earned.retain(|k| !st.unlocked.contains(*k));
    Ok(earned)
}

#[worker::send]
pub async fn complete(
    State(s): State<AppState>,
    Path(habit_id): Path<String>,
    json: Result<Json<CompleteBody>, JsonRejection>,
) -> Result<Json<CompleteOut>, AppError> {
    let b = body(json)?;
    let habit_id = parse_uuid(&habit_id)?;
    let log_id = parse_uuid(&b.id)?;
    let today = today(&s.tz)?;
    let on = match b.local_date.as_deref() {
        None => today,
        Some(d) => d
            .parse()
            .map_err(|_| AppError::Invalid(format!("Fecha inválida: «{d}» (YYYY-MM-DD)")))?,
    };

    let st = read_mark_state(&s, &habit_id, &log_id, on, today).await?;
    // antes de validar el día: un reintento de una marca vieja sigue siendo 200
    if let Some(existing) = &st.existing {
        return replay(&st, existing, today);
    }

    let reject = |r| AppError::Conflict(rejection_message(r, &st.habit));
    let created_on = local_date_of(&st.habit.created_at, &s.tz)?;
    check_mark_day(on, today, created_on).map_err(reject)?;
    let done = mark(
        st.habit.cadence()?,
        &st.marks,
        on,
        today,
        st.habit.xp_reward,
    )
    .map_err(reject)?;
    let xp = award_xp(st.user.xp, done.xp);
    let earned = earned_achievements(&s, &st, on, today, done.streak, xp.new_level).await?;

    let now = now_utc();
    let mut writes = vec![
        query!(
            &s.db,
            "INSERT INTO habit_logs (id, habit_id, local_date, completed_at) VALUES (?1, ?2, ?3, ?4)",
            log_id,
            habit_id,
            on.to_string(),
            now
        )?,
        // relativo, no absoluto: otra marca concurrente no pisa este XP
        query!(
            &s.db,
            "UPDATE users SET xp = MAX(0, xp + ?1) WHERE id = ?2",
            xp.applied,
            st.user.id
        )?,
    ];
    if xp.applied != 0 {
        writes.push(query!(
            &s.db,
            "INSERT INTO xp_log (id, source, source_id, amount, created_at)              VALUES (?1, 'habit', ?2, ?3, ?4)",
            Uuid::now_v7().to_string(),
            habit_id,
            xp.applied,
            now
        )?);
    }
    if !earned.is_empty() {
        let earned_json =
            serde_json::to_string(&earned).map_err(|e| AppError::Internal(e.to_string()))?;
        writes.push(query!(&s.db, UNLOCK_ACHIEVEMENTS, now, earned_json)?);
    }
    // batch = transacción: si una restricción rechaza la marca, no se suma XP ni se
    // desbloquea nada
    let new = match s.db.batch(writes).await {
        Ok(res) => {
            log_d1("complete: escritura", &res);
            if earned.is_empty() {
                Vec::new()
            } else {
                res.last().unwrap().results::<AchievementRow>()?
            }
        }
        Err(e) => {
            let msg = e.to_string();
            return if msg.contains("UNIQUE constraint failed: habit_logs.id:") {
                // un reintento con el mismo ID ganó la carrera: responder como reintento
                let st = read_mark_state(&s, &habit_id, &log_id, on, today).await?;
                match &st.existing {
                    Some(existing) => replay(&st, existing, today),
                    None => Err(AppError::Internal(msg)),
                }
            } else if msg
                .contains("UNIQUE constraint failed: habit_logs.habit_id, habit_logs.local_date")
            {
                Err(reject(MarkRejected::AlreadyDoneToday))
            } else {
                Err(e.into())
            };
        }
    };

    Ok(Json(CompleteOut {
        xp_earned: xp.applied,
        new_xp: xp.new_xp,
        new_level: xp.new_level,
        title: xp.title,
        leveled_up: xp.leveled_up,
        streak: done.streak,
        // RETURNING no garantiza orden: se conserva el del dominio
        achievements_unlocked: earned
            .into_iter()
            .filter(|k| new.iter().any(|r| r.key == *k))
            .map(str::to_owned)
            .collect(),
    }))
}

#[cfg(test)]
mod tests {
    //! La sentencia real de desbloquear y el catálogo sembrado, contra SQLite.
    use super::UNLOCK_ACHIEVEMENTS;
    use rusqlite::{Connection, params};

    fn unlock(c: &Connection, keys: &str) -> Vec<String> {
        let mut q = c.prepare(UNLOCK_ACHIEVEMENTS).unwrap();
        q.query_map(params!["2026-03-05T12:00:00Z", keys], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn unlocks_only_what_is_still_locked() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../../../migrations/0003_achievements.sql"))
            .unwrap();
        let locked: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM achievements WHERE unlocked_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(locked, 34, "catálogo completo de la v1");

        assert_eq!(unlock(&c, r#"["first_blood"]"#), ["first_blood"]);
        let mut second = unlock(&c, r#"["first_blood","polymath","no_existe"]"#);
        second.sort();
        assert_eq!(second, ["polymath"]);
        assert!(unlock(&c, r#"["first_blood","polymath"]"#).is_empty());
    }
}
