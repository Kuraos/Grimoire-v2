//! Cadencia de un hábito (v1: `backend/services.py`).
//!
//! Un hábito diario puede tocar solo ciertos días: los que no toca son
//! transparentes, no suman racha ni la rompen. Un semanal pide `target` marcas
//! por semana ISO y la semana cuenta solo al alcanzarlas.

use std::fmt;

use chrono::{Datelike, Days, NaiveDate};

/// Días de la semana en que toca un hábito diario (bit 0 = lunes). Nunca vacío.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WeekdaySet(u8);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidDays(pub String);

impl WeekdaySet {
    /// `"3,0,0"` → `{0, 3}` (0 = lunes). Vacío → `None` = todos los días.
    pub fn parse(raw: &str) -> Result<Option<Self>, InvalidDays> {
        let mut bits = 0u8;
        for part in raw.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            match part.parse::<u8>() {
                Ok(d) if d < 7 => bits |= 1 << d,
                _ => return Err(InvalidDays(part.to_owned())),
            }
        }
        Ok((bits != 0).then_some(Self(bits)))
    }

    pub fn contains(self, d: NaiveDate) -> bool {
        self.0 & (1 << d.weekday().num_days_from_monday()) != 0
    }
}

/// Forma normalizada para guardar: `"0,3"`.
impl fmt::Display for WeekdaySet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let days: Vec<String> = (0..7)
            .filter(|d| self.0 & (1 << d) != 0)
            .map(|d| d.to_string())
            .collect();
        f.write_str(&days.join(","))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cadence {
    /// `None` = todos los días.
    Daily { days: Option<WeekdaySet> },
    /// Marcas por semana, 1..=7.
    Weekly { target: u8 },
}

pub fn week_monday(d: NaiveDate) -> NaiveDate {
    d - Days::new(d.weekday().num_days_from_monday().into())
}

pub fn scheduled_on(days: Option<WeekdaySet>, d: NaiveDate) -> bool {
    days.is_none_or(|s| s.contains(d))
}

/// El día programado más reciente dentro de `(d-7, d]`.
pub fn last_scheduled(days: Option<WeekdaySet>, d: NaiveDate) -> Option<NaiveDate> {
    (0..7)
        .map(|i| d - Days::new(i))
        .find(|&x| scheduled_on(days, x))
}

pub fn prev_scheduled(days: Option<WeekdaySet>, d: NaiveDate) -> Option<NaiveDate> {
    last_scheduled(days, d.pred_opt()?)
}

pub fn next_scheduled(days: Option<WeekdaySet>, d: NaiveDate) -> Option<NaiveDate> {
    (1..=7)
        .map(|i| d + Days::new(i))
        .find(|&x| scheduled_on(days, x))
}
