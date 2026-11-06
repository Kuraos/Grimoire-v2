//! Reproduce con funciones puras la parte de regla de los goldens de pomodoro
//! (`tests/golden/pomodoro/`): XP, nivel, logros y los rechazos de la fila 28. `tarea_y_proyecto` y
//! `rango_dias` son del worker (proyecto heredado, `task_title`, `ON DELETE`, rango) y se
//! reproducen en la 2.3.3.
//!
//! Donde la v2 hace algo distinto, el test afirma el valor nuevo y cita la fila de «Diferencias
//! permitidas» en `docs/tasks/caracterizacion-v1.md`.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeDelta, Utc};
use grimoire_domain::achievements::{PomodoroFacts, earned_on_pomodoro};
use grimoire_domain::pomodoro::{Session, SessionDecision, SessionRejected, register};
use grimoire_domain::xp::{award_xp, title_for_level, xp_to_level};
use serde_json::Value;

/// Bogotá es UTC−5 todo el año.
const BOGOTA: TimeDelta = TimeDelta::hours(5);

struct Logged {
    work_minutes: i64,
    completed: bool,
    project: Option<String>,
}

#[derive(Default)]
struct Sim {
    xp: i64,
    achievements: BTreeSet<&'static str>,
    sessions: Vec<Logged>,
    /// (alias, nombre), en orden de creación.
    projects: Vec<(String, String)>,
    /// Lo que la v1 pagó y la v2 rechaza (fila 28).
    rejected: Vec<SessionRejected>,
}

fn int(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("no es entero: {v}"))
}

fn alias_of(s: &str) -> Option<&str> {
    let start = s.find('{')? + 1;
    Some(&s[start..s.find('}')?])
}

/// Mediodía en Bogotá, la `hora_local` de todos los goldens: la v1 sella ahí `finished_at`. En la v2
/// es el `ends_at` del cliente (fila 25), y se usa el mismo instante.
fn noon(day: NaiveDate) -> DateTime<Utc> {
    day.and_hms_opt(12, 0, 0).unwrap().and_utc() + BOGOTA
}

/// `started_at` del cuerpo: con zona, tal cual; sin zona, hora de Bogotá.
fn instant(s: &str) -> DateTime<Utc> {
    s.parse().unwrap_or_else(|_| {
        s.parse::<NaiveDateTime>()
            .unwrap_or_else(|_| panic!("fecha: {s}"))
            .and_utc()
            + BOGOTA
    })
}

impl Sim {
    fn completed(&self) -> u32 {
        self.sessions.iter().filter(|s| s.completed).count() as u32
    }

    fn minutes(&self, project: Option<&str>) -> i64 {
        self.sessions
            .iter()
            .filter(|s| s.completed && (project.is_none() || s.project.as_deref() == project))
            .map(|s| s.work_minutes)
            .sum()
    }

    fn post_session(&mut self, name: &str, on: NaiveDate, body: &Value, status: i64, want: &Value) {
        if status == 422 {
            // tipo equivocado («muchos», 25.5, «ayer», «quizás»): lo rechaza la deserialización del
            // worker antes de llegar aquí
            return;
        }
        assert_eq!(status, 200, "{name}");
        let now = noon(on);
        let work_minutes = body["work_minutes"].as_i64().unwrap_or(25);
        let completed = body["completed"].as_bool().unwrap_or(true);
        // En la v2 el cliente manda las dos horas, siempre (fila 25). Sin `started_at`, el cliente
        // habría mandado lo que la v1 deducía: el final menos los minutos.
        let started_at = body["started_at"]
            .as_str()
            .map_or(now - TimeDelta::minutes(work_minutes), instant);
        let session = Session {
            work_minutes,
            completed,
            started_at,
            finished_at: now,
        };

        let decision = match register(session, false, now) {
            Err(e) => {
                // fila 28: la v1 lo pagaba; la v2 responde 422 y no guarda nada
                assert_eq!(
                    name, "validacion_sesion",
                    "{name}: rechazo inesperado {e:?}"
                );
                self.rejected.push(e);
                return;
            }
            Ok(d) => d,
        };
        // fila 27: el mismo id otra vez no vuelve a pagar ni a guardar
        assert_eq!(register(session, true, now), Ok(SessionDecision::Replay));

        let project = body["project_id"]
            .as_str()
            .and_then(alias_of)
            .map(Into::into);
        self.sessions.push(Logged {
            work_minutes,
            completed,
            project,
        });

        let (applied, new) = match decision {
            SessionDecision::Grant { xp } => {
                let change = award_xp(self.xp, xp);
                assert_eq!(change.leveled_up, want["leveled_up"], "{name}: leveled_up");
                self.xp = change.new_xp;
                let earned = earned_on_pomodoro(PomodoroFacts {
                    level: change.new_level,
                    completed_sessions: self.completed(),
                });
                let new: Vec<&'static str> = earned
                    .into_iter()
                    .filter(|k| !self.achievements.contains(k))
                    .collect();
                self.achievements.extend(&new);
                (change.applied, new)
            }
            SessionDecision::RecordOnly => {
                assert_eq!(want["leveled_up"], false);
                (0, Vec::new())
            }
            SessionDecision::Replay => unreachable!("el id es nuevo"),
        };

        // fila 4: la v1 solo informa el primero
        assert_eq!(
            new.first().copied(),
            want["achievement_unlocked"].as_str(),
            "{name}: logros {new:?}"
        );
        assert_eq!(applied, int(&want["xp_earned"]), "xp_earned");
        assert_eq!(self.xp, int(&want["new_xp"]), "new_xp");
        let level = xp_to_level(self.xp);
        assert_eq!(i64::from(level), int(&want["new_level"]), "new_level");
        assert_eq!(title_for_level(level), want["title"], "title");
        // todas las sesiones de estos goldens son del mismo día
        assert_eq!(self.minutes(None), int(&want["total_today_minutes"]));
        // fila 32: la v1 manda `streak: null`; la v2 no lo manda
        assert!(want["streak"].is_null());
    }

    fn step(&mut self, name: &str, step: &Value) {
        let (method, path) = step["llamada"].as_str().unwrap().split_once(' ').unwrap();
        let on: NaiveDate = step["hoy"].as_str().unwrap().parse().unwrap();
        let status = int(&step["esperado"]["status"]);
        let want = &step["esperado"]["cuerpo"];
        match (method, path) {
            // fila 28: la v1 guardó y pagó las 4 que la v2 rechaza; aquí no hay nada
            ("GET", "/pomodoro/today" | "/user") if name == "validacion_sesion" => {
                assert!(self.sessions.is_empty() && self.xp == 0);
                let v1 = want
                    .get("xp")
                    .map_or_else(|| want.as_array().unwrap().len() as i64, |xp| int(xp) / 15);
                assert_eq!(v1, self.rejected.len() as i64, "{path}");
            }
            ("POST", "/pomodoro/sessions") => {
                self.post_session(name, on, &step["cuerpo"], status, want);
            }
            ("POST", "/projects") => self.projects.push((
                step["alias"].as_str().unwrap().into(),
                step["cuerpo"]["name"].as_str().unwrap().into(),
            )),
            ("GET", "/pomodoro/today") => {
                // Orden, ids y horas son del worker (2.3.3; ids UUID, invariante 2). Aquí: las
                // mismas sesiones, completas o no.
                let sort = |mut v: Vec<(i64, bool)>| {
                    v.sort();
                    v
                };
                let v1 = want
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| (int(&s["work_minutes"]), s["completed"].as_bool().unwrap()))
                    .collect();
                let got = self
                    .sessions
                    .iter()
                    .map(|s| (s.work_minutes, s.completed))
                    .collect();
                assert_eq!(sort(got), sort(v1), "{name}: sesiones del día");
            }
            ("GET", "/projects") => {
                for p in want.as_array().unwrap() {
                    let (alias, _) = self
                        .projects
                        .iter()
                        .find(|(_, n)| p["name"] == n.as_str())
                        .expect("proyecto de la lista");
                    let minutes = self.minutes(Some(alias));
                    // fila 31: la v2 manda `pomodoro_minutes` y el cliente redondea mitades hacia
                    // arriba (`pomodoroHours`). Estos minutos no caen en una mitad exacta, así que
                    // coincide con el `round()` de la v1.
                    let hours = p["pomodoro_hours"].as_f64().unwrap();
                    assert_eq!((hours * 10.0).round() as i64, (minutes + 3) / 6, "{alias}");
                }
            }
            ("GET", "/user") => {
                assert_eq!(self.xp, int(&want["xp"]), "xp");
                let level = xp_to_level(self.xp);
                assert_eq!(i64::from(level), int(&want["level"]), "level");
                assert_eq!(title_for_level(level), want["title"], "title");
            }
            ("GET", "/achievements") => {
                let v1: BTreeSet<&str> = want
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect();
                let got: BTreeSet<&str> = self.achievements.iter().copied().collect();
                assert_eq!(got, v1, "{name}: logros");
            }
            _ => panic!("{name}: llamada sin simular: {method} {path}"),
        }
    }
}

fn run(name: &str) -> Sim {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden/pomodoro")
        .join(format!("{name}.json"));
    let golden: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let mut sim = Sim::default();
    for (i, step) in golden["pasos"].as_array().unwrap().iter().enumerate() {
        eprintln!("{name}, paso {i}: {}", step["llamada"]);
        sim.step(name, step);
    }
    sim
}

#[test]
fn sesion_xp() {
    let sim = run("sesion_xp");
    assert_eq!((sim.xp, sim.completed()), (405, 27));
}

#[test]
fn sesion_incompleta() {
    let sim = run("sesion_incompleta");
    assert_eq!(sim.xp, 15);
    assert_eq!(sim.sessions.len(), 3);
    assert!(sim.achievements.is_empty());
}

#[test]
fn logros_pomodoro() {
    let sim = run("logros_pomodoro");
    assert_eq!(
        sim.achievements,
        BTreeSet::from(["ascension", "focus_centurion", "focus_legend"])
    );
    assert_eq!(sim.completed(), 250);
}

#[test]
fn validacion_sesion() {
    let sim = run("validacion_sesion");
    // fila 28: 0, −5 y 100 000 minutos, y un `started_at` en 2030, que la v1 pagaba
    assert_eq!(
        sim.rejected,
        [
            SessionRejected::WorkMinutesOutOfRange,
            SessionRejected::WorkMinutesOutOfRange,
            SessionRejected::WorkMinutesOutOfRange,
            SessionRejected::StartsAfterEnd,
        ]
    );
    // nada se guardó ni pagó: la v1 terminaba con 60 XP y 4 sesiones
    assert_eq!(sim.xp, 0);
    assert!(sim.sessions.is_empty());
}
