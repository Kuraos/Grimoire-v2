//! Rutas de hábitos. Cada request hace una lectura y, si escribe, una escritura,
//! ambas en `batch` (una sola subrequest a D1 cada una). El historial se lee en una
//! ventana de 90 días; solo los hábitos cuya racha llega al borde piden una segunda
//! lectura con su historial completo (ADR 0007).

use std::collections::{BTreeSet, HashMap};

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use chrono::NaiveDate;
use grimoire_domain::achievements::{
    MarkFacts, POLYMATH, TOTAL_DISCIPLINE, discipline_window_start, earned_on_mark,
    total_discipline as discipline_met,
};
use grimoire_domain::cadence::{Cadence, WeekdaySet, WeeklyTarget};
use grimoire_domain::habits::{
    MarkRejected, Marks, WindowedStreak, best_streak, check_mark_day, check_undo, current_streak,
    current_streak_since, heatmap_window_start, history_window_start, mark, recent_completion_rate,
};
use grimoire_domain::lives::DailyHabit;
use grimoire_domain::xp::award_xp;
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;
use worker::wasm_bindgen::JsValue;
use worker::{D1Result, query};

use crate::{AppError, AppState, local_date_of, log_d1, now_utc, today};

const HABIT_COLUMNS: &str = "id, name, category, frequency, days, target_per_week, \
     xp_reward, color, active, notes, tags, created_at";

/// ?1 id nuevo · ?2 hábito. La categoría del hábito siempre está en el catálogo (v1:
/// `_ensure_category`).
pub(crate) const ENSURE_CATEGORY: &str = "INSERT INTO habit_categories (id, name, color) \
     SELECT ?1, category, color FROM habits WHERE id = ?2 ON CONFLICT (name) DO NOTHING";

pub(crate) fn int_bool<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(u8::deserialize(d)? != 0)
}

/// Distingue en un PATCH «no vino» (`None`) de «vino null» (`Some(None)`).
pub(crate) fn present<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

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
    #[serde(deserialize_with = "int_bool")]
    active: bool,
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
pub(crate) struct UserRow {
    pub id: String,
    pub xp: i64,
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

pub(crate) fn parse_uuid(s: &str) -> Result<String, AppError> {
    Uuid::parse_str(s)
        .map(|u| u.hyphenated().to_string())
        .map_err(|_| AppError::Invalid(format!("«{s}» no es un UUID")))
}

pub(crate) fn body<T>(json: Result<Json<T>, JsonRejection>) -> Result<T, AppError> {
    json.map(|Json(t)| t)
        .map_err(|e| AppError::Invalid(format!("Cuerpo inválido: {}", e.body_text())))
}

// ---------- GET /habits ----------

#[derive(Serialize)]
struct LastMark {
    id: String,
    local_date: String,
}

#[derive(Serialize)]
pub struct HabitWithStreak {
    #[serde(flatten)]
    habit: Habit,
    streak: u32,
    done_today: bool,
    completion_rate: f64,
    /// La última marca, para deshacerla. `null` si no hay ninguna en la ventana de 90
    /// días: una más vieja ya no se puede deshacer.
    last_mark: Option<LastMark>,
}

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(default)]
    include_archived: bool,
}

/// Una fila por hábito. Con un solo `MAX`, SQLite toma `id` de la fila del máximo.
#[derive(Deserialize)]
struct WindowRow {
    habit_id: String,
    dates: Option<String>,
    last_id: String,
    last_date: String,
}

#[worker::send]
pub async fn list(
    State(s): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<HabitWithStreak>>, AppError> {
    let today = today(&s.tz)?;
    let from = history_window_start(today);
    let archived = i32::from(params.include_archived);
    let res =
        s.db.batch(vec![
            query!(
                &s.db,
                &format!(
                    "SELECT {HABIT_COLUMNS} FROM habits WHERE ?1 = 1 OR active = 1 \
                     ORDER BY category, name"
                ),
                archived
            )?,
            query!(
                &s.db,
                "SELECT habit_id, group_concat(local_date) AS dates, id AS last_id, \
                 MAX(local_date) AS last_date FROM habit_logs \
                 WHERE habit_id IN (SELECT id FROM habits WHERE ?1 = 1 OR active = 1) \
                 AND local_date >= ?2 GROUP BY habit_id",
                archived,
                from.to_string()
            )?,
        ])
        .await?;
    log_d1("GET /habits: ventana", &res);
    let habits: Vec<Habit> = res[0].results()?;
    let mut marks = HashMap::new();
    let mut last_marks = HashMap::new();
    for r in res[1].results::<WindowRow>()? {
        marks.insert(r.habit_id.clone(), parse_marks(r.dates.as_deref())?);
        last_marks.insert(
            r.habit_id,
            LastMark {
                id: r.last_id,
                local_date: r.last_date,
            },
        );
    }

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
            let cadence = habit.cadence()?;
            let created_on = local_date_of(&habit.created_at, &s.tz)?;
            Ok(HabitWithStreak {
                streak: current_streak(cadence, m, today),
                done_today: m.contains(&today),
                completion_rate: recent_completion_rate(cadence, m, created_on, today),
                last_mark: last_marks.remove(&habit.id),
                habit,
            })
        })
        .collect::<Result<_, _>>()
        .map(Json)
}

// ---------- GET /habits/heatmap ----------

#[derive(Deserialize, Serialize)]
pub struct HeatDay {
    date: String,
    count: u32,
}

/// ?1 primer día. El filtro por hábito es lo que deja usar el índice `(habit_id, local_date)`
/// y leer solo la ventana.
const HEATMAP: &str = "SELECT local_date AS date, COUNT(*) AS count FROM habit_logs \
     WHERE habit_id IN (SELECT id FROM habits) AND local_date >= ?1 \
     GROUP BY local_date ORDER BY local_date";

/// Marcas por día de las 53 semanas de la rejilla, archivados incluidos (v1: `GET /stats`).
#[worker::send]
pub async fn heatmap(State(s): State<AppState>) -> Result<Json<Vec<HeatDay>>, AppError> {
    let from = heatmap_window_start(today(&s.tz)?);
    let res = query!(&s.db, HEATMAP, from.to_string())?.all().await?;
    log_d1("GET /habits/heatmap", std::slice::from_ref(&res));
    Ok(Json(res.results()?))
}

// ---------- GET /habits/{id} ----------

#[derive(Deserialize, Serialize)]
struct MarkOut {
    id: String,
    local_date: String,
    completed_at: String,
}

#[derive(Deserialize)]
struct XpRow {
    amount: i64,
    created_at: String,
}

#[derive(Serialize)]
struct XpPoint {
    date: String,
    xp: i64,
}

#[derive(Serialize)]
pub struct HabitDetail {
    #[serde(flatten)]
    habit: Habit,
    streak: u32,
    best_streak: u32,
    done_today: bool,
    completion_rate: f64,
    total_xp: i64,
    last_completed: Option<String>,
    last_mark: Option<LastMark>,
    /// De la más reciente a la más vieja.
    marks: Vec<MarkOut>,
    /// XP acumulado por movimiento, deshacer incluido (v1: `/xp-series`).
    xp_series: Vec<XpPoint>,
}

/// Lee el historial completo de **un** hábito, una fila por marca (ADR 0007).
#[worker::send]
pub async fn detail(
    State(s): State<AppState>,
    Path(habit_id): Path<String>,
) -> Result<Json<HabitDetail>, AppError> {
    let habit_id = parse_uuid(&habit_id)?;
    let today = today(&s.tz)?;
    let res =
        s.db.batch(vec![
            query!(
                &s.db,
                &format!("SELECT {HABIT_COLUMNS} FROM habits WHERE id = ?1"),
                habit_id
            )?,
            query!(
                &s.db,
                "SELECT id, local_date, completed_at FROM habit_logs WHERE habit_id = ?1 \
                 ORDER BY local_date DESC",
                habit_id
            )?,
            query!(
                &s.db,
                "SELECT amount, created_at FROM xp_log \
                 WHERE source = 'habit' AND source_id = ?1 ORDER BY created_at, id",
                habit_id
            )?,
        ])
        .await?;
    log_d1("GET /habits/{id}", &res);
    let habit = res[0]
        .results::<Habit>()?
        .pop()
        .ok_or(AppError::NotFound("Hábito no encontrado"))?;
    let rows: Vec<MarkOut> = res[1].results()?;
    let marks = rows
        .iter()
        .map(|m| parse_date(&m.local_date))
        .collect::<Result<Marks, _>>()?;
    let cadence = habit.cadence()?;
    let created_on = local_date_of(&habit.created_at, &s.tz)?;

    let mut total_xp = 0;
    let mut xp_series = Vec::new();
    // ponytail: un Intl por movimiento; agrupar por día si un historial largo pesa en CPU
    for r in res[2].results::<XpRow>()? {
        total_xp += r.amount;
        xp_series.push(XpPoint {
            date: local_date_of(&r.created_at, &s.tz)?.to_string(),
            xp: total_xp,
        });
    }

    Ok(Json(HabitDetail {
        streak: current_streak(cadence, &marks, today),
        best_streak: best_streak(cadence, &marks),
        done_today: marks.contains(&today),
        completion_rate: recent_completion_rate(cadence, &marks, created_on, today),
        total_xp,
        last_completed: rows.iter().map(|m| m.completed_at.clone()).max(),
        last_mark: rows.first().map(|m| LastMark {
            id: m.id.clone(),
            local_date: m.local_date.clone(),
        }),
        marks: rows,
        xp_series,
        habit,
    }))
}

// ---------- PATCH y DELETE /habits/{id} ----------

#[derive(Deserialize)]
pub struct HabitPatch {
    name: Option<String>,
    category: Option<String>,
    frequency: Option<Frequency>,
    #[serde(default, deserialize_with = "present")]
    days: Option<Option<String>>,
    target_per_week: Option<u8>,
    xp_reward: Option<u32>,
    color: Option<String>,
    #[serde(default, deserialize_with = "present")]
    notes: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    tags: Option<Option<String>>,
    /// `true` restaura un hábito archivado.
    active: Option<bool>,
}

pub(crate) fn opt_text(v: Option<&str>) -> JsValue {
    v.map_or(JsValue::NULL, JsValue::from_str)
}

/// Solo asigna los campos que vienen, así que repetirlo da lo mismo y no pisa lo que
/// otro dispositivo cambió en los demás.
#[worker::send]
pub async fn update(
    State(s): State<AppState>,
    Path(habit_id): Path<String>,
    json: Result<Json<HabitPatch>, JsonRejection>,
) -> Result<Json<Habit>, AppError> {
    let p = body(json)?;
    let habit_id = parse_uuid(&habit_id)?;
    let mut sets: Vec<(&str, JsValue)> = Vec::new();
    if let Some(name) = &p.name {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::Invalid("El nombre es obligatorio".into()));
        }
        sets.push(("name", name.into()));
    }
    let category = p.category.as_deref().map(str::trim);
    if let Some(category) = category {
        if category.is_empty() {
            return Err(AppError::Invalid("La categoría es obligatoria".into()));
        }
        sets.push(("category", category.into()));
    }
    if let Some(f) = p.frequency {
        sets.push(("frequency", f.as_str().into()));
    }
    if let Some(days) = &p.days {
        let days = parse_days(days.as_deref())?;
        sets.push(("days", opt_text(days.as_deref())));
    }
    if let Some(t) = p.target_per_week {
        check_target(t)?;
        sets.push(("target_per_week", f64::from(t).into()));
    }
    if let Some(x) = p.xp_reward {
        check_xp_reward(x)?;
        sets.push(("xp_reward", f64::from(x).into()));
    }
    if let Some(c) = &p.color {
        sets.push(("color", c.as_str().into()));
    }
    if let Some(n) = &p.notes {
        sets.push(("notes", opt_text(n.as_deref())));
    }
    if let Some(t) = &p.tags {
        sets.push(("tags", opt_text(t.as_deref())));
    }
    if let Some(a) = p.active {
        sets.push(("active", f64::from(u8::from(a)).into()));
    }

    let mut stmts = Vec::new();
    if !sets.is_empty() {
        let assigns: Vec<String> = sets
            .iter()
            .enumerate()
            .map(|(i, (col, _))| format!("{col} = ?{}", i + 1))
            .collect();
        let mut binds: Vec<JsValue> = sets.into_iter().map(|(_, v)| v).collect();
        binds.push(habit_id.as_str().into());
        stmts.push(
            s.db.prepare(format!(
                "UPDATE habits SET {} WHERE id = ?{}",
                assigns.join(", "),
                binds.len()
            ))
            .bind(&binds)?,
        );
    }
    if category.is_some() {
        stmts.push(query!(
            &s.db,
            ENSURE_CATEGORY,
            Uuid::now_v7().to_string(),
            habit_id
        )?);
    }
    stmts.push(query!(
        &s.db,
        &format!("SELECT {HABIT_COLUMNS} FROM habits WHERE id = ?1"),
        habit_id
    )?);
    let res = s.db.batch(stmts).await?;
    log_d1("PATCH /habits/{id}", &res);
    res.last()
        .unwrap()
        .results::<Habit>()?
        .pop()
        .map(Json)
        .ok_or(AppError::NotFound("Hábito no encontrado"))
}

/// Archiva: se conserva el historial. Repetirlo da lo mismo.
#[worker::send]
pub async fn archive(
    State(s): State<AppState>,
    Path(habit_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let habit_id = parse_uuid(&habit_id)?;
    let res =
        s.db.batch(vec![query!(
            &s.db,
            "UPDATE habits SET active = 0 WHERE id = ?1 RETURNING id",
            habit_id
        )?])
        .await?;
    log_d1("DELETE /habits/{id}", &res);
    if res[0].results::<IdRow>()?.is_empty() {
        return Err(AppError::NotFound("Hábito no encontrado"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct IdRow {
    #[allow(dead_code)]
    id: String,
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

impl Frequency {
    fn as_str(self) -> &'static str {
        match self {
            Frequency::Daily => "daily",
            Frequency::Weekly => "weekly",
        }
    }
}

fn check_xp_reward(x: u32) -> Result<(), AppError> {
    if (10..=100).contains(&x) {
        Ok(())
    } else {
        Err(AppError::Invalid("El XP debe estar entre 10 y 100".into()))
    }
}

fn check_target(t: u8) -> Result<(), AppError> {
    WeeklyTarget::new(t)
        .map(|_| ())
        .map_err(|_| AppError::Invalid("La meta semanal debe estar entre 1 y 7".into()))
}

/// `days` validado y normalizado; vacío = todos los días = `NULL`.
fn parse_days(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let days = WeekdaySet::parse(raw.unwrap_or("")).map_err(|e| {
        AppError::Invalid(format!("Día inválido: «{}» (0 = lunes … 6 = domingo)", e.0))
    })?;
    Ok(days.map(|d| d.to_string()))
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
    check_xp_reward(h.xp_reward)?;
    check_target(h.target_per_week)?;
    let days = parse_days(h.days.as_deref())?;
    let frequency = h.frequency.as_str();

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
            query!(&s.db, ENSURE_CATEGORY, Uuid::now_v7().to_string(), id)?,
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
    /// Los logros que desbloqueó esta marca (fila 4 de las diferencias), con lo que el
    /// toast necesita: el catálogo vive en la base.
    achievements_unlocked: Vec<UnlockedAchievement>,
}

/// ?1 instante · ?2 claves cumplidas (arreglo JSON). Devuelve solo las nuevas; así, dos
/// marcas concurrentes no informan el mismo logro.
pub(crate) const UNLOCK_ACHIEVEMENTS: &str = "UPDATE achievements SET unlocked_at = ?1 \
     WHERE unlocked_at IS NULL AND key IN (SELECT value FROM json_each(?2)) RETURNING key, name, icon";

#[derive(Deserialize)]
pub(crate) struct AchievementRow {
    pub key: String,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct UnlockedAchievement {
    pub key: String,
    name: String,
    icon: String,
}

#[derive(Deserialize)]
struct GrantRow {
    total: i64,
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
    /// XP vigente de la marca con ese ID: lo que devuelve deshacerla.
    grant: i64,
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
                &format!("SELECT {HABIT_COLUMNS} FROM habits WHERE id = ?1"),
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
            query!(
                &s.db,
                "SELECT COALESCE(SUM(amount), 0) AS total FROM xp_log \
                 WHERE mark_id = ?1 AND source = 'habit'",
                log_id
            )?,
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
        grant: res[5].results::<GrantRow>()?.pop().map_or(0, |g| g.total),
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
    check_owner(st, existing)?;
    state_out(st, today)
}

fn check_owner(st: &MarkState, existing: &LogRow) -> Result<(), AppError> {
    if existing.habit_id != st.habit.id {
        return Err(AppError::Conflict(
            "Ese id de marca ya pertenece a otro hábito".into(),
        ));
    }
    Ok(())
}

/// El estado actual, sin efecto: lo que responde un reintento.
fn state_out(st: &MarkState, today: NaiveDate) -> Result<Json<CompleteOut>, AppError> {
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
    if !st.habit.active {
        return Err(AppError::NotFound("Hábito no encontrado"));
    }
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
            "INSERT INTO xp_log (id, source, source_id, amount, created_at, mark_id) \
             VALUES (?1, 'habit', ?2, ?3, ?4, ?5)",
            Uuid::now_v7().to_string(),
            habit_id,
            xp.applied,
            now,
            log_id
        )?);
    }
    if !earned.is_empty() {
        let earned_json =
            serde_json::to_string(&earned).map_err(|e| AppError::Internal(e.to_string()))?;
        writes.push(query!(&s.db, UNLOCK_ACHIEVEMENTS, now, earned_json)?);
    }
    // batch = transacción: si una restricción rechaza la marca, no se suma XP ni se
    // desbloquea nada
    let mut new = match s.db.batch(writes).await {
        Ok(res) => {
            log_d1("complete: escritura", &res);
            if earned.is_empty() {
                Vec::new()
            } else {
                res.last().unwrap().results::<UnlockedAchievement>()?
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
            .filter_map(|k| {
                let i = new.iter().position(|r| r.key == k)?;
                Some(new.swap_remove(i))
            })
            .collect(),
    }))
}

// ---------- DELETE /habits/{id}/marks/{mark_id} ----------

// Deshacer es una escritura concurrente: todas las sentencias van en un `batch` y exigen
// que la marca siga existiendo. El borrado va de último, para que la guarda valga en las
// anteriores. El piso se calcula en SQL contra el XP de ese momento (fila 5).
/// ?1 id · ?2 concesión · ?3 instante · ?4 marca · ?5 usuario. Lo que el piso en 0 no dejó
/// quitar, para que `users.xp` siga siendo la suma de `xp_log`.
pub(crate) const UNDO_FLOOR: &str = "INSERT INTO xp_log \
     (id, source, source_id, amount, created_at, mark_id) \
     SELECT ?1, 'xp_floor', NULL, ?2 - xp, ?3, ?4 FROM users \
     WHERE id = ?5 AND xp < ?2 AND EXISTS (SELECT 1 FROM habit_logs WHERE id = ?4)";
/// ?1 id · ?2 hábito · ?3 concesión · ?4 instante · ?5 marca
pub(crate) const UNDO_GRANT: &str = "INSERT INTO xp_log \
     (id, source, source_id, amount, created_at, mark_id) \
     SELECT ?1, 'habit', ?2, -?3, ?4, ?5 \
     WHERE EXISTS (SELECT 1 FROM habit_logs WHERE id = ?5)";
/// ?1 concesión · ?2 usuario · ?3 marca. Sin fila devuelta: otro request ya la deshizo.
pub(crate) const UNDO_USER: &str = "UPDATE users SET xp = MAX(0, xp - ?1) \
     WHERE id = ?2 AND EXISTS (SELECT 1 FROM habit_logs WHERE id = ?3) RETURNING xp";
pub(crate) const UNDO_MARK: &str = "DELETE FROM habit_logs WHERE id = ?1";

#[derive(Deserialize)]
struct NewXpRow {
    #[allow(dead_code)]
    xp: i64,
}

/// Deshace una marca por su ID. Si la marca ya no existe, 200 sin efecto: reintentar da lo
/// mismo (ADR 0004).
#[worker::send]
pub async fn undo(
    State(s): State<AppState>,
    Path((habit_id, mark_id)): Path<(String, String)>,
) -> Result<Json<CompleteOut>, AppError> {
    let habit_id = parse_uuid(&habit_id)?;
    let mark_id = parse_uuid(&mark_id)?;
    let today = today(&s.tz)?;
    let mut st = read_mark_state(&s, &habit_id, &mark_id, today, today).await?;
    let Some(existing) = &st.existing else {
        return state_out(&st, today);
    };
    check_owner(&st, existing)?;
    let on = parse_date(&existing.local_date)?;
    check_undo(st.habit.cadence()?, on, today)
        .map_err(|_| AppError::Conflict("Esa marca ya no se puede deshacer".into()))?;

    let grant = st.grant;
    let now = now_utc();
    let mut writes = Vec::new();
    if grant > 0 {
        writes.push(query!(
            &s.db,
            UNDO_FLOOR,
            Uuid::now_v7().to_string(),
            grant,
            now,
            mark_id,
            st.user.id
        )?);
        writes.push(query!(
            &s.db,
            UNDO_GRANT,
            Uuid::now_v7().to_string(),
            habit_id,
            grant,
            now,
            mark_id
        )?);
    }
    writes.push(query!(&s.db, UNDO_USER, grant, st.user.id, mark_id)?);
    let user_stmt = writes.len() - 1;
    writes.push(query!(&s.db, UNDO_MARK, mark_id)?);
    let res = s.db.batch(writes).await?;
    log_d1("undo: escritura", &res);
    if res[user_stmt].results::<NewXpRow>()?.is_empty() {
        // otro request la deshizo primero: la racha y el XP ya no son los leídos
        let st = read_mark_state(&s, &habit_id, &mark_id, today, today).await?;
        return state_out(&st, today);
    }

    st.marks.remove(&on);
    let xp = award_xp(st.user.xp, -grant);
    Ok(Json(CompleteOut {
        xp_earned: xp.applied,
        new_xp: xp.new_xp,
        new_level: xp.new_level,
        title: xp.title,
        leveled_up: false,
        streak: current_streak(st.habit.cadence()?, &st.marks, today),
        achievements_unlocked: Vec::new(),
    }))
}

#[cfg(test)]
mod tests {
    //! Las sentencias reales, contra SQLite (D1 es SQLite).
    use super::{
        ENSURE_CATEGORY, HEATMAP, UNDO_FLOOR, UNDO_GRANT, UNDO_MARK, UNDO_USER, UNLOCK_ACHIEVEMENTS,
    };
    use crate::categories::CREATE_CATEGORY;
    use rusqlite::{Connection, OptionalExtension, params};

    const USER: &str = "00000000-0000-7000-8000-000000000001";

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(concat!(
            include_str!("../../../migrations/0001_init.sql"),
            include_str!("../../../migrations/0002_lives.sql"),
            include_str!("../../../migrations/0003_achievements.sql"),
            include_str!("../../../migrations/0004_undo_and_categories.sql"),
        ))
        .unwrap();
        c
    }

    fn add_habit(c: &Connection, id: &str, freq: &str, days: Option<&str>, target: i64) {
        c.execute(
            "INSERT INTO habits (id, name, category, frequency, days, target_per_week, created_at) \
             VALUES (?1, ?1, 'Nueva', ?2, ?3, ?4, '2026-01-01T05:00:00Z')",
            params![id, freq, days, target],
        )
        .unwrap();
    }

    fn add_mark(c: &Connection, habit: &str, day: &str) {
        c.execute(
            "INSERT INTO habit_logs (id, habit_id, local_date, completed_at) \
             VALUES (?1, ?2, ?3, '2026-03-02T17:00:00Z')",
            params![format!("{habit}-{day}"), habit, day],
        )
        .unwrap();
    }

    /// Hoy es el domingo 2026-11-01: el 10-27 de 2025 es el primer día de 371 y el 26 ya no entra.
    #[test]
    fn heatmap_stops_at_the_first_day_of_the_window() {
        let c = db();
        add_habit(&c, "a", "daily", None, 1);
        add_habit(&c, "b", "daily", None, 1);
        for (habit, day) in [
            ("a", "2025-10-26"),
            ("a", "2025-10-27"),
            ("b", "2025-10-27"),
            ("a", "2026-11-01"),
        ] {
            add_mark(&c, habit, day);
        }
        let mut q = c.prepare(HEATMAP).unwrap();
        let got: Vec<(String, u32)> = q
            .query_map(["2025-10-27"], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            got,
            [("2025-10-27".to_string(), 2), ("2026-11-01".to_string(), 1)]
        );
    }

    #[test]
    fn heatmap_keeps_archived_habits_and_reads_through_the_index() {
        let c = db();
        add_habit(&c, "a", "daily", None, 1);
        add_mark(&c, "a", "2026-03-02");
        c.execute("UPDATE habits SET active = 0", []).unwrap();
        let count: u32 = c.query_row(HEATMAP, ["2026-01-01"], |r| r.get(1)).unwrap();
        assert_eq!(count, 1);

        let mut q = c.prepare(&format!("EXPLAIN QUERY PLAN {HEATMAP}")).unwrap();
        let plan: Vec<String> = q
            .query_map(["2026-01-01"], |r| r.get(3))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(
            plan.iter()
                .any(|p| p.contains("habit_logs") && p.contains("USING")),
            "{plan:?}"
        );
        assert!(
            !plan.iter().any(|p| p.starts_with("SCAN habit_logs")),
            "{plan:?}"
        );
    }

    /// Una marca con su XP, como `complete`.
    fn marked(xp_before: i64, grant: i64) -> Connection {
        let c = db();
        add_habit(&c, "h", "daily", None, 1);
        add_mark(&c, "h", "2026-03-02");
        c.execute(
            "INSERT INTO xp_log (id, source, source_id, amount, created_at, mark_id) VALUES \
             ('previo', 'task', NULL, ?1, '2026-03-01T00:00:00Z', NULL), \
             ('g', 'habit', 'h', ?2, '2026-03-02T17:00:00Z', 'h-2026-03-02')",
            params![xp_before, grant],
        )
        .unwrap();
        c.execute("UPDATE users SET xp = ?1", [xp_before + grant])
            .unwrap();
        c
    }

    /// Un deshacer, como el `batch` del worker. Devuelve si escribió.
    fn undo(c: &mut Connection, id: &str, grant: i64) -> bool {
        const MARK: &str = "h-2026-03-02";
        const NOW: &str = "2026-03-03T17:00:00Z";
        let tx = c.transaction().unwrap();
        tx.execute(
            UNDO_FLOOR,
            params![format!("{id}-piso"), grant, NOW, MARK, USER],
        )
        .unwrap();
        tx.execute(UNDO_GRANT, params![id, "h", grant, NOW, MARK])
            .unwrap();
        let wrote = tx
            .query_row(UNDO_USER, params![grant, USER, MARK], |r| {
                r.get::<_, i64>(0)
            })
            .optional()
            .unwrap()
            .is_some();
        tx.execute(UNDO_MARK, [MARK]).unwrap();
        tx.commit().unwrap();
        wrote
    }

    /// (`users.xp`, suma de `xp_log`, `total_xp` del hábito, filas `xp_floor`, marcas)
    fn undo_state(c: &Connection) -> (i64, i64, i64, i64, i64) {
        c.query_row(
            "SELECT xp, (SELECT SUM(amount) FROM xp_log), \
             (SELECT COALESCE(SUM(amount), 0) FROM xp_log \
              WHERE source = 'habit' AND source_id = 'h'), \
             (SELECT COUNT(*) FROM xp_log WHERE source = 'xp_floor'), \
             (SELECT COUNT(*) FROM habit_logs) FROM users",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap()
    }

    #[test]
    fn undo_returns_the_grant_once() {
        let mut c = marked(100, 20);
        assert!(undo(&mut c, "a", 20));
        assert!(!undo(&mut c, "b", 20), "el segundo no tiene marca");
        assert_eq!(undo_state(&c), (100, 100, 0, 0, 0));
    }

    /// `deshacer`, 03-16: con el XP recortado por una penalización, el usuario queda en 0, la
    /// suma de `xp_log` sigue siendo su XP y el total del hábito no cuenta la marca borrada.
    #[test]
    fn undo_with_the_floor_keeps_the_ledger_balanced() {
        let mut c = marked(0, 20);
        c.execute_batch(
            "INSERT INTO xp_log (id, source, source_id, amount, created_at) VALUES \
             ('pen', 'streak_penalty', NULL, -15, '2026-03-02T18:00:00Z'); \
             UPDATE users SET xp = 5;",
        )
        .unwrap();
        assert!(undo(&mut c, "a", 20));
        assert_eq!(undo_state(&c), (0, 0, 0, 1, 0));
    }

    #[test]
    fn category_is_listed_once_whatever_creates_it() {
        let c = db();
        add_habit(&c, "h", "daily", None, 1);
        let count = |name: &str| -> i64 {
            c.query_row(
                "SELECT COUNT(*) FROM habit_categories WHERE name = ?1",
                [name],
                |r| r.get(0),
            )
            .unwrap()
        };
        c.execute(ENSURE_CATEGORY, ["x1", "h"]).unwrap();
        c.execute(ENSURE_CATEGORY, ["x2", "h"]).unwrap();
        assert_eq!(count("Nueva"), 1);
        // otro id con el mismo nombre en otras mayúsculas: no entra
        let none: Option<String> = None;
        assert_eq!(
            c.execute(CREATE_CATEGORY, params!["c1", "físico2", none])
                .unwrap(),
            1
        );
        assert_eq!(
            c.execute(CREATE_CATEGORY, params!["c2", "FÍSICO2", none])
                .unwrap(),
            1,
            "lower() de SQLite solo pliega ASCII, como la v1"
        );
        assert_eq!(
            c.execute(CREATE_CATEGORY, params!["c3", "NUEVA", none])
                .unwrap(),
            0
        );
        assert_eq!(
            c.execute(CREATE_CATEGORY, params!["c1", "otra", none])
                .unwrap(),
            0,
            "repetir el id no hace nada"
        );
    }

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
