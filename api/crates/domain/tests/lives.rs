//! Vidas y penalización (ADR 0005). Los escenarios repiten los goldens de la v1 con
//! evaluación diaria, que la v1 no hacía bien (caracterizacion-v1.md, fila 3): los
//! valores esperados salen a mano de las reglas, no de la v1. 2026-03-02 es lunes.

use chrono::NaiveDate;
use grimoire_domain::cadence::WeekdaySet;
use grimoire_domain::habits::{GRACE_DAYS, Marks, check_mark_day};
use grimoire_domain::lives::{
    DailyHabit, DayEvent, MAX_LIVES, Outcome, SETTLE_LAG_DAYS, evaluate_days, provisional_range,
    settle_range,
};

fn d(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

fn marks(days: &[&str]) -> Marks {
    days.iter().map(|s| d(s)).collect()
}

fn habit<'a>(id: &'a str, created: &str, m: &'a Marks) -> DailyHabit<'a> {
    DailyHabit {
        id,
        days: None,
        created_on: d(created),
        marks: m,
    }
}

fn outcomes(events: &[DayEvent]) -> Vec<(NaiveDate, Outcome)> {
    events.iter().map(|e| (e.day, e.outcome)).collect()
}

/// `racha_rota` con evaluación diaria: marcar un día sí y otro no pierde y recupera
/// la vida cada vez, y nunca llega a 0. En la v1 llegaba a 0 porque los días marcados
/// eran días de evaluación y no se evaluaban.
#[test]
fn alternate_days_lose_and_regain() {
    let m = marks(&[
        "2026-03-02",
        "2026-03-04",
        "2026-03-06",
        "2026-03-08",
        "2026-03-10",
    ]);
    let h = [habit("lectura", "2026-03-02", &m)];
    let (lives, ev) = evaluate_days(3, d("2026-03-02")..=d("2026-03-10"), &h);
    assert_eq!(lives, 3);
    use Outcome::*;
    assert_eq!(
        outcomes(&ev),
        [
            (d("2026-03-03"), LifeLost),
            (d("2026-03-04"), LifeRegained),
            (d("2026-03-05"), LifeLost),
            (d("2026-03-06"), LifeRegained),
            (d("2026-03-07"), LifeLost),
            (d("2026-03-08"), LifeRegained),
            (d("2026-03-09"), LifeLost),
            (d("2026-03-10"), LifeRegained),
        ]
    );
    // el 02 es perfecto pero ya hay 3 vidas: no hay evento
    assert_eq!(ev[0].broken, ["lectura"]);
}

/// `dia_perfecto` con evaluación diaria.
#[test]
fn perfect_days_regain_up_to_max() {
    let lectura = marks(&[
        "2026-03-02",
        "2026-03-03",
        "2026-03-05",
        "2026-03-06",
        "2026-03-07",
    ]);
    let agua = marks(&[
        "2026-03-02",
        "2026-03-04",
        "2026-03-05",
        "2026-03-06",
        "2026-03-07",
    ]);
    let h = [
        habit("lectura", "2026-03-02", &lectura),
        habit("agua", "2026-03-02", &agua),
    ];
    let (lives, ev) = evaluate_days(3, d("2026-03-02")..=d("2026-03-07"), &h);
    use Outcome::*;
    assert_eq!(
        outcomes(&ev),
        [
            (d("2026-03-03"), LifeLost),     // agua roto
            (d("2026-03-04"), LifeLost),     // lectura roto
            (d("2026-03-05"), LifeRegained), // perfecto
            (d("2026-03-06"), LifeRegained), // perfecto → 3
        ] // el 07 es perfecto pero ya está en el máximo
    );
    assert_eq!(lives, MAX_LIVES);
    assert_eq!(ev[0].broken, ["agua"]);
    assert_eq!(ev[1].broken, ["lectura"]);
}

/// `diario_lv`: el fin de semana no toca y no cuesta vida; el lunes se rompe (o no)
/// contra el viernes.
#[test]
fn weekdays_habit_weekend_is_transparent() {
    let m = marks(&[
        "2026-03-02",
        "2026-03-03",
        "2026-03-04",
        "2026-03-05",
        "2026-03-06",
        "2026-03-09",
    ]);
    let h = [DailyHabit {
        days: WeekdaySet::parse("0,1,2,3,4").unwrap(),
        ..habit("ingles", "2026-03-02", &m)
    }];
    let (lives, ev) = evaluate_days(3, d("2026-03-02")..=d("2026-03-10"), &h);
    // el martes 10 sí se rompe: el lunes 9 estaba marcado
    assert_eq!(outcomes(&ev), [(d("2026-03-10"), Outcome::LifeLost)]);
    assert_eq!(lives, 2);
}

/// Sin vidas, cada día roto cuesta 15 XP, y un día con varios hábitos rotos cobra una
/// sola vez (v1: `deshacer`, 03-16, `broken_habits: ["Lectura", "Agua"]`).
#[test]
fn penalty_without_lives_once_per_day() {
    let a = marks(&["2026-03-02"]);
    let b = marks(&["2026-03-02"]);
    let h = [
        habit("lectura", "2026-03-02", &a),
        habit("agua", "2026-03-02", &b),
    ];
    let (lives, ev) = evaluate_days(0, d("2026-03-03")..=d("2026-03-04"), &h);
    assert_eq!(lives, 0);
    assert_eq!(outcomes(&ev), [(d("2026-03-03"), Outcome::XpPenalty(15))]);
    assert_eq!(ev[0].broken, ["lectura", "agua"]);
}

#[test]
fn habit_counts_only_from_its_creation() {
    let m = Marks::new();
    let h = [habit("nuevo", "2026-03-05", &m)];
    let (lives, ev) = evaluate_days(2, d("2026-03-02")..=d("2026-03-04"), &h);
    assert_eq!((lives, ev.len()), (2, 0));
}

/// ADR 0005: la vida perdida es provisional. Si la marca de ayer llega tarde, el mismo
/// cálculo ya no la quita.
#[test]
fn late_mark_undoes_provisional_loss() {
    let mut m = marks(&["2026-03-02"]);
    let today = d("2026-03-04");
    let prov = provisional_range(Some(d("2026-03-01")), today).unwrap();
    assert_eq!(prov, d("2026-03-02")..=d("2026-03-03"));
    let (lives, _) = evaluate_days(3, prov.clone(), &[habit("lectura", "2026-03-01", &m)]);
    assert_eq!(lives, 2);

    check_mark_day(d("2026-03-03"), today, d("2026-03-01")).unwrap();
    m.insert(d("2026-03-03"));
    let (lives, ev) = evaluate_days(3, prov, &[habit("lectura", "2026-03-01", &m)]);
    assert_eq!((lives, ev.len()), (3, 0));
}

#[test]
fn settle_and_provisional_ranges() {
    let today = d("2026-03-20");
    // nunca asentado: se recuperan 14 días, hasta hoy − 3
    assert_eq!(
        settle_range(None, today),
        Some(d("2026-03-06")..=d("2026-03-17"))
    );
    // lo normal al abrir cada día: un solo día por asentar
    assert_eq!(
        settle_range(Some(d("2026-03-16")), today),
        Some(d("2026-03-17")..=d("2026-03-17"))
    );
    assert_eq!(settle_range(Some(d("2026-03-17")), today), None);
    // ausencia larga: lo anterior a 14 días se da por asentado sin evaluar (v1)
    assert_eq!(
        settle_range(Some(d("2026-01-01")), today),
        Some(d("2026-03-06")..=d("2026-03-17"))
    );
    assert_eq!(
        provisional_range(Some(d("2026-03-17")), today),
        Some(d("2026-03-18")..=d("2026-03-19"))
    );
}

/// El límite que corrigió el ADR 0005: el día más viejo que todavía acepta marcas
/// (hoy − GRACE_DAYS) nunca se asienta hoy.
#[test]
fn never_settles_a_day_that_still_accepts_marks() {
    assert_eq!(SETTLE_LAG_DAYS, GRACE_DAYS + 1);
    let today = d("2026-03-20");
    let oldest_open = d("2026-03-18");
    check_mark_day(oldest_open, today, d("2026-01-01")).unwrap();
    for settled in [None, Some(d("2026-03-01")), Some(d("2026-03-16"))] {
        if let Some(r) = settle_range(settled, today) {
            assert!(*r.end() < oldest_open, "{settled:?}");
        }
    }
}
