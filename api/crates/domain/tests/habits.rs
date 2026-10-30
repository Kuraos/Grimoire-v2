//! Casos de la tarea 0.1 (fase-0.md) y los de rachas/cadencias de la v1
//! (`backend/tests/test_api.py`). Fechas fijas: 2026-10-26 es lunes.

use chrono::{Datelike, NaiveDate, Weekday};
use grimoire_domain::cadence::{Cadence, InvalidWeeklyTarget, WeekdaySet, WeeklyTarget};
use grimoire_domain::habits::{MarkRejected, Marks, best_streak, current_streak, mark};
use grimoire_domain::xp::{
    apply_multiplier, award_xp, streak_multiplier, title_for_level, xp_for_level, xp_to_level,
};

fn d(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

fn marks(days: &[&str]) -> Marks {
    days.iter().map(|s| d(s)).collect()
}

const DAILY: Cadence = Cadence::Daily { days: None };

fn weekdays_only() -> Cadence {
    Cadence::Daily {
        days: WeekdaySet::parse("0,1,2,3,4").unwrap(),
    }
}

#[test]
fn calendar_anchor() {
    assert_eq!(d("2026-10-26").weekday(), Weekday::Mon);
    assert_eq!(d("2026-10-29").weekday(), Weekday::Thu);
}

// ---------- XP y niveles ----------

#[test]
fn xp_to_level_cases() {
    for (xp, level) in [
        (-50, 1),
        (0, 1),
        (399, 1),
        (400, 2),
        (899, 2),
        (900, 3),
        (10_000, 10),
    ] {
        assert_eq!(xp_to_level(xp), level, "xp = {xp}");
    }
    // v1 `test_xp_never_goes_negative`: sqrt de un negativo tumbaba la request
    assert_eq!(xp_to_level(-480), 1);
}

#[test]
fn xp_for_level_is_inverse_threshold() {
    for level in 1..=30 {
        let xp = xp_for_level(level);
        assert_eq!(xp_to_level(xp), level);
        assert_eq!(xp_to_level(xp - 1), (level - 1).max(1));
    }
}

#[test]
fn titles() {
    assert_eq!(title_for_level(1), "Iniciado");
    for l in [12, 13, 14] {
        assert_eq!(title_for_level(l), "Oráculo Perpetuo");
    }
    for l in [15, 19] {
        assert_eq!(title_for_level(l), "Arconte de la Voluntad");
    }
    for l in [20, 25] {
        assert_eq!(title_for_level(l), "Ente del Éter Puro");
    }
}

#[test]
fn multiplier_thresholds() {
    for (streak, bp) in [
        (6, 10_000),
        (7, 11_000),
        (14, 12_000),
        (30, 13_500),
        (60, 15_000),
        (100, 17_500),
    ] {
        assert_eq!(streak_multiplier(streak), bp, "racha = {streak}");
    }
}

/// Cambio deliberado frente a la v1 (16, 28, 40): mitades exactas hacia arriba.
#[test]
fn rounding_half_up() {
    assert_eq!(apply_multiplier(15, 11_000), 17); // 16.5
    assert_eq!(apply_multiplier(25, 11_000), 28); // 27.5
    assert_eq!(apply_multiplier(30, 13_500), 41); // 40.5
    assert_eq!(apply_multiplier(20, 10_000), 20);
}

#[test]
fn award_xp_floors_at_zero_and_logs_applied() {
    let r = award_xp(10, -50);
    assert_eq!((r.applied, r.new_xp, r.new_level), (-10, 0, 1));
    assert!(!r.leveled_up);

    let r = award_xp(390, 20);
    assert_eq!((r.applied, r.new_xp, r.new_level), (20, 410, 2));
    assert_eq!(r.title, "Aprendiz de las Sombras");
    assert!(r.leveled_up);
}

// ---------- cadencia ----------

#[test]
fn days_are_validated_and_normalized() {
    assert_eq!(
        WeekdaySet::parse("3,0,0").unwrap().unwrap().to_string(),
        "0,3"
    );
    // vacío es «todos los días», no una lista vacía
    assert_eq!(WeekdaySet::parse("").unwrap(), None);
    for bad in ["9", "-1", "lunes", "7"] {
        assert!(WeekdaySet::parse(bad).is_err(), "{bad}");
    }
}

/// v1 rechaza `target_per_week` 0 y 8 con 422; con 0, `mark` rechazaría toda marca.
#[test]
fn weekly_target_must_be_1_to_7() {
    for bad in [0, 8, u8::MAX] {
        assert_eq!(WeeklyTarget::new(bad), Err(InvalidWeeklyTarget(bad)));
    }
    for ok in 1..=7 {
        assert_eq!(WeeklyTarget::new(ok).unwrap().get(), ok);
    }
}

// ---------- rachas ----------

#[test]
fn weekdays_habit_weekend_does_not_break_streak() {
    let m = marks(&[
        "2026-10-19",
        "2026-10-20",
        "2026-10-21",
        "2026-10-22",
        "2026-10-23",
        "2026-10-26",
        "2026-10-27",
        "2026-10-28",
        "2026-10-29",
    ]);
    assert_eq!(current_streak(weekdays_only(), &m, d("2026-10-29")), 9);
    assert_eq!(best_streak(weekdays_only(), &m), 9);
}

#[test]
fn extra_saturday_mark_does_not_split_best_streak() {
    let m = marks(&[
        "2026-10-19",
        "2026-10-20",
        "2026-10-21",
        "2026-10-22",
        "2026-10-23",
        "2026-10-24", // sábado, fuera de cadencia
        "2026-10-26",
        "2026-10-27",
    ]);
    assert_eq!(best_streak(weekdays_only(), &m), 7);
    assert_eq!(current_streak(weekdays_only(), &m, d("2026-10-27")), 7);
}

#[test]
fn streak_has_margin_while_today_is_unmarked() {
    let m = marks(&["2026-10-27", "2026-10-28"]);
    assert_eq!(current_streak(DAILY, &m, d("2026-10-29")), 2);
    // un día sin marcar antes de hoy sí la rompe
    assert_eq!(current_streak(DAILY, &m, d("2026-10-30")), 0);

    // L–V: el lunes sin marcar se ancla en el viernes anterior
    let m = marks(&[
        "2026-10-26",
        "2026-10-27",
        "2026-10-28",
        "2026-10-29",
        "2026-10-30",
    ]);
    assert_eq!(current_streak(weekdays_only(), &m, d("2026-11-02")), 5);
}

/// v1 `test_streak_counts_scheduled_days_only`.
#[test]
fn single_weekday_habit_previous_occasion_is_a_week_ago() {
    let thursdays = Cadence::Daily {
        days: WeekdaySet::parse("3").unwrap(),
    };
    let m = marks(&["2026-10-22"]);
    assert_eq!(current_streak(thursdays, &m, d("2026-10-29")), 1);
    assert_eq!(mark(thursdays, &m, d("2026-10-29"), 20).unwrap().streak, 2);
}

/// v1 `test_weekly_target_needs_every_mark`.
#[test]
fn weekly_target_needs_every_mark() {
    let twice = Cadence::Weekly {
        target: WeeklyTarget::new(2).unwrap(),
    };
    let today = d("2026-10-29");

    let mut m = marks(&["2026-10-19"]);
    assert_eq!(current_streak(twice, &m, today), 0); // 1 de 2 no cierra la semana
    m.insert(d("2026-10-22"));
    assert_eq!(current_streak(twice, &m, today), 1);

    assert!(mark(twice, &m, today, 20).is_ok());
    m.insert(today);
    assert_eq!(
        mark(twice, &m, today, 20),
        Err(MarkRejected::AlreadyDoneToday)
    );

    m.insert(d("2026-10-27"));
    assert_eq!(current_streak(twice, &m, today), 2);
    assert_eq!(
        mark(twice, &m, d("2026-10-30"), 20),
        Err(MarkRejected::WeeklyTargetMet)
    );
}

#[test]
fn marking_twice_same_day_is_rejected() {
    let m = marks(&["2026-10-29"]);
    assert_eq!(
        mark(DAILY, &m, d("2026-10-29"), 20),
        Err(MarkRejected::AlreadyDoneToday)
    );
}

#[test]
fn first_mark_pays_base_xp() {
    // v1 `test_full_flow`
    let c = mark(DAILY, &Marks::new(), d("2026-10-29"), 20).unwrap();
    assert_eq!((c.streak, c.xp), (1, 20));
}

#[test]
fn multiplier_uses_previous_streak_plus_one() {
    let m = marks(&[
        "2026-10-23",
        "2026-10-24",
        "2026-10-25",
        "2026-10-26",
        "2026-10-27",
        "2026-10-28",
    ]);
    let c = mark(DAILY, &m, d("2026-10-29"), 15).unwrap();
    assert_eq!((c.streak, c.xp), (7, 17)); // 15 × 1.10 = 16.5 → 17
}

/// ADR 0005: una marca de ayer que llega tarde desde la cola offline es normal.
#[test]
fn late_mark_for_a_past_day() {
    let m = marks(&["2026-10-27", "2026-10-29"]);
    let c = mark(DAILY, &m, d("2026-10-28"), 20).unwrap();
    assert_eq!(c.streak, 2);

    let mut m = m;
    m.insert(d("2026-10-28"));
    assert_eq!(current_streak(DAILY, &m, d("2026-10-29")), 3);
}
