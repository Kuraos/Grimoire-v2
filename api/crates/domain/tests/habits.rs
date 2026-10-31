//! Casos de la tarea 0.1 (fase-0.md) y los de rachas/cadencias de la v1
//! (`backend/tests/test_api.py`). Fechas fijas: 2026-10-26 es lunes.

use chrono::{Datelike, NaiveDate, Weekday};
use grimoire_domain::cadence::{Cadence, InvalidWeeklyTarget, WeekdaySet, WeeklyTarget};
use grimoire_domain::habits::{
    MarkRejected, Marks, UndoRejected, WindowedStreak, best_streak, check_mark_day, check_undo,
    completion_rate, current_streak, current_streak_since, done_units, heatmap_window_start,
    history_window_start, mark, recent_completion_rate, total_units,
};
use grimoire_domain::xp::{
    apply_multiplier, award_xp, streak_multiplier, title_for_level, xp_for_level, xp_to_level,
};

fn d(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

fn marks(days: &[&str]) -> Marks {
    days.iter().map(|s| d(s)).collect()
}

#[test]
fn completion_counts_only_what_the_habit_asked_for() {
    // L–V del lunes 26 al domingo 1: 5 ocasiones; el sábado marcado no cuenta
    let lv = Cadence::Daily {
        days: WeekdaySet::parse("0,1,2,3,4").unwrap(),
    };
    let m = marks(&["2026-10-26", "2026-10-27", "2026-10-31"]);
    assert_eq!(done_units(lv, &m), 2);
    assert_eq!(total_units(lv, d("2026-10-26"), d("2026-11-01")), 5);
    assert_eq!(
        total_units(lv, d("2026-10-31"), d("2026-11-01")),
        1,
        "piso en 1"
    );

    // semanal 2×: solo cuenta la semana que alcanza la meta
    let weekly = Cadence::Weekly {
        target: WeeklyTarget::new(2).unwrap(),
    };
    let m = marks(&["2026-10-26", "2026-10-28", "2026-11-02"]);
    assert_eq!(done_units(weekly, &m), 1);
    assert_eq!(total_units(weekly, d("2026-10-28"), d("2026-11-02")), 2);
}

#[test]
fn completion_rate_rounds_like_python() {
    assert_eq!(completion_rate(2, 3), 66.7);
    assert_eq!(completion_rate(1, 16), 6.2, "6,25 exacto: mitad al par");
    assert_eq!(completion_rate(3, 16), 18.8, "18,75 exacto: mitad al par");
    assert_eq!(completion_rate(7, 5), 100.0, "tope en 100");
}

const DAILY: Cadence = Cadence::Daily { days: None };

// ---------- Constancia de 90 días (caracterizacion-v1.md, fila 10) ----------

/// Días desde `first` hasta `last`, cada `step`.
fn every(first: &str, last: &str, step: usize) -> Marks {
    d(first)
        .iter_days()
        .take_while(|x| *x <= d(last))
        .step_by(step)
        .collect()
}

#[test]
fn recent_rate_forgets_what_is_older_than_the_window() {
    // hoy − 90 = 2026-07-31. Todo marcado antes de la ventana y nada después: sobre todo el
    // historial serían 576 de 667 (86,4 %), y la constancia reciente es 0.
    let m = every("2025-01-01", "2026-07-30", 1);
    assert_eq!(
        recent_completion_rate(DAILY, &m, d("2025-01-01"), d("2026-10-29")),
        0.0
    );
    // al revés: abandonado y retomado justo al abrir la ventana, 100 %
    let m = every("2026-07-31", "2026-10-29", 1);
    assert_eq!(m.len(), 91, "la ventana incluye hoy − 90 y hoy");
    assert_eq!(
        recent_completion_rate(DAILY, &m, d("2025-01-01"), d("2026-10-29")),
        100.0
    );
}

#[test]
fn recent_rate_of_a_new_habit_counts_from_its_creation() {
    // 2 de 4 días desde que existe, no 2 de 91
    let m = marks(&["2026-10-26", "2026-10-28"]);
    assert_eq!(
        recent_completion_rate(DAILY, &m, d("2026-10-26"), d("2026-10-29")),
        50.0
    );
}

#[test]
fn recent_rate_counts_scheduled_days_only() {
    // L–V en la ventana: 2026-07-31 (viernes) a 2026-10-29 (jueves) son 65 días programados.
    // Todos los días marcados, 91 marcas: 100 %, sin contar fines de semana.
    let m = every("2026-07-31", "2026-10-29", 1);
    assert_eq!(
        recent_completion_rate(weekdays_only(), &m, d("2025-01-01"), d("2026-10-29")),
        100.0
    );
    // solo un día programado de 65: 1,5 %
    let m = marks(&["2026-10-29"]);
    assert_eq!(
        recent_completion_rate(weekdays_only(), &m, d("2025-01-01"), d("2026-10-29")),
        1.5
    );
}

#[test]
fn recent_rate_ignores_the_week_cut_by_the_window() {
    // hoy = jueves 2026-10-29; hoy − 90 = viernes 2026-07-31. Esa semana (lun 07-27) queda
    // cortada: la primera entera es la del lunes 08-03, y hasta la de hoy (lun 10-26) son 13.
    let weekly = Cadence::Weekly {
        target: WeeklyTarget::new(2).unwrap(),
    };
    let today = d("2026-10-29");
    // la semana cortada cumplió la meta, pero no suma ni en la cifra ni en el total
    let cut = marks(&["2026-07-31", "2026-08-01"]);
    assert_eq!(
        recent_completion_rate(weekly, &cut, d("2025-01-01"), today),
        0.0
    );
    // una semana entera cumplida de 13
    let one = marks(&["2026-08-03", "2026-08-04"]);
    assert_eq!(
        recent_completion_rate(weekly, &one, d("2025-01-01"), today),
        7.7
    );
    // creado dentro de la semana cortada: esa semana sí es suya, porque no hay marcas
    // anteriores que se hayan quedado fuera. 14 semanas.
    assert_eq!(
        recent_completion_rate(weekly, &cut, d("2026-07-31"), today),
        7.1
    );
}

#[test]
fn recent_rate_is_the_same_with_the_window_or_the_full_history() {
    // el worker le pasa solo la ventana a unos hábitos y el historial completo a otros
    let today = d("2026-10-29");
    let weekly = Cadence::Weekly {
        target: WeeklyTarget::new(2).unwrap(),
    };
    let full = every("2025-01-01", "2026-10-29", 3);
    let window: Marks = full.range(history_window_start(today)..).copied().collect();
    for c in [DAILY, weekdays_only(), weekly] {
        assert_eq!(
            recent_completion_rate(c, &full, d("2025-01-01"), today),
            recent_completion_rate(c, &window, d("2025-01-01"), today)
        );
    }
}

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
    let today = d("2026-10-29");
    assert_eq!(mark(thursdays, &m, today, today, 20).unwrap().streak, 2);
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

    // la marca de hoy no cierra la semana: la racha real sigue en 1, aunque el XP
    // se pague con previa + 1 = 2 (caracterizacion-v1.md, fila 6)
    assert_eq!(mark(twice, &m, today, today, 20).unwrap().streak, 1);
    m.insert(today);
    assert_eq!(
        mark(twice, &m, today, today, 20),
        Err(MarkRejected::AlreadyDoneToday)
    );

    m.insert(d("2026-10-27"));
    assert_eq!(current_streak(twice, &m, today), 2);
    assert_eq!(
        mark(twice, &m, d("2026-10-30"), d("2026-10-30"), 20),
        Err(MarkRejected::WeeklyTargetMet)
    );
}

#[test]
fn marking_twice_same_day_is_rejected() {
    let m = marks(&["2026-10-29"]);
    assert_eq!(
        mark(DAILY, &m, d("2026-10-29"), d("2026-10-29"), 20),
        Err(MarkRejected::AlreadyDoneToday)
    );
}

#[test]
fn first_mark_pays_base_xp() {
    // v1 `test_full_flow`
    let c = mark(DAILY, &Marks::new(), d("2026-10-29"), d("2026-10-29"), 20).unwrap();
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
    let c = mark(DAILY, &m, d("2026-10-29"), d("2026-10-29"), 15).unwrap();
    assert_eq!((c.streak, c.xp), (7, 17)); // 15 × 1.10 = 16.5 → 17
}

/// ADR 0005: una marca de ayer que llega tarde desde la cola offline es normal.
#[test]
fn late_mark_for_a_past_day() {
    let m = marks(&["2026-10-27", "2026-10-29"]);
    // tapa el hueco: la racha real de hoy pasa a 3, pero el XP se paga con la
    // racha del día de la marca, previa + 1 = 2 (sin multiplicador)
    let c = mark(DAILY, &m, d("2026-10-28"), d("2026-10-29"), 20).unwrap();
    assert_eq!((c.streak, c.xp), (3, 20));

    let mut m = m;
    m.insert(d("2026-10-28"));
    assert_eq!(current_streak(DAILY, &m, d("2026-10-29")), 3);
}

#[test]
fn grace_window_is_today_yesterday_and_the_day_before() {
    let today = d("2026-10-29");
    for ok in ["2026-10-27", "2026-10-28", "2026-10-29"] {
        assert_eq!(
            check_mark_day(d(ok), today, d("2026-10-01")),
            Ok(()),
            "{ok}"
        );
    }
    for bad in ["2026-10-26", "2026-10-30"] {
        assert_eq!(
            check_mark_day(d(bad), today, d("2026-10-01")),
            Err(MarkRejected::OutsideGraceWindow),
            "{bad}"
        );
    }
}

/// v1: «un hábito no cuenta antes de existir». Creado hoy, «ayer» está dentro de la
/// ventana de gracia pero antes de que el hábito existiera.
#[test]
fn no_marks_before_the_habit_existed() {
    let today = d("2026-10-29");
    assert_eq!(
        check_mark_day(d("2026-10-28"), today, today),
        Err(MarkRejected::BeforeHabitCreated)
    );
    assert_eq!(check_mark_day(today, today, today), Ok(()));
    // creado ayer: ayer y hoy sí, anteayer no
    let created = d("2026-10-28");
    assert_eq!(check_mark_day(d("2026-10-28"), today, created), Ok(()));
    assert_eq!(
        check_mark_day(d("2026-10-27"), today, created),
        Err(MarkRejected::BeforeHabitCreated)
    );
}

// ---------- ventana de historial (ADR 0007) ----------

fn days_back(today: NaiveDate, from_days: u64, to_days: u64) -> Marks {
    (to_days..=from_days)
        .map(|i| today - chrono::Days::new(i))
        .collect()
}

#[test]
fn window_starts_90_days_back() {
    assert_eq!(history_window_start(d("2026-10-29")), d("2026-07-31"));
}

/// Un domingo, el caso más largo: la rejilla de 53 semanas empieza en el lunes de hoy − 370.
#[test]
fn heatmap_window_covers_the_53_week_grid() {
    let start = heatmap_window_start(d("2026-11-01"));
    assert_eq!(start, d("2025-10-27"));
    assert_eq!(start.weekday(), Weekday::Mon);
}

#[test]
fn short_streak_inside_window_is_exact() {
    let today = d("2026-10-29");
    let m = days_back(today, 5, 1); // ayer y los 4 días anteriores
    assert_eq!(
        current_streak_since(DAILY, &m, today, d("2026-07-31")),
        WindowedStreak::Exact(5)
    );
}

#[test]
fn streak_reaching_window_start_is_at_edge() {
    let today = d("2026-10-29");
    let from = d("2026-10-20");
    // marcado todos los días desde `from`: el día anterior podría estar marcado
    let m = days_back(today, 9, 1);
    assert_eq!(
        current_streak_since(DAILY, &m, today, from),
        WindowedStreak::AtEdge
    );
    // si `from` mismo no está marcado, la racha terminó dentro: es exacta
    let m = days_back(today, 8, 1);
    assert_eq!(
        current_streak_since(DAILY, &m, today, from),
        WindowedStreak::Exact(8)
    );
}

#[test]
fn margin_unit_before_window_is_at_edge() {
    // hoy sin marcar y la ventana empieza hoy: no se sabe si ayer se marcó
    let today = d("2026-10-29");
    assert_eq!(
        current_streak_since(DAILY, &Marks::new(), today, today),
        WindowedStreak::AtEdge
    );
}

#[test]
fn weekly_week_partially_outside_window_is_at_edge() {
    let once = Cadence::Weekly {
        target: WeeklyTarget::new(1).unwrap(),
    };
    let today = d("2026-10-29"); // jueves
    // una marca cada martes desde el 2026-10-06; la ventana empieza el miércoles
    // 2026-10-08, así que la semana del 10-05 queda partida
    let m = marks(&["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]);
    let window: Marks = m
        .iter()
        .copied()
        .filter(|&x| x >= d("2026-10-08"))
        .collect();
    assert_eq!(
        current_streak_since(once, &window, today, d("2026-10-08")),
        WindowedStreak::AtEdge
    );
    // sin marca la semana del 10-12, la racha termina dentro de la ventana
    let m = marks(&["2026-10-06", "2026-10-20", "2026-10-27"]);
    let window: Marks = m
        .iter()
        .copied()
        .filter(|&x| x >= d("2026-10-08"))
        .collect();
    assert_eq!(
        current_streak_since(once, &window, today, d("2026-10-08")),
        WindowedStreak::Exact(2)
    );
}

/// Propiedad: con las marcas recortadas a la ventana, una respuesta `Exact(n)` es la
/// misma racha que con todo el historial. Generador determinista (LCG), sin
/// dependencias.
#[test]
fn windowed_exact_matches_full_history() {
    let mut seed: u64 = 20261029;
    let mut next = move |n: u64| {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (seed >> 33) % n
    };
    let cadences = [
        DAILY,
        weekdays_only(),
        Cadence::Daily {
            days: WeekdaySet::parse("1,4").unwrap(),
        },
        Cadence::Weekly {
            target: WeeklyTarget::new(1).unwrap(),
        },
        Cadence::Weekly {
            target: WeeklyTarget::new(3).unwrap(),
        },
    ];
    let base = d("2026-10-29");
    let (mut exact, mut edge) = (0, 0);
    for case in 0..5000 {
        let cadence = cadences[case % cadences.len()];
        let today = base - chrono::Days::new(next(14));
        // densidad alta para que haya rachas largas que crucen la ventana
        let keep = 70 + next(30);
        let all: Marks = (0..200u64)
            .map(|i| today - chrono::Days::new(i))
            .filter(|_| next(100) < keep)
            .collect();
        let from = today - chrono::Days::new(next(40));
        let window: Marks = all.iter().copied().filter(|&x| x >= from).collect();
        match current_streak_since(cadence, &window, today, from) {
            WindowedStreak::Exact(n) => {
                exact += 1;
                assert_eq!(
                    n,
                    current_streak(cadence, &all, today),
                    "caso {case}: {cadence:?} hoy={today} from={from}"
                );
            }
            WindowedStreak::AtEdge => edge += 1,
        }
    }
    // el generador cubre los dos resultados
    assert!(exact > 500 && edge > 500, "exact={exact} edge={edge}");
}

#[test]
fn undo_window_daily_is_the_grace_window() {
    let today = d("2026-10-29");
    for on in ["2026-10-27", "2026-10-28", "2026-10-29"] {
        assert_eq!(check_undo(DAILY, d(on), today), Ok(()), "{on}");
    }
    for on in ["2026-10-26", "2026-10-30"] {
        assert_eq!(
            check_undo(DAILY, d(on), today),
            Err(UndoRejected::OutsideUndoWindow),
            "{on}"
        );
    }
}

/// v1 `_completion_period`: en un semanal se deshace dentro de la semana ISO en curso.
#[test]
fn undo_window_weekly_is_the_current_week() {
    let twice = Cadence::Weekly {
        target: WeeklyTarget::new(2).unwrap(),
    };
    let thursday = d("2026-10-29");
    assert_eq!(check_undo(twice, d("2026-10-26"), thursday), Ok(())); // lunes
    assert_eq!(
        check_undo(twice, d("2026-10-25"), thursday), // domingo anterior
        Err(UndoRejected::OutsideUndoWindow)
    );
}
