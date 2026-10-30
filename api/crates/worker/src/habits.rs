//! Rutas de hábitos. Cada request hace una lectura y, si escribe, una escritura,
//! ambas en `batch` (una sola subrequest a D1 cada una).

use std::collections::HashMap;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::NaiveDate;
use grimoire_domain::cadence::{Cadence, WeekdaySet, WeeklyTarget};
use grimoire_domain::habits::{MarkRejected, Marks, check_mark_day, current_streak, mark};
use grimoire_domain::xp::award_xp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use worker::query;

use crate::{AppError, AppState, local_date_of, now_utc, today};

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
        let corrupt = |what| AppError::Internal(format!("hábito {}: {what} inválido", self.id));
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

#[derive(Deserialize)]
struct UserRow {
    id: String,
    xp: i64,
}

fn parse_date(s: &str) -> Result<NaiveDate, AppError> {
    s.parse()
        .map_err(|_| AppError::Internal(format!("local_date inválida: {s}")))
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
    let res =
        s.db.batch(vec![
            s.db.prepare(format!(
                "SELECT {HABIT_COLUMNS} FROM habits WHERE active = 1 ORDER BY created_at"
            )),
            s.db.prepare(
                "SELECT l.habit_id, l.local_date FROM habit_logs l \
                 JOIN habits h ON h.id = l.habit_id WHERE h.active = 1",
            ),
        ])
        .await?;
    let habits: Vec<Habit> = res[0].results()?;
    let mut marks: HashMap<String, Marks> = HashMap::new();
    for row in res[1].results::<LogRow>()? {
        marks
            .entry(row.habit_id)
            .or_default()
            .insert(parse_date(&row.local_date)?);
    }

    let empty = Marks::new();
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
}

async fn read_mark_state(
    s: &AppState,
    habit_id: &str,
    log_id: &str,
) -> Result<MarkState, AppError> {
    let res =
        s.db.batch(vec![
            query!(
                &s.db,
                &format!("SELECT {HABIT_COLUMNS} FROM habits WHERE id = ?1 AND active = 1"),
                habit_id
            )?,
            query!(
                &s.db,
                "SELECT habit_id, local_date FROM habit_logs WHERE habit_id = ?1",
                habit_id
            )?,
            s.db.prepare("SELECT id, xp FROM users LIMIT 1"),
            query!(
                &s.db,
                "SELECT habit_id, local_date FROM habit_logs WHERE id = ?1",
                log_id
            )?,
        ])
        .await?;
    Ok(MarkState {
        habit: res[0]
            .results::<Habit>()?
            .pop()
            .ok_or(AppError::NotFound("Hábito no encontrado"))?,
        marks: res[1]
            .results::<LogRow>()?
            .iter()
            .map(|r| parse_date(&r.local_date))
            .collect::<Result<_, _>>()?,
        user: res[2]
            .results::<UserRow>()?
            .pop()
            .ok_or_else(|| AppError::Internal("no hay usuario".into()))?,
        existing: res[3].results::<LogRow>()?.pop(),
    })
}

/// Reintento de una marca ya guardada (ADR 0004): 200 con el estado actual y sin
/// sumar XP. La racha es la del día de esa marca, la misma que se respondió la
/// primera vez si nada cambió antes de ese día.
fn replay(st: &MarkState, existing: &LogRow) -> Result<Json<CompleteOut>, AppError> {
    if existing.habit_id != st.habit.id {
        return Err(AppError::Conflict(
            "Ese id de marca ya pertenece a otro hábito".into(),
        ));
    }
    let on = parse_date(&existing.local_date)?;
    let xp = award_xp(st.user.xp, 0);
    Ok(Json(CompleteOut {
        xp_earned: 0,
        new_xp: xp.new_xp,
        new_level: xp.new_level,
        title: xp.title,
        leveled_up: false,
        streak: current_streak(st.habit.cadence()?, &st.marks, on),
    }))
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

    let st = read_mark_state(&s, &habit_id, &log_id).await?;
    // antes de validar el día: un reintento de una marca vieja sigue siendo 200
    if let Some(existing) = &st.existing {
        return replay(&st, existing);
    }

    let reject = |r| AppError::Conflict(rejection_message(r, &st.habit));
    let created_on = local_date_of(&st.habit.created_at, &s.tz)?;
    check_mark_day(on, today, created_on).map_err(reject)?;
    let done = mark(st.habit.cadence()?, &st.marks, on, st.habit.xp_reward).map_err(reject)?;
    let xp = award_xp(st.user.xp, done.xp);

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
    // batch = transacción: si una restricción rechaza la marca, no se suma XP
    if let Err(e) = s.db.batch(writes).await {
        let msg = e.to_string();
        return if msg.contains("UNIQUE constraint failed: habit_logs.id:") {
            // un reintento con el mismo ID ganó la carrera: responder como reintento
            let st = read_mark_state(&s, &habit_id, &log_id).await?;
            match &st.existing {
                Some(existing) => replay(&st, existing),
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

    Ok(Json(CompleteOut {
        xp_earned: xp.applied,
        new_xp: xp.new_xp,
        new_level: xp.new_level,
        title: xp.title,
        leveled_up: xp.leveled_up,
        streak: done.streak,
    }))
}
