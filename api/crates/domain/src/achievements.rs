//! Logros que dispara marcar un hábito (v1: `achievements.py::check_achievements`).
//!
//! El dominio dice cuáles se cumplen; cuáles son nuevos lo decide la base, que recuerda
//! los ya desbloqueados. Ventana de historial que necesitan (ADR 0007): la racha, la que
//! ya se leyó del hábito marcado; `polymath`, ninguna; `total_discipline`, 7 días.

use chrono::{Days, NaiveDate};

use crate::cadence::scheduled_on;
use crate::lives::DailyHabit;

/// Lo que hay que saber después de una marca aceptada.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarkFacts {
    /// Nivel con el XP de la marca ya sumado.
    pub level: u32,
    /// Racha real del hábito marcado, con la marca incluida. Marcar un hábito no cambia
    /// la de los demás; la v1 las recalculaba todas (caracterizacion-v1.md, fila 8). En
    /// un semanal cuenta semanas (fila 7).
    pub streak: u32,
    pub active_categories: usize,
    pub total_discipline: bool,
}

const LEVELS: [(u32, &str); 4] = [
    (5, "ascension"),
    (10, "contemplator"),
    (15, "archon"),
    (20, "ether_being"),
];
const STREAKS: [(u32, &str); 4] = [
    (7, "iron_constancy"),
    (30, "iron_month"),
    (60, "streak_60"),
    (100, "streak_centurion"),
];
const POLYMATH_CATEGORIES: usize = 4;
pub const POLYMATH: &str = "polymath";
pub const TOTAL_DISCIPLINE: &str = "total_discipline";

/// Todos los logros que se cumplen, en el orden de la v1: nivel, primera marca, racha,
/// `polymath` y `total_discipline`. La v1 solo informaba el primero (fila 4).
pub fn earned_on_mark(f: MarkFacts) -> Vec<&'static str> {
    let mut earned: Vec<&'static str> = LEVELS
        .iter()
        .filter(|(min, _)| f.level >= *min)
        .map(|(_, key)| *key)
        .collect();
    earned.push("first_blood");
    earned.extend(
        STREAKS
            .iter()
            .filter(|(min, _)| f.streak >= *min)
            .map(|(_, key)| *key),
    );
    if f.active_categories >= POLYMATH_CATEGORIES {
        earned.push(POLYMATH);
    }
    if f.total_discipline {
        earned.push(TOTAL_DISCIPLINE);
    }
    earned
}

/// Lo que hay que saber después de completar una tarea.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskFacts {
    /// Nivel con el XP de la tarea ya sumado.
    pub level: u32,
    /// Algún proyecto con tareas las tiene todas hechas, sea o no el de esta tarea (v1).
    pub project_finished: bool,
    /// Tareas completadas en total, con esta incluida.
    pub completed_tasks: u32,
}

pub const PROJECT_MASTER: &str = "project_master";
pub const TASK_CENTURION: &str = "task_centurion";
const CENTURION_TASKS: u32 = 100;

/// Todos los logros que se cumplen, en el orden de la v1: nivel, proyecto y centenar. La v1 solo
/// informaba el primero (caracterizacion-v1.md, fila 4). Las tareas no dan `first_blood`.
pub fn earned_on_task_complete(f: TaskFacts) -> Vec<&'static str> {
    let mut earned: Vec<&'static str> = LEVELS
        .iter()
        .filter(|(min, _)| f.level >= *min)
        .map(|(_, key)| *key)
        .collect();
    if f.project_finished {
        earned.push(PROJECT_MASTER);
    }
    if f.completed_tasks >= CENTURION_TASKS {
        earned.push(TASK_CENTURION);
    }
    earned
}

const DISCIPLINE_DAYS: u64 = 7;

/// Primer día que mira `total_discipline`.
pub fn discipline_window_start(today: NaiveDate) -> NaiveDate {
    today - Days::new(DISCIPLINE_DAYS - 1)
}

/// 7 días seguidos hasta hoy en que cada hábito diario activo que existía y tocaba quedó
/// marcado. Alguno tiene que llevar la ventana entera: si no, crear un hábito y marcarlo
/// una vez bastaría (v1: `_check_total_discipline`).
pub fn total_discipline(habits: &[DailyHabit<'_>], today: NaiveDate) -> bool {
    let start = discipline_window_start(today);
    habits.iter().any(|h| h.created_on <= start)
        && start.iter_days().take(DISCIPLINE_DAYS as usize).all(|day| {
            habits
                .iter()
                .filter(|h| h.created_on <= day && scheduled_on(h.days, day))
                .all(|h| h.marks.contains(&day))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cadence::WeekdaySet;
    use crate::habits::Marks;

    fn d(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    fn run(from: &str, to: &str) -> Marks {
        d(from).iter_days().take_while(|x| *x <= d(to)).collect()
    }

    fn facts(level: u32, streak: u32, cats: usize, discipline: bool) -> Vec<&'static str> {
        earned_on_mark(MarkFacts {
            level,
            streak,
            active_categories: cats,
            total_discipline: discipline,
        })
    }

    #[test]
    fn thresholds_are_inclusive_and_in_v1_order() {
        assert_eq!(facts(4, 6, 3, false), ["first_blood"]);
        assert_eq!(
            facts(5, 7, 4, true),
            [
                "ascension",
                "first_blood",
                "iron_constancy",
                "polymath",
                "total_discipline"
            ]
        );
        assert_eq!(
            facts(20, 100, 1, false),
            [
                "ascension",
                "contemplator",
                "archon",
                "ether_being",
                "first_blood",
                "iron_constancy",
                "iron_month",
                "streak_60",
                "streak_centurion"
            ]
        );
    }

    fn habit<'a>(days: Option<WeekdaySet>, created: &str, marks: &'a Marks) -> DailyHabit<'a> {
        DailyHabit {
            id: "h",
            days,
            created_on: d(created),
            marks,
        }
    }

    #[test]
    fn discipline_needs_seven_real_days() {
        // 2026-03-08 es domingo; la ventana es del 2 al 8
        let m = run("2026-03-02", "2026-03-08");
        let today = d("2026-03-08");
        assert!(total_discipline(&[habit(None, "2026-03-02", &m)], today));
        // creado un día tarde: nadie lleva la ventana entera
        assert!(!total_discipline(&[habit(None, "2026-03-03", &m)], today));
        assert!(!total_discipline(&[], today));
    }

    #[test]
    fn discipline_fails_on_a_missed_day_of_a_habit_that_existed() {
        let mut m = run("2026-03-02", "2026-03-08");
        m.remove(&d("2026-03-05"));
        assert!(!total_discipline(
            &[habit(None, "2026-03-02", &m)],
            d("2026-03-08")
        ));
    }

    #[test]
    fn discipline_ignores_days_off_and_days_before_a_habit_existed() {
        let lv = WeekdaySet::parse("0,1,2,3,4").unwrap();
        // L–V marcado toda la semana, sin el fin de semana: los días que no toca no cuentan
        let weekdays = run("2026-03-02", "2026-03-06");
        let old = run("2026-03-02", "2026-03-08");
        // el nuevo solo cuenta desde que existe
        let new = run("2026-03-07", "2026-03-08");
        let today = d("2026-03-08");
        assert!(total_discipline(
            &[
                habit(lv, "2026-03-02", &weekdays),
                habit(None, "2026-03-02", &old),
                habit(None, "2026-03-07", &new),
            ],
            today
        ));
    }
}
