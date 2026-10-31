//! Reproduce con funciones puras la parte de regla de los goldens de tareas
//! (`tests/golden/tasks/`): XP, nivel, rechazos y logros. El CRUD y la validación de la API se
//! reproducen contra el worker en la 2.2.3, con `scripts/replay_golden.py`.
//!
//! Donde la v2 hace algo distinto, el test afirma el valor nuevo y cita la fila de «Diferencias
//! permitidas» en `docs/tasks/caracterizacion-v1.md`.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::Path;

use chrono::NaiveDate;
use grimoire_domain::achievements::{TaskFacts, earned_on_task_complete};
use grimoire_domain::tasks::{
    CompleteDecision, CompleteRejected, TaskStatus, UncompleteDecision, UncompleteInput,
    UncompleteRejected, complete, uncomplete,
};
use grimoire_domain::xp::{award_xp, title_for_level, xp_to_level};
use serde_json::Value;

struct Task {
    status: TaskStatus,
    xp_reward: i64,
    project: Option<String>,
    grant: Option<String>,
    id_v1: i64,
}

#[derive(Default)]
struct Sim {
    tasks: HashMap<String, Task>,
    projects: BTreeSet<String>,
    /// Saldo de cada concesión, como la suma de `xp_log` por `mark_id`.
    balances: HashMap<String, i64>,
    next_grant: u32,
    xp: i64,
    achievements: BTreeSet<&'static str>,
    /// XP de la v2 menos XP de la v1, tras una devolución de más de la v1 (fila 11).
    gap: i64,
    overrefunds: u32,
    /// `PATCH status: done` que la v2 rechaza (fila 12).
    rejected_patches: u32,
}

fn int(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("no es entero: {v}"))
}

fn alias_of(path: &str) -> Option<&str> {
    let start = path.find('{')? + 1;
    Some(&path[start..path.find('}')?])
}

impl Sim {
    fn project_finished(&self) -> bool {
        self.projects.iter().any(|p| {
            let mine: Vec<&Task> = self
                .tasks
                .values()
                .filter(|t| t.project.as_deref() == Some(p))
                .collect();
            !mine.is_empty() && mine.iter().all(|t| t.status == TaskStatus::Done)
        })
    }

    fn completed(&self) -> u32 {
        self.tasks
            .values()
            .filter(|t| t.status == TaskStatus::Done)
            .count() as u32
    }

    fn complete(&mut self, name: &str, alias: &str, on: NaiveDate, status: i64, want: &Value) {
        let reward = self.tasks[alias].xp_reward;
        let state = self.tasks[alias].status;
        self.next_grant += 1;
        let grant = format!("g{}", self.next_grant);
        let decision = complete(state, false, reward, on, on);
        if status == 400 {
            assert_eq!(decision, Err(CompleteRejected::AlreadyCompleted));
            return;
        }
        let Ok(CompleteDecision::Grant { xp }) = decision else {
            panic!("{name}: se esperaba conceder: {decision:?}");
        };
        let change = award_xp(self.xp, xp);
        self.xp = change.new_xp;
        self.balances.insert(grant.clone(), change.applied);
        let task = self.tasks.get_mut(alias).unwrap();
        task.status = TaskStatus::Done;
        task.grant = Some(grant);
        // un reintento con el mismo id no vuelve a pagar
        assert_eq!(
            complete(TaskStatus::Done, true, reward, on, on),
            Ok(CompleteDecision::Replay)
        );

        let earned = earned_on_task_complete(TaskFacts {
            level: change.new_level,
            project_finished: self.project_finished(),
            completed_tasks: self.completed(),
        });
        let new: Vec<&'static str> = earned
            .into_iter()
            .filter(|k| !self.achievements.contains(k))
            .collect();
        self.achievements.extend(&new);

        let unlocked = want["achievement_unlocked"].as_str();
        if name == "logro_por_patch" {
            // fila 12: `dentro` sigue abierta, así que el proyecto no está terminado
            assert_eq!(unlocked, Some("project_master"));
            assert!(new.is_empty(), "{new:?}");
        } else {
            // fila 4: la v1 solo informa el primero
            assert_eq!(new.first().copied(), unlocked, "{name}: logros {new:?}");
        }
        self.check_xp(change.applied, want);
    }

    fn uncomplete(&mut self, alias: &str, status: i64, want: &Value) {
        let task = &self.tasks[alias];
        let grant = task.grant.clone();
        let decision = uncomplete(UncompleteInput {
            status: task.status,
            current_grant: grant.as_deref(),
            requested_grant: grant.as_deref(),
            grant_known: grant
                .as_ref()
                .is_some_and(|g| self.balances.contains_key(g)),
            balance: grant.as_ref().map_or(0, |g| self.balances[g]),
        });
        if status == 400 {
            assert_eq!(decision, Err(UncompleteRejected::NotCompleted));
            return;
        }
        let Ok(UncompleteDecision::Reopen { refund }) = decision else {
            panic!("se esperaba reabrir: {decision:?}");
        };
        let g = grant.unwrap();
        let change = award_xp(self.xp, -refund);
        self.xp = change.new_xp;
        self.balances.insert(g.clone(), 0);
        let task = self.tasks.get_mut(alias).unwrap();
        task.status = TaskStatus::Todo;
        task.grant = None;
        // reintento: sin efecto
        assert_eq!(
            uncomplete(UncompleteInput {
                status: TaskStatus::Todo,
                current_grant: None,
                requested_grant: Some(&g),
                grant_known: true,
                balance: 0,
            }),
            Ok(UncompleteDecision::Replay)
        );

        let v1 = int(&want["xp_earned"]);
        if v1 != change.applied {
            // fila 11: la v1 devuelve todas las concesiones históricas
            assert!(v1 < change.applied, "{v1} frente a {}", change.applied);
            self.gap += change.applied - v1;
            self.overrefunds += 1;
        }
        assert_eq!(self.xp - self.gap, int(&want["new_xp"]), "new_xp");
    }

    fn check_xp(&self, applied: i64, want: &Value) {
        assert_eq!(applied, int(&want["xp_earned"]), "xp_earned");
        assert_eq!(self.xp - self.gap, int(&want["new_xp"]), "new_xp");
        let level = xp_to_level(self.xp);
        assert_eq!(i64::from(level), int(&want["new_level"]), "new_level");
        assert_eq!(title_for_level(level), want["title"], "title");
    }

    fn step(&mut self, name: &str, step: &Value) {
        let (method, path) = step["llamada"].as_str().unwrap().split_once(' ').unwrap();
        let on: NaiveDate = step["hoy"].as_str().unwrap().parse().unwrap();
        let status = int(&step["esperado"]["status"]);
        let want = &step["esperado"]["cuerpo"];
        let body = &step["cuerpo"];
        let alias = alias_of(path);
        match (method, path) {
            // El id no existe: el 404 es del worker.
            (_, p) if p.contains("/999") => assert_eq!(status, 404),
            ("POST", "/projects") => {
                self.projects.insert(step["alias"].as_str().unwrap().into());
            }
            ("POST", "/tasks") => {
                assert_eq!(status, 201, "los escenarios de regla no rechazan al crear");
                self.tasks.insert(
                    step["alias"].as_str().unwrap().into(),
                    Task {
                        status: TaskStatus::parse(want["status"].as_str().unwrap()).unwrap(),
                        xp_reward: int(&want["xp_reward"]),
                        project: body["project_id"]
                            .as_str()
                            .and_then(alias_of)
                            .map(Into::into),
                        grant: None,
                        id_v1: int(&want["id"]),
                    },
                );
            }
            ("POST", p) if p.ends_with("/complete") => {
                self.complete(name, alias.unwrap(), on, status, want);
            }
            ("POST", p) if p.ends_with("/uncomplete") => {
                self.uncomplete(alias.unwrap(), status, want);
            }
            ("PATCH", _) => {
                if let Some(s) = body["status"].as_str() {
                    // fila 12: se rechaza, y la tarea queda como estaba
                    assert_eq!(TaskStatus::parse_writable(s), None, "{name}: {s}");
                    self.rejected_patches += 1;
                }
                if let Some(reward) = body["xp_reward"].as_i64() {
                    self.tasks.get_mut(alias.unwrap()).unwrap().xp_reward = reward;
                }
            }
            ("DELETE", _) => {
                // borrar no devuelve XP (v1)
                self.tasks.remove(alias.unwrap());
            }
            ("GET", "/user") => {
                assert_eq!(self.xp - self.gap, int(&want["xp"]), "xp");
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
                if name == "logro_por_patch" && !v1.is_empty() {
                    // fila 12: la tarea no se terminó por PATCH
                    assert!(got.is_empty(), "{got:?}");
                } else {
                    assert_eq!(got, v1, "{name}: logros");
                }
            }
            ("GET", p) if p.starts_with("/tasks") => {
                for got in want.as_array().unwrap() {
                    let task = self
                        .tasks
                        .values()
                        .find(|t| t.id_v1 == int(&got["id"]))
                        .expect("tarea de la lista");
                    assert_eq!(
                        TaskStatus::parse(got["status"].as_str().unwrap()),
                        Some(task.status)
                    );
                    assert_eq!(got["completed"], task.status == TaskStatus::Done);
                }
            }
            _ => panic!("{name}: llamada sin simular: {method} {path}"),
        }
    }
}

fn run(name: &str) -> Sim {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden/tasks")
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
fn completar_xp() {
    let sim = run("completar_xp");
    assert_eq!(sim.xp, 415);
}

#[test]
fn descompletar_piso() {
    let sim = run("descompletar_piso");
    // fila 11: solo el segundo ciclo de `ciclo` difiere, y la v2 conserva esos 15 XP
    assert_eq!((sim.overrefunds, sim.gap), (1, 15));
    assert_eq!(sim.xp, 50);
}

#[test]
fn logros_tareas() {
    let sim = run("logros_tareas");
    assert_eq!(
        sim.achievements,
        BTreeSet::from(["ascension", "project_master", "task_centurion"])
    );
    assert_eq!(sim.xp, 2750);
}

#[test]
fn logro_por_patch() {
    let sim = run("logro_por_patch");
    assert_eq!(sim.rejected_patches, 1);
    assert!(sim.achievements.is_empty());
}
