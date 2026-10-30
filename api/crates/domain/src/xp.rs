//! Curva de XP, títulos y multiplicador de racha (v1: `backend/constants.py`).

/// Nivel para un XP total. XP negativo (deshacer, penalizaciones) cuenta como 0.
///
/// `floor(sqrt(xp / 100))` en enteros: con `n = xp / 100` truncado, la parte
/// fraccionaria nunca cruza un cuadrado perfecto, así que el resultado es el mismo.
pub fn xp_to_level(xp: i64) -> u32 {
    (xp.max(0) / 100).isqrt().max(1) as u32
}

pub fn xp_for_level(level: u32) -> i64 {
    i64::from(level).pow(2) * 100
}

const LEVEL_TITLES: [(u32, &str); 14] = [
    (1, "Iniciado"),
    (2, "Aprendiz de las Sombras"),
    (3, "Escriba Errante"),
    (4, "Guardián del Umbral"),
    (5, "Astrónomo Nocturno"),
    (6, "Tejedor de Hábitos"),
    (7, "Cronista del Vacío"),
    (8, "Arquitecto de Ritos"),
    (9, "Custodio del Grimoire"),
    (10, "Contemplador del Abismo"),
    (11, "Señor del Tiempo"),
    (12, "Oráculo Perpetuo"),
    (15, "Arconte de la Voluntad"),
    (20, "Ente del Éter Puro"),
];

/// El título más alto cuyo umbral es <= `level`.
pub fn title_for_level(level: u32) -> &'static str {
    LEVEL_TITLES
        .iter()
        .rev()
        .find(|(min, _)| *min <= level)
        .map_or(LEVEL_TITLES[0].1, |(_, t)| t)
}

/// Multiplicadores en puntos básicos (1.10 → 11 000) para no arrastrar float.
const STREAK_BONUS_BP: [(u32, u32); 5] = [
    (7, 11_000),
    (14, 12_000),
    (30, 13_500),
    (60, 15_000),
    (100, 17_500),
];

const BP: u32 = 10_000;

/// Multiplicador de XP según racha, en puntos básicos.
pub fn streak_multiplier(streak: u32) -> u32 {
    STREAK_BONUS_BP
        .iter()
        .rev()
        .find(|(min, _)| *min <= streak)
        .map_or(BP, |(_, bp)| *bp)
}

/// `xp_reward × multiplicador`, mitades hacia arriba. Cambio deliberado frente a
/// la v1, que usaba `round` de Python en float (mitades al par + error binario):
/// ver fase-0.md, tarea 0.1.
pub fn apply_multiplier(xp_reward: u32, multiplier_bp: u32) -> i64 {
    (i64::from(xp_reward) * i64::from(multiplier_bp) + i64::from(BP / 2)) / i64::from(BP)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XpChange {
    /// Lo que de verdad se sumó (o restó): es lo que va a `xp_log`.
    pub applied: i64,
    pub new_xp: i64,
    pub new_level: u32,
    pub title: &'static str,
    pub leveled_up: bool,
}

/// Suma `amount` al XP. El total nunca baja de 0 (v1: `award_xp`).
pub fn award_xp(current_xp: i64, amount: i64) -> XpChange {
    let new_xp = (current_xp + amount).max(0);
    let new_level = xp_to_level(new_xp);
    XpChange {
        applied: new_xp - current_xp,
        new_xp,
        new_level,
        title: title_for_level(new_level),
        leveled_up: new_level > xp_to_level(current_xp),
    }
}
