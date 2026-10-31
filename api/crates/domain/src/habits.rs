//! Rachas y marcado de hábitos (v1: `habit_streak`, `best_streak`, `mark_habit_done`).
//!
//! Las marcas entran como el conjunto de `local_date` del hábito (ADR 0004). El día
//! de la marca entra explícito, así que marcar «ayer» desde una cola offline es el
//! mismo cálculo que marcar hoy (ADR 0005); la ventana de gracia la valida quien llama.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{Days, NaiveDate};

use crate::cadence::{
    Cadence, last_scheduled, next_scheduled, prev_scheduled, scheduled_on, week_monday,
};
use crate::xp::{apply_multiplier, streak_multiplier};

pub type Marks = BTreeSet<NaiveDate>;

/// Lunes de las semanas que alcanzaron la meta.
fn met_weeks(marks: &Marks, target: u8) -> BTreeSet<NaiveDate> {
    let mut counts = BTreeMap::new();
    for &d in marks {
        *counts.entry(week_monday(d)).or_insert(0u32) += 1;
    }
    counts
        .into_iter()
        .filter(|&(_, n)| n >= u32::from(target))
        .map(|(w, _)| w)
        .collect()
}

/// Unidad anterior/siguiente de la cadencia: semana ISO o día programado.
fn prev_unit(cadence: Cadence, u: NaiveDate) -> Option<NaiveDate> {
    match cadence {
        Cadence::Weekly { .. } => u.checked_sub_days(Days::new(7)),
        Cadence::Daily { days } => prev_scheduled(days, u),
    }
}

fn next_unit(cadence: Cadence, u: NaiveDate) -> Option<NaiveDate> {
    match cadence {
        Cadence::Weekly { .. } => u.checked_add_days(Days::new(7)),
        Cadence::Daily { days } => next_scheduled(days, u),
    }
}

/// Racha actual al día `today`, en unidades de la cadencia: días programados si es
/// diario, semanas ISO que alcanzaron la meta si es semanal.
pub fn current_streak(cadence: Cadence, marks: &Marks, today: NaiveDate) -> u32 {
    match current_streak_since(cadence, marks, today, NaiveDate::MIN) {
        WindowedStreak::Exact(n) => n,
        WindowedStreak::AtEdge => unreachable!("ninguna unidad empieza antes de NaiveDate::MIN"),
    }
}

/// Días hacia atrás que se leen de historial antes de ampliar (ADR 0007).
pub const HISTORY_WINDOW_DAYS: u64 = 90;

/// Primer día de la ventana de historial que se lee para `today`.
pub fn history_window_start(today: NaiveDate) -> NaiveDate {
    today - Days::new(HISTORY_WINDOW_DAYS)
}

/// Días del heatmap: las 53 semanas de `HabitHeatmap`. La rejilla termina el domingo de
/// esta semana, así que nunca empieza antes de hoy − 370, que es el caso del domingo.
pub const HEATMAP_DAYS: u64 = 53 * 7;

/// Primer día del heatmap para `today`, inclusive.
pub fn heatmap_window_start(today: NaiveDate) -> NaiveDate {
    today - Days::new(HEATMAP_DAYS - 1)
}

/// Racha calculada solo con las marcas desde `from` (ADR 0007).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowedStreak {
    /// La racha termina dentro de la ventana: es la misma que con todo el historial.
    Exact(u32),
    /// La racha llega al borde: la siguiente unidad hacia atrás empieza antes de
    /// `from` y podría estar cumplida. Hay que leer más historial.
    AtEdge,
}

/// Como `current_streak`, pero sabiendo que `marks` solo trae las de `from` en
/// adelante. Una semana que empieza antes de `from` cuenta como fuera de la
/// ventana aunque sus últimos días estén dentro: sus marcas pueden estar incompletas.
pub fn current_streak_since(
    cadence: Cadence,
    marks: &Marks,
    today: NaiveDate,
    from: NaiveDate,
) -> WindowedStreak {
    let (units, anchor) = match cadence {
        Cadence::Weekly { target } => (met_weeks(marks, target.get()), Some(week_monday(today))),
        Cadence::Daily { days } => (marks.clone(), last_scheduled(days, today)),
    };
    let Some(anchor) = anchor else {
        return WindowedStreak::Exact(0);
    };
    // margen: la unidad en curso todavía se puede cumplir, así que la racha se
    // ancla en la anterior en vez de darse por rota
    if anchor < from {
        return WindowedStreak::AtEdge;
    }
    let mut cursor = if units.contains(&anchor) {
        Some(anchor)
    } else {
        prev_unit(cadence, anchor)
    };
    let mut streak = 0;
    loop {
        match cursor {
            Some(u) if u < from => return WindowedStreak::AtEdge,
            Some(u) if units.contains(&u) => {
                streak += 1;
                cursor = prev_unit(cadence, u);
            }
            _ => return WindowedStreak::Exact(streak),
        }
    }
}

/// Ocasiones cumplidas: días programados marcados, o semanas que alcanzaron la meta.
pub fn done_units(cadence: Cadence, marks: &Marks) -> u32 {
    match cadence {
        Cadence::Weekly { target } => met_weeks(marks, target.get()).len() as u32,
        Cadence::Daily { days } => marks.iter().filter(|&&d| scheduled_on(days, d)).count() as u32,
    }
}

/// Ocasiones que el hábito pidió desde que existe, al menos 1 (v1: `_enrich`).
pub fn total_units(cadence: Cadence, created_on: NaiveDate, today: NaiveDate) -> u32 {
    let total = match cadence {
        Cadence::Weekly { .. } => (week_monday(today) - week_monday(created_on)).num_days() / 7 + 1,
        Cadence::Daily { days } => created_on
            .iter_days()
            .take_while(|d| *d <= today)
            .filter(|&d| scheduled_on(days, d))
            .count() as i64,
    };
    total.max(1) as u32
}

/// Constancia en porcentaje, con un decimal y sin pasar de 100. `format!` redondea el
/// valor binario exacto con mitades al par, como `round(x, 1)` de Python en la v1.
pub fn completion_rate(done: u32, total: u32) -> f64 {
    let rate = f64::from(done.min(total)) / f64::from(total) * 100.0;
    format!("{rate:.1}").parse().unwrap_or(0.0)
}

/// Constancia de los últimos 90 días, desde que existe el hábito si es más nuevo
/// (caracterizacion-v1.md, fila 10). `marks` puede traer solo la ventana (ADR 0007) o más:
/// da lo mismo. La semana que la ventana corta no cuenta, porque sus marcas pueden estar
/// incompletas (como en `current_streak_since`), salvo que el hábito naciera en ella.
pub fn recent_completion_rate(
    cadence: Cadence,
    marks: &Marks,
    created_on: NaiveDate,
    today: NaiveDate,
) -> f64 {
    let from = history_window_start(today);
    let start = match cadence {
        Cadence::Weekly { .. } if created_on < from => week_monday(from + Days::new(6)),
        Cadence::Weekly { .. } => week_monday(created_on),
        Cadence::Daily { .. } => created_on.max(from),
    };
    let recent: Marks = marks.range(start..).copied().collect();
    completion_rate(
        done_units(cadence, &recent),
        total_units(cadence, start, today),
    )
}

pub fn best_streak(cadence: Cadence, marks: &Marks) -> u32 {
    let units: Vec<NaiveDate> = match cadence {
        Cadence::Weekly { target } => met_weeks(marks, target.get()).into_iter().collect(),
        // las marcas fuera de los días programados no son unidad: si contaran,
        // un extra en sábado partiría la racha de un hábito L–V
        Cadence::Daily { days } => marks
            .iter()
            .copied()
            .filter(|&d| scheduled_on(days, d))
            .collect(),
    };
    let (mut best, mut run) = (0, 0);
    for (i, &u) in units.iter().enumerate() {
        run = if i > 0 && next_unit(cadence, units[i - 1]) == Some(u) {
            run + 1
        } else {
            1
        };
        best = best.max(run);
    }
    best
}

/// Motivos por los que un hábito no se puede marcar ese día. No son errores: quien
/// llama decide si es un 409 o una nota al pie (v1: `HABIT_DONE_TODAY`,
/// `HABIT_WEEK_TARGET_MET`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkRejected {
    AlreadyDoneToday,
    WeeklyTargetMet,
    /// Fuera de la ventana de gracia (ADR 0005), o en el futuro.
    OutsideGraceWindow,
    /// Antes del día en que se creó el hábito: no cuenta antes de existir (v1).
    BeforeHabitCreated,
}

/// Días hacia atrás en que se acepta una marca tardía: hoy, ayer y anteayer (ADR 0005).
pub const GRACE_DAYS: u64 = 2;

/// ¿Se acepta hoy una marca con día `on` para un hábito creado el día local
/// `created_on`?
pub fn check_mark_day(
    on: NaiveDate,
    today: NaiveDate,
    created_on: NaiveDate,
) -> Result<(), MarkRejected> {
    if on < created_on {
        return Err(MarkRejected::BeforeHabitCreated);
    }
    let earliest = today - Days::new(GRACE_DAYS);
    if (earliest..=today).contains(&on) {
        Ok(())
    } else {
        Err(MarkRejected::OutsideGraceWindow)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Completion {
    /// Racha real tras la marca, a la fecha de `today`: la misma que da `GET /habits`.
    /// La v1 respondía la previa + 1 aunque la marca no cerrara la semana
    /// (caracterizacion-v1.md, «Diferencias permitidas», fila 6).
    pub streak: u32,
    /// XP que paga la marca, ya con multiplicador. Se suma con `xp::award_xp`.
    pub xp: i64,
}

/// Valida una marca para el día `on` y calcula racha y XP. No modifica nada.
pub fn mark(
    cadence: Cadence,
    marks: &Marks,
    on: NaiveDate,
    today: NaiveDate,
    xp_reward: u32,
) -> Result<Completion, MarkRejected> {
    if marks.contains(&on) {
        return Err(MarkRejected::AlreadyDoneToday);
    }
    if let Cadence::Weekly { target } = cadence {
        let monday = week_monday(on);
        let sunday = monday + Days::new(6);
        if marks.range(monday..=sunday).count() >= usize::from(target.get()) {
            return Err(MarkRejected::WeeklyTargetMet);
        }
    }
    // el multiplicador sale de la racha ANTES de la marca: la que se está creando
    // la sube a previa + 1 (v1), aunque en un semanal no cierre la semana
    let paid_streak = current_streak(cadence, marks, on) + 1;
    let mut after = marks.clone();
    after.insert(on);
    Ok(Completion {
        streak: current_streak(cadence, &after, today),
        xp: apply_multiplier(xp_reward, streak_multiplier(paid_streak)),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UndoRejected {
    /// Diario: el día ya no está en la ventana de gracia, así que pudo asentarse
    /// (ADR 0005). Semanal: la marca no es de la semana en curso (v1).
    OutsideUndoWindow,
}

/// ¿Se puede deshacer hoy la marca del día `on`? El XP que se devuelve es el que
/// concedió esa marca (caracterizacion-v1.md, fila 5); se resta con `xp::award_xp`.
pub fn check_undo(cadence: Cadence, on: NaiveDate, today: NaiveDate) -> Result<(), UndoRejected> {
    let ok = match cadence {
        Cadence::Daily { .. } => (today - Days::new(GRACE_DAYS)..=today).contains(&on),
        Cadence::Weekly { .. } => on <= today && week_monday(on) == week_monday(today),
    };
    if ok {
        Ok(())
    } else {
        Err(UndoRejected::OutsideUndoWindow)
    }
}
