//! Reproduce con funciones puras la parte de regla de los goldens del diario
//! (`tests/golden/diary/`): XP, nivel, logros, qué cuenta como escrita, la búsqueda y la cadena de
//! guardados de un solo dispositivo. `resumen_dia` es del worker (lee hábitos, sesiones y `xp_log`) y
//! se reproduce en la 2.4.3.
//!
//! Donde la v2 hace algo distinto, el test afirma el valor nuevo y cita la fila de «Diferencias
//! permitidas» en `docs/tasks/caracterizacion-v1.md`.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use grimoire_domain::achievements::{DiaryFacts, earned_on_diary};
use grimoire_domain::diary::{
    Incoming, SaveDecision, Stored, decide_save, is_written, snippet, validate, xp_for_save,
};
use grimoire_domain::xp::{award_xp, title_for_level, xp_to_level};
use serde_json::Value;

struct Entry {
    content: String,
    tags: Option<String>,
    granted: bool,
    save_id: String,
}

#[derive(Default)]
struct Sim {
    xp: i64,
    achievements: BTreeSet<&'static str>,
    /// Por fecha `YYYY-MM-DD`; el orden de `BTreeMap` es el cronológico.
    entries: BTreeMap<String, Entry>,
    saves: u32,
}

fn int(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("no es entero: {v}"))
}

/// `%XX` de la query a texto (UTF-8).
fn decode(q: &str) -> String {
    let b = q.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            out.push(u8::from_str_radix(&q[i + 1..i + 3], 16).unwrap());
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap()
}

/// Lo que hace `LIKE '%q%'` de SQLite: mayúsculas ASCII da igual, la tilde no se pliega.
fn like(content: &str, q: &str) -> bool {
    content
        .to_ascii_lowercase()
        .contains(&q.to_ascii_lowercase())
}

impl Sim {
    fn written(&self) -> u32 {
        self.entries
            .values()
            .filter(|e| is_written(&e.content))
            .count() as u32
    }

    /// Fechas que la v1 trata como escritas (`content != ""`) y las que la v2 (`is_written`).
    fn dates(&self) -> (BTreeSet<&str>, BTreeSet<&str>) {
        let pick = |f: fn(&str) -> bool| {
            self.entries
                .iter()
                .filter(|(_, e)| f(&e.content))
                .map(|(d, _)| d.as_str())
                .collect()
        };
        (pick(|c| !c.is_empty()), pick(is_written))
    }

    fn put(&mut self, name: &str, date: &str, body: &Value, status: i64, want: &Value) {
        if status == 422 {
            // sin `content`, `content` que no es texto o fecha inválida: lo rechaza la
            // deserialización del worker antes de llegar aquí
            return;
        }
        assert_eq!(status, 200, "{name}");
        let content = body["content"].as_str().unwrap();
        assert_eq!(validate(content), Ok(()));

        // Un solo dispositivo: cada guardado se escribe sobre el anterior (decisión 1).
        self.saves += 1;
        let save_id = format!("s{}", self.saves);
        let prev = self.entries.get(date);
        let incoming = Incoming {
            save_id: &save_id,
            base_save_id: prev.map(|e| e.save_id.as_str()),
            content,
        };
        let stored = prev.map(|e| Stored {
            save_id: &e.save_id,
            content: &e.content,
        });
        assert_eq!(decide_save(stored, incoming), SaveDecision::Write, "{name}");

        let granted = prev.is_some_and(|e| e.granted);
        let xp = xp_for_save(content, granted);
        // tags ausente conserva; presente (también "") reemplaza (`etiquetas_y_validacion`)
        let tags = match body.get("tags") {
            Some(t) => t.as_str().map(Into::into),
            None => prev.and_then(|e| e.tags.clone()),
        };
        let entry = Entry {
            content: content.into(),
            tags,
            granted: granted || xp > 0,
            save_id: save_id.clone(),
        };
        // fila 40: repetir el mismo guardado no cambia nada
        let replay = Incoming {
            save_id: &save_id,
            base_save_id: Some("cualquiera"),
            content,
        };
        let now = Stored {
            save_id: &entry.save_id,
            content: &entry.content,
        };
        assert_eq!(decide_save(Some(now), replay), SaveDecision::Replay);
        self.entries.insert(date.into(), entry);

        if xp > 0 {
            let change = award_xp(self.xp, xp);
            self.xp = change.new_xp;
            let earned = earned_on_diary(DiaryFacts {
                level: change.new_level,
                written_entries: self.written(),
            });
            self.achievements.extend(earned);
        }
        self.check_entry(date, want);
    }

    fn check_entry(&self, date: &str, want: &Value) {
        assert_eq!(want["entry_date"], date);
        let e = self.entries.get(date);
        // ids UUID del cliente (invariante 2): aquí solo si existe
        assert_eq!(want["id"].is_null(), e.is_none(), "{date}: id");
        assert_eq!(want["content"], e.map_or("", |e| e.content.as_str()));
        assert_eq!(want["tags"].as_str(), e.and_then(|e| e.tags.as_deref()));
    }

    fn step(&mut self, name: &str, step: &Value) {
        let (method, path) = step["llamada"].as_str().unwrap().split_once(' ').unwrap();
        let status = int(&step["esperado"]["status"]);
        let want = &step["esperado"]["cuerpo"];
        match (method, path) {
            ("GET", "/diary/dates") => {
                // fila 37: la ruta no existe en la v2; las marcas salen del volumen (12 meses)
                let v1: BTreeSet<&str> = want
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect();
                let (nonempty, written) = self.dates();
                assert_eq!(v1, nonempty, "{name}: la simulación no es la v1");
                // fila 35: la v1 marca también las de solo espacios
                assert!(written.is_subset(&v1));
            }
            ("GET", "/diary/volume") => {
                let v1: Vec<(&str, i64)> = want
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| (p["entry_date"].as_str().unwrap(), int(&p["length"])))
                    .collect();
                let sim = |f: fn(&str) -> bool| -> Vec<(&str, i64)> {
                    self.entries
                        .iter()
                        .filter(|(_, e)| f(&e.content))
                        // `length()` de SQLite cuenta caracteres
                        .map(|(d, e)| (d.as_str(), e.content.chars().count() as i64))
                        .collect()
                };
                assert_eq!(v1, sim(|c| !c.is_empty()), "{name}: volumen de la v1");
                let v2 = sim(is_written);
                // fila 35: sin la de solo espacios
                assert!(v2.iter().all(|p| v1.contains(p)) && v2.len() <= v1.len());
            }
            ("GET", p) if p.starts_with("/diary/search") => {
                let q = p
                    .split_once("?q=")
                    .map_or(String::new(), |(_, q)| decode(q));
                let pick = |f: fn(&str) -> bool| -> Vec<(&str, &str)> {
                    self.entries
                        .iter()
                        .rev() // de la más reciente a la más antigua
                        .filter(|(_, e)| f(&e.content) && like(&e.content, &q))
                        .map(|(d, e)| (d.as_str(), e.content.as_str()))
                        .collect()
                };
                let v1: Vec<(&str, &str)> = want
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|r| {
                        (
                            r["entry_date"].as_str().unwrap(),
                            r["content"].as_str().unwrap(),
                        )
                    })
                    .collect();
                assert_eq!(
                    v1,
                    pick(|c| !c.is_empty()),
                    "{name}: búsqueda de la v1 con {q:?}"
                );
                // fila 38: la v2 manda un fragmento; estos textos caben enteros
                for (d, content) in pick(is_written) {
                    assert_eq!(snippet(content, &q), content.trim(), "{d}");
                }
            }
            ("GET", "/user") => {
                assert_eq!(self.xp, int(&want["xp"]), "{name}: xp");
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
                if name == "solo_espacios" {
                    // fila 35: la v1 contó la de solo espacios; la v2 aún no llega a 30
                    assert!(got.is_subset(&v1), "{got:?} ⊄ {v1:?}");
                    assert!(!got.contains("archivist"));
                } else {
                    assert_eq!(got, v1, "{name}: logros");
                }
            }
            ("GET", p) => {
                let date = p.strip_prefix("/diary/").unwrap();
                assert_eq!(status, 200);
                self.check_entry(date, want);
            }
            // fila 40: la v2 no tiene `PATCH`; el cliente manda `PUT`, con el mismo efecto
            ("PUT" | "PATCH", p) => {
                let date = p.strip_prefix("/diary/").unwrap();
                self.put(name, date, &step["cuerpo"], status, want);
            }
            _ => panic!("{name}: llamada sin simular: {method} {path}"),
        }
    }
}

fn run(name: &str) -> Sim {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden/diary")
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
fn xp_una_vez() {
    let sim = run("xp_una_vez");
    // tres entradas, cada una pagada una vez, aunque la primera se vació y se reescribió
    assert_eq!((sim.xp, sim.entries.len()), (15, 3));
}

#[test]
fn get_no_crea() {
    let sim = run("get_no_crea");
    assert_eq!(sim.entries.keys().collect::<Vec<_>>(), ["2026-03-03"]);
}

#[test]
fn solo_espacios() {
    let sim = run("solo_espacios");
    // fila 35: la de espacios existe, no paga y no cuenta: 29 escritas, sin `archivist`
    assert_eq!(sim.entries.len(), 30);
    assert_eq!((sim.written(), sim.xp), (29, 145));
    assert!(sim.achievements.is_empty());
}

#[test]
fn logros_diario() {
    let sim = run("logros_diario");
    assert_eq!(
        sim.achievements,
        BTreeSet::from(["archivist", "diary_century"])
    );
    assert_eq!((sim.written(), sim.xp), (100, 500));
}

#[test]
fn busqueda() {
    let sim = run("busqueda");
    // la vacía existe, pero no paga ni sale en la búsqueda
    assert_eq!((sim.entries.len(), sim.written(), sim.xp), (6, 5, 25));
}

#[test]
fn etiquetas_y_validacion() {
    let sim = run("etiquetas_y_validacion");
    let e = &sim.entries["2026-03-02"];
    assert_eq!(
        (e.content.as_str(), e.tags.as_deref()),
        ("Por PATCH.", Some(" a ,,b , "))
    );
    assert_eq!(sim.xp, 5);
}
