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
    let (units, anchor) = match cadence {
        Cadence::Weekly { target } => (met_weeks(marks, target.get()), Some(week_monday(today))),
        Cadence::Daily { days } => (marks.clone(), last_scheduled(days, today)),
    };
    let Some(anchor) = anchor else { return 0 };
    // margen: la unidad en curso todavía se puede cumplir, así que la racha se
    // ancla en la anterior en vez de darse por rota
    let mut cursor = if units.contains(&anchor) {
        Some(anchor)
    } else {
        prev_unit(cadence, anchor)
    };
    let mut streak = 0;
    while let Some(u) = cursor.filter(|u| units.contains(u)) {
        streak += 1;
        cursor = prev_unit(cadence, u);
    }
    streak
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
    /// Racha tras la marca.
    pub streak: u32,
    /// XP que paga la marca, ya con multiplicador. Se suma con `xp::award_xp`.
    pub xp: i64,
}

/// Valida una marca para el día `on` y calcula racha y XP. No modifica nada.
pub fn mark(
    cadence: Cadence,
    marks: &Marks,
    on: NaiveDate,
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
    // la racha se lee ANTES de la marca: la que se está creando la sube a
    // previa + 1, y es ese valor el que decide el multiplicador
    let streak = current_streak(cadence, marks, on) + 1;
    Ok(Completion {
        streak,
        xp: apply_multiplier(xp_reward, streak_multiplier(streak)),
    })
}
