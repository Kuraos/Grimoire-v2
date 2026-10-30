//! Vidas y penalización por rachas rotas (v1: `routers/user.py::evaluate_streaks`).
//!
//! Un *fold* día a día (ADR 0005). Quien llama decide qué días se asientan (los que ya
//! no pueden recibir marcas tardías) y cuáles se calculan como provisionales.

use std::ops::RangeInclusive;

use chrono::{Days, NaiveDate};

use crate::cadence::{WeekdaySet, prev_scheduled, scheduled_on};
use crate::habits::{GRACE_DAYS, Marks};

pub const MAX_LIVES: u8 = 3;
/// XP que cuesta un día roto cuando ya no quedan vidas (v1: `STREAK_BREAK_XP_PENALTY`).
pub const STREAK_BREAK_XP_PENALTY: i64 = 15;
/// Días hacia atrás que se recuperan tras una ausencia (v1: `_SCAN_WINDOW_DAYS`). Los
/// anteriores se dan por asentados sin evaluar.
pub const SCAN_WINDOW_DAYS: u64 = 14;
/// El día `D` se asienta cuando `hoy >= D + 3`: hasta anteayer todavía se aceptan
/// marcas para él (ADR 0005, decisión 2).
pub const SETTLE_LAG_DAYS: u64 = GRACE_DAYS + 1;

/// Un hábito diario activo, con lo que la evaluación necesita. Los semanales no
/// cuentan para vidas (v1).
#[derive(Debug, Clone)]
pub struct DailyHabit<'a> {
    pub id: &'a str,
    /// `None` = todos los días.
    pub days: Option<WeekdaySet>,
    /// Día local de creación: antes no cuenta.
    pub created_on: NaiveDate,
    /// Basta con las de `inicio − 7` en adelante: un día se rompe contra la ocasión
    /// anterior del hábito, que está a lo sumo 7 días atrás.
    pub marks: &'a Marks,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    LifeLost,
    LifeRegained,
    /// Sin vidas: el día roto cuesta XP (nominal; el piso en 0 se aplica al cobrarlo).
    XpPenalty(i64),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DayEvent<'a> {
    pub day: NaiveDate,
    pub outcome: Outcome,
    /// Hábitos que rompieron su racha ese día (vacío en una vida recuperada).
    pub broken: Vec<&'a str>,
}

/// Evalúa `days` en orden a partir de `lives`. Por día: si algún hábito que tocaba
/// rompió su racha (no se marcó y sí se marcó su ocasión anterior), una vida menos o,
/// sin vidas, `STREAK_BREAK_XP_PENALTY`; si se marcaron todos, una vida más hasta
/// `MAX_LIVES`. Uno solo de los dos por día, aunque se rompan varios hábitos.
pub fn evaluate_days<'a>(
    mut lives: u8,
    days: RangeInclusive<NaiveDate>,
    habits: &[DailyHabit<'a>],
) -> (u8, Vec<DayEvent<'a>>) {
    let mut events = Vec::new();
    for day in days.start().iter_days().take_while(|d| d <= days.end()) {
        let relevant: Vec<&DailyHabit> = habits
            .iter()
            .filter(|h| h.created_on <= day && scheduled_on(h.days, day))
            .collect();
        if relevant.is_empty() {
            continue;
        }
        let broken: Vec<&str> = relevant
            .iter()
            .filter(|h| {
                !h.marks.contains(&day)
                    && prev_scheduled(h.days, day).is_some_and(|p| h.marks.contains(&p))
            })
            .map(|h| h.id)
            .collect();
        let outcome = if !broken.is_empty() {
            if lives > 0 {
                lives -= 1;
                Outcome::LifeLost
            } else {
                Outcome::XpPenalty(STREAK_BREAK_XP_PENALTY)
            }
        } else if relevant.iter().all(|h| h.marks.contains(&day)) && lives < MAX_LIVES {
            lives += 1;
            Outcome::LifeRegained
        } else {
            continue;
        };
        events.push(DayEvent {
            day,
            outcome,
            broken,
        });
    }
    (lives, events)
}

/// Último día que hoy se puede asentar.
pub fn settle_through(today: NaiveDate) -> NaiveDate {
    today - Days::new(SETTLE_LAG_DAYS)
}

/// Primer día que falta evaluar, acotado a `SCAN_WINDOW_DAYS` atrás.
fn first_pending(settled_through: Option<NaiveDate>, today: NaiveDate) -> NaiveDate {
    let floor = today - Days::new(SCAN_WINDOW_DAYS);
    settled_through.map_or(floor, |s| (s + Days::new(1)).max(floor))
}

/// Días que hoy toca asentar, o `None` si no hay ninguno. Sin el off-by-one de la v1:
/// el siguiente día a evaluar es `settled_through + 1` (caracterizacion-v1.md, fila 3).
pub fn settle_range(
    settled_through: Option<NaiveDate>,
    today: NaiveDate,
) -> Option<RangeInclusive<NaiveDate>> {
    let (from, to) = (
        first_pending(settled_through, today),
        self::settle_through(today),
    );
    (from <= to).then_some(from..=to)
}

/// Días ya terminados que todavía no se pueden asentar: lo que se muestra como
/// provisional. Hoy no se evalúa, porque aún se puede cumplir.
pub fn provisional_range(
    settled_through: Option<NaiveDate>,
    today: NaiveDate,
) -> Option<RangeInclusive<NaiveDate>> {
    let (from, to) = (first_pending(settled_through, today), today - Days::new(1));
    (from <= to).then_some(from..=to)
}
