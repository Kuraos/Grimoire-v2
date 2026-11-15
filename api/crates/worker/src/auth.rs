//! Un token por dispositivo (`docs/tasks/fase-2-transversal.md`, decisión C). Cada uno es un
//! secreto de wrangler con nombre fijo; rotar o borrar uno no toca los otros. `GRIMOIRE_TOKEN`, el
//! token único de antes, se sigue aceptando mientras exista, para que el deploy no deje fuera al
//! teléfono ni a la tablet antes de tener los secretos nuevos; se borra al rotar (ROADMAP, fase 4).

use sha2::{Digest, Sha256};
use subtle::{ConditionallySelectable, ConstantTimeEq};

/// (dispositivo, secreto). El nombre del dispositivo es lo único que va al log.
pub(crate) const DEVICES: [(&str, &str); 4] = [
    ("phone", "GRIMOIRE_TOKEN_PHONE"),
    ("tablet", "GRIMOIRE_TOKEN_TABLET"),
    ("pc", "GRIMOIRE_TOKEN_PC"),
    ("legacy", "GRIMOIRE_TOKEN"),
];

/// El dispositivo cuyo secreto coincide con el bearer, o `None`.
///
/// `secrets[i]` es el valor de `DEVICES[i]`; `None` o vacío = no existe y no autoriza nada. Se
/// compara contra todos, sin salir en el primero que coincide, y sobre el SHA-256 de cada lado,
/// para no filtrar cuál coincidió ni el largo del secreto.
pub(crate) fn device_for(
    bearer: Option<&str>,
    secrets: &[Option<&str>; 4],
) -> Option<&'static str> {
    compare_all(bearer, secrets).0
}

/// `device_for` y cuántos secretos comparó: siempre todos los que existen, coincida el que
/// coincida. El conteo solo sirve para que un test vea que no hay salida temprana.
fn compare_all(bearer: Option<&str>, secrets: &[Option<&str>; 4]) -> (Option<&'static str>, usize) {
    // sin bearer se compara igual, contra el hash de "": ningún secreto vacío participa
    let sent = Sha256::digest(bearer.unwrap_or_default().as_bytes());
    // 0 = ninguno; i + 1 = DEVICES[i]
    let mut hit = 0u8;
    let mut compared = 0;
    for (i, secret) in secrets.iter().enumerate() {
        let Some(secret) = secret.filter(|s| !s.is_empty()) else {
            continue;
        };
        compared += 1;
        let eq = sent
            .as_slice()
            .ct_eq(Sha256::digest(secret.as_bytes()).as_slice());
        // el primero que coincide gana: si dos secretos son iguales, el orden de DEVICES decide
        let first = eq & hit.ct_eq(&0);
        hit = u8::conditional_select(&hit, &(i as u8 + 1), first);
    }
    let device = (hit > 0).then(|| DEVICES[usize::from(hit) - 1].0);
    (device, compared)
}

#[cfg(test)]
mod tests {
    use super::{compare_all, device_for};

    const PHONE: &str = "token-telefono-de-prueba";
    const TABLET: &str = "token-tableta-de-prueba";
    const PC: &str = "token-pc-de-prueba";
    const OLD: &str = "token-viejo-de-prueba";

    fn all() -> [Option<&'static str>; 4] {
        [Some(PHONE), Some(TABLET), Some(PC), Some(OLD)]
    }

    #[test]
    fn the_secret_names_are_the_documented_ones() {
        // los que dicen AGENTS.md (invariante 6) y el ROADMAP; GRIMOIRE_TOKEN sigue mientras exista
        assert_eq!(
            super::DEVICES,
            [
                ("phone", "GRIMOIRE_TOKEN_PHONE"),
                ("tablet", "GRIMOIRE_TOKEN_TABLET"),
                ("pc", "GRIMOIRE_TOKEN_PC"),
                ("legacy", "GRIMOIRE_TOKEN"),
            ]
        );
    }

    #[test]
    fn each_token_enters_as_its_device() {
        assert_eq!(device_for(Some(PHONE), &all()), Some("phone"));
        assert_eq!(device_for(Some(TABLET), &all()), Some("tablet"));
        assert_eq!(device_for(Some(PC), &all()), Some("pc"));
    }

    #[test]
    fn the_old_token_enters_while_it_exists() {
        assert_eq!(device_for(Some(OLD), &all()), Some("legacy"));
        let gone = [Some(PHONE), Some(TABLET), Some(PC), None];
        assert_eq!(device_for(Some(OLD), &gone), None);
        // el viejo y uno nuevo juntos: el nuevo sigue entrando
        let only_phone_and_old = [Some(PHONE), None, None, Some(OLD)];
        assert_eq!(device_for(Some(PHONE), &only_phone_and_old), Some("phone"));
        assert_eq!(device_for(Some(OLD), &only_phone_and_old), Some("legacy"));
    }

    #[test]
    fn a_removed_secret_no_longer_enters_and_the_others_still_do() {
        let tablet_revoked = [Some(PHONE), None, Some(PC), Some(OLD)];
        assert_eq!(device_for(Some(TABLET), &tablet_revoked), None);
        assert_eq!(device_for(Some(PHONE), &tablet_revoked), Some("phone"));
        assert_eq!(device_for(Some(PC), &tablet_revoked), Some("pc"));
    }

    #[test]
    fn unknown_or_missing_bearer_is_rejected() {
        assert_eq!(device_for(Some("otro"), &all()), None);
        assert_eq!(device_for(Some(&PHONE[..PHONE.len() - 1]), &all()), None);
        assert_eq!(device_for(None, &all()), None);
    }

    #[test]
    fn an_empty_secret_authorizes_nothing() {
        let empty = [Some(""), None, None, None];
        assert_eq!(device_for(Some(""), &empty), None);
        assert_eq!(device_for(None, &empty), None);
        assert_eq!(device_for(Some("x"), &empty), None);
        assert_eq!(device_for(Some(""), &[None; 4]), None);
        // un vacío no tapa a los demás
        let mixed = [Some(""), Some(TABLET), None, None];
        assert_eq!(device_for(Some(TABLET), &mixed), Some("tablet"));
    }

    #[test]
    fn every_present_secret_is_compared_whatever_matches() {
        // coincida el primero, el último o ninguno, se comparan los mismos: no hay salida temprana
        for bearer in [Some(PHONE), Some(OLD), Some("otro"), None] {
            assert_eq!(compare_all(bearer, &all()).1, 4, "{bearer:?}");
        }
        let two = [Some(PHONE), None, Some(""), Some(OLD)];
        assert_eq!(compare_all(Some(PHONE), &two).1, 2);
    }

    #[test]
    fn a_match_is_not_cut_short_by_order() {
        // el último de la lista también entra: no hay salida temprana que lo esconda
        let only_old = [None, None, None, Some(OLD)];
        assert_eq!(device_for(Some(OLD), &only_old), Some("legacy"));
        // dos secretos iguales: gana el primero de DEVICES, no el último
        let same = [Some(PHONE), Some(PHONE), None, None];
        assert_eq!(device_for(Some(PHONE), &same), Some("phone"));
    }
}
