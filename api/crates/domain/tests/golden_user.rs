//! Nivel, título y avance dentro del nivel (`_enrich` de la v1) contra todos los pasos de los
//! goldens que los graban: `user/usuario_niveles` y los 19 de los demás módulos listados en
//! «Hallazgos» (Usuario) de `docs/tasks/caracterizacion-v1.md`. Del XP grabado sale todo lo demás.

use std::fs;
use std::path::Path;

use grimoire_domain::xp::level_progress;
use serde_json::Value;

fn int(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("no es entero: {v}"))
}

#[test]
fn level_progress_matches_every_recorded_user() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden");
    let mut files = Vec::new();
    for module in fs::read_dir(&root).unwrap() {
        for f in fs::read_dir(module.unwrap().path()).unwrap() {
            files.push(f.unwrap().path());
        }
    }
    files.sort();

    let (mut goldens, mut steps) = (0, 0);
    let mut titles = std::collections::BTreeSet::new();
    for path in &files {
        let golden: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        let mut found = false;
        for (i, step) in golden["pasos"].as_array().unwrap().iter().enumerate() {
            let body = &step["esperado"]["cuerpo"];
            if body.get("xp_span").is_none() {
                continue;
            }
            found = true;
            steps += 1;
            let at = format!("{} paso {i} ({})", path.display(), step["llamada"]);
            let p = level_progress(int(&body["xp"]));
            assert_eq!(i64::from(p.level), int(&body["level"]), "level, {at}");
            assert_eq!(p.title, body["title"], "title, {at}");
            assert_eq!(
                p.xp_for_current_level,
                int(&body["xp_for_current_level"]),
                "xp_for_current_level, {at}"
            );
            assert_eq!(
                p.xp_for_next_level,
                int(&body["xp_for_next_level"]),
                "xp_for_next_level, {at}"
            );
            assert_eq!(
                p.xp_into_level,
                int(&body["xp_into_level"]),
                "xp_into_level, {at}"
            );
            assert_eq!(p.xp_span, int(&body["xp_span"]), "xp_span, {at}");
            titles.insert(p.title);
        }
        goldens += usize::from(found);
    }
    // si un golden deja de grabar estos campos, que se note: 19 de la lista más usuario_niveles
    assert_eq!(
        (goldens, steps),
        (20, 35 + 21),
        "goldens y pasos comparados"
    );
    // los saltos de título del 12, el 15 y el 20 están grabados desde la v1
    for t in [
        "Oráculo Perpetuo",
        "Arconte de la Voluntad",
        "Ente del Éter Puro",
    ] {
        assert!(titles.contains(t), "falta el título {t}");
    }
}
