//! Reproduce los goldens de la v1 (`tests/golden/habits/*.json`, generados con
//! `scripts/characterize_v1.py`) con las funciones puras del dominio.
//!
//! Un simulador mínimo traduce cada llamada a la API de la v1 a funciones del dominio y
//! compara campo por campo. Donde la v2 hace algo distinto por decisión, el test no
//! compara: afirma el valor nuevo y cita la fila de «Diferencias permitidas» en
//! `docs/tasks/caracterizacion-v1.md`.
//!
//! Lo que este test todavía no cubre, y dónde se cubre:
//! - vidas y `evaluate-streaks` (2.1.2): el XP de la penalización de la v1 se inyecta
//!   desde el golden para seguir comparando los pasos siguientes (filas 2 y 3);
//! - `completion_rate` (2.1.4, agregado en SQL) y los campos de la barra de XP de
//!   `GET /user` (2.1.2);
//! - los mensajes de rechazo, que son del worker.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::Path;

use chrono::NaiveDate;
use grimoire_domain::achievements::{MarkFacts, earned_on_mark, total_discipline};
use grimoire_domain::cadence::{Cadence, WeekdaySet, WeeklyTarget, week_monday};
use grimoire_domain::habits::{
    MarkRejected, Marks, best_streak, check_mark_day, check_undo, current_streak, mark,
};
use grimoire_domain::lives::DailyHabit;
use grimoire_domain::xp::{award_xp, title_for_level, xp_to_level};
use serde_json::Value;

struct Habit {
    category: String,
    cadence: Cadence,
    xp_reward: u32,
    created: NaiveDate,
    /// Día de cada marca viva → XP que concedió.
    grants: BTreeMap<NaiveDate, i64>,
    /// Lo que la v1 deja de más en el `total_xp` del hábito al deshacer con el XP
    /// recortado por el piso: concesión + lo devuelto de verdad (fila 5).
    v1_undo_residue: i64,
}

impl Habit {
    fn marks(&self) -> Marks {
        self.grants.keys().copied().collect()
    }
}

#[derive(Default)]
struct Sim {
    habits: HashMap<String, Habit>,
    xp: i64,
    achievements: BTreeSet<&'static str>,
    /// Cada desbloqueo: día y lista completa, en orden.
    unlocks: Vec<(NaiveDate, Vec<&'static str>)>,
}

fn date(v: &Value) -> NaiveDate {
    v.as_str().unwrap().parse().unwrap()
}

fn int(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("no es entero: {v}"))
}

fn cadence(body: &Value) -> Cadence {
    if body["frequency"] == "weekly" {
        let target = body["target_per_week"].as_u64().unwrap_or(1);
        Cadence::Weekly {
            target: WeeklyTarget::new(target as u8).unwrap(),
        }
    } else {
        Cadence::Daily {
            days: WeekdaySet::parse(body["days"].as_str().unwrap_or("")).unwrap(),
        }
    }
}

/// Compara los campos de XP de una respuesta de marcar o deshacer.
fn check_xp_event(got: &grimoire_domain::xp::XpChange, want: &Value) {
    assert_eq!(got.applied, int(&want["xp_earned"]), "xp_earned");
    assert_eq!(got.new_xp, int(&want["new_xp"]), "new_xp");
    assert_eq!(
        u64::from(got.new_level),
        want["new_level"].as_u64().unwrap(),
        "new_level"
    );
    assert_eq!(got.title, want["title"], "title");
    assert_eq!(got.leveled_up, want["leveled_up"], "leveled_up");
}

impl Sim {
    /// Los logros nuevos tras una marca aceptada, con el criterio del worker.
    fn unlock(&mut self, today: NaiveDate, streak: u32, level: u32) -> Vec<&'static str> {
        let marks: Vec<(&Habit, Marks)> = self.habits.values().map(|h| (h, h.marks())).collect();
        let daily: Vec<DailyHabit> = marks
            .iter()
            .filter_map(|(h, m)| match h.cadence {
                Cadence::Daily { days } => Some(DailyHabit {
                    id: "",
                    days,
                    created_on: h.created,
                    marks: m,
                }),
                Cadence::Weekly { .. } => None,
            })
            .collect();
        let new: Vec<&'static str> = earned_on_mark(MarkFacts {
            level,
            // fila 8: solo la del hábito marcado; la de otro hábito no sube con esta marca
            streak,
            active_categories: marks
                .iter()
                .map(|(h, _)| h.category.as_str())
                .collect::<BTreeSet<_>>()
                .len(),
            total_discipline: total_discipline(&daily, today),
        })
        .into_iter()
        .filter(|k| !self.achievements.contains(k))
        .collect();
        self.achievements.extend(&new);
        if !new.is_empty() {
            self.unlocks.push((today, new.clone()));
        }
        new
    }

    fn step(&mut self, today: NaiveDate, call: &str, step: &Value) {
        let want = &step["esperado"];
        let status = int(&want["status"]);
        let body = &want["cuerpo"];
        let (method, path) = call.split_once(' ').unwrap();
        let alias = path
            .split('/')
            .find_map(|seg| seg.strip_prefix('{')?.strip_suffix('}'));

        match (method, path) {
            ("POST", "/habits") => {
                assert_eq!(status, 201);
                let req = &step["cuerpo"];
                let h = Habit {
                    category: req["category"].as_str().unwrap().into(),
                    cadence: cadence(req),
                    xp_reward: req["xp_reward"].as_u64().unwrap_or(20) as u32,
                    created: today,
                    grants: BTreeMap::new(),
                    v1_undo_residue: 0,
                };
                assert_eq!(body["streak"], 0);
                assert_eq!(body["done_today"], false);
                self.habits
                    .insert(step["alias"].as_str().unwrap().into(), h);
            }
            ("POST", p) if p.ends_with("/complete") => {
                let h = self.habits.get_mut(alias.unwrap()).unwrap();
                let marks = h.marks();
                check_mark_day(today, today, h.created).unwrap();
                match mark(h.cadence, &marks, today, today, h.xp_reward) {
                    Err(r) => {
                        assert_eq!(status, 400, "la v2 rechaza ({r:?}) y la v1 no");
                        let detail = body["detail"].as_str().unwrap();
                        let v1 = if detail.contains("completado hoy") {
                            MarkRejected::AlreadyDoneToday
                        } else {
                            MarkRejected::WeeklyTargetMet
                        };
                        assert_eq!(r, v1, "{detail}");
                    }
                    Ok(c) => {
                        assert_eq!(status, 200, "la v1 rechaza y la v2 no");
                        let xp = award_xp(self.xp, c.xp);
                        check_xp_event(&xp, body);
                        // fila 6: la v1 responde la racha que decide el multiplicador
                        // (previa + 1); la v2, la real tras la marca. Solo difieren en
                        // un semanal cuya semana no queda cerrada.
                        let paid = current_streak(h.cadence, &marks, today) + 1;
                        assert_eq!(int(&body["streak"]), i64::from(paid), "streak v1");
                        if c.streak != paid {
                            assert!(matches!(h.cadence, Cadence::Weekly { .. }), "fila 6");
                        }
                        self.xp = xp.new_xp;
                        h.grants.insert(today, xp.applied);
                        // fila 4: la v1 informa el primero; la v2, la lista entera
                        let new = self.unlock(today, c.streak, xp.new_level);
                        assert_eq!(
                            body["achievement_unlocked"].as_str(),
                            new.first().copied(),
                            "achievement_unlocked"
                        );
                    }
                }
            }
            ("DELETE", p) if p.ends_with("/complete") => {
                let h = self.habits.get_mut(alias.unwrap()).unwrap();
                // v1: deshace la marca más reciente del periodo (hoy, o la semana ISO
                // en curso si es semanal). La v2 recibe el id de la marca; la UI
                // deshace la última, que es esta.
                let start = match h.cadence {
                    Cadence::Weekly { .. } => week_monday(today),
                    Cadence::Daily { .. } => today,
                };
                let Some(on) = h.marks().range(start..=today).next_back().copied() else {
                    assert_eq!(status, 400, "la v1 deshizo algo que la v2 no encuentra");
                    return;
                };
                assert_eq!(status, 200);
                check_undo(h.cadence, on, today).unwrap();
                let grant = h.grants.remove(&on).unwrap();
                let xp = award_xp(self.xp, -grant);
                check_xp_event(&xp, body);
                assert_eq!(
                    int(&body["streak"]),
                    i64::from(current_streak(h.cadence, &h.marks(), today)),
                    "streak"
                );
                self.xp = xp.new_xp;
                // fila 5: la v2 quita la concesión entera del total del hábito
                h.v1_undo_residue += grant + xp.applied;
            }
            ("GET", "/user") => {
                assert_eq!(int(&body["xp"]), self.xp, "xp");
                let level = xp_to_level(self.xp);
                assert_eq!(u64::from(level), body["level"].as_u64().unwrap(), "level");
                assert_eq!(title_for_level(level), body["title"], "title");
                // lives: filas 2 y 3, se prueba en la 2.1.2
            }
            ("GET", _) if alias.is_some() => {
                let h = &self.habits[alias.unwrap()];
                let marks = h.marks();
                let streak = current_streak(h.cadence, &marks, today);
                assert_eq!(int(&body["streak"]), i64::from(streak), "streak");
                let best = best_streak(h.cadence, &marks);
                assert_eq!(int(&body["best_streak"]), i64::from(best), "best_streak");
                assert_eq!(body["done_today"], marks.contains(&today), "done_today");
                let total: i64 = h.grants.values().sum();
                assert_eq!(
                    int(&body["total_xp"]),
                    total + h.v1_undo_residue,
                    "total_xp (fila 5)"
                );
                let last = body["last_completed"]
                    .as_str()
                    .map(|s| s[..10].parse::<NaiveDate>().unwrap());
                assert_eq!(last, marks.last().copied(), "last_completed");
            }
            ("POST", "/user/evaluate-streaks") => {
                // filas 2 y 3: la v1 evalúa con su off-by-one; la v2 asienta con
                // gracia (2.1.2). Se aplica la penalización de la v1 para que los
                // pasos siguientes sigan siendo comparables.
                let xp = award_xp(self.xp, -int(&body["xp_penalty"]));
                assert_eq!(
                    xp.new_xp,
                    int(&body["new_xp"]),
                    "new_xp tras la penalización"
                );
                self.xp = xp.new_xp;
            }
            ("GET", "/achievements") => {
                let want: BTreeSet<&str> = body
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|k| k.as_str().unwrap())
                    .collect();
                assert_eq!(self.achievements, want, "logros desbloqueados");
            }
            _ => panic!("llamada sin traducir: {call}"),
        }
    }
}

fn run(path: &Path) -> Sim {
    let golden: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let mut sim = Sim::default();
    let steps = golden["pasos"].as_array().unwrap();
    for (i, step) in steps.iter().enumerate() {
        let call = step["llamada"].as_str().unwrap();
        let today = date(&step["hoy"]);
        let ctx = format!("{} · paso {i} · {} · {call}", path.display(), step["hoy"]);
        // el contexto en el mensaje de cualquier assert del paso
        let r =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| sim.step(today, call, step)));
        if let Err(e) = r {
            let msg = e
                .downcast_ref::<String>()
                .map(String::as_str)
                .or_else(|| e.downcast_ref::<&str>().copied())
                .unwrap_or("");
            panic!("{ctx}: {msg}");
        }
    }
    sim
}

#[test]
fn goldens_v1_habits() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/habits");
    let mut ran = Vec::new();
    for entry in fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let sim = run(&path);
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        if name == "logros" {
            // fila 4: el 03-08 la v1 solo informaba iron_constancy
            let day: NaiveDate = "2026-03-08".parse().unwrap();
            assert!(
                sim.unlocks
                    .contains(&(day, vec!["iron_constancy", "total_discipline"]))
            );
        }
        ran.push(name);
    }
    ran.sort();
    let names: Vec<&str> = ran.iter().map(String::as_str).collect();
    assert_eq!(
        names,
        [
            "deshacer",
            "dia_perfecto",
            "diario_lv",
            "diario_simple",
            "logros",
            "racha_rota",
            "semanal_2x"
        ]
    );
}
