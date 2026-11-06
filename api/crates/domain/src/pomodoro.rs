//! Reglas de las sesiones de pomodoro (v1: `routers/pomodoro.py`; `docs/tasks/fase-2-pomodoro.md`).
//!
//! El temporizador vive en el cliente: aquí solo se valida la sesión que llega y se decide si paga.
//! «Ahora» entra como parámetro, como «hoy» en los demás módulos.

use std::ops::RangeInclusive;

use chrono::{DateTime, TimeDelta, Utc};

/// XP de una sesión completa, sin multiplicador y sin importar los minutos (v1: `BASE_XP`).
pub const SESSION_XP: i64 = 15;

/// El mismo límite del formulario de la v1 (decisión 8).
pub const WORK_MINUTES: RangeInclusive<i64> = 1..=90;

/// Cuánto puede adelantarse el reloj del dispositivo (decisión 2).
pub const MAX_CLOCK_SKEW: TimeDelta = TimeDelta::minutes(5);

/// La sesión que manda el cliente.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Session {
    pub work_minutes: i64,
    pub completed: bool,
    pub started_at: DateTime<Utc>,
    /// `ends_at` del bloque, no la hora de la request (fila 25).
    pub finished_at: DateTime<Utc>,
}

/// Por qué se rechaza con 422 (caracterizacion-v1.md, fila 28). La v1 lo aceptaba todo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionRejected {
    WorkMinutesOutOfRange,
    /// `started_at` ≥ `finished_at`.
    StartsAfterEnd,
    /// `finished_at` más de 5 minutos después de `now`. Hacia atrás no hay límite: las sesiones
    /// no tienen rachas.
    FinishedInFuture,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionDecision {
    /// Se guarda y concede `xp`. Solo con `completed: true` (decisión 7).
    Grant { xp: i64 },
    /// Se guarda sin XP, sin logros y fuera de horas y totales (v1).
    RecordOnly,
    /// El id ya existe: es un reintento de la cola y no cambia nada (fila 27).
    Replay,
}

/// ¿Qué hace `POST /pomodoro/sessions`? `known`: el id ya está en `pomodoro_sessions`. Va primero:
/// un reintento responde igual aunque el reloj haya avanzado desde el primer intento.
pub fn register(
    s: Session,
    known: bool,
    now: DateTime<Utc>,
) -> Result<SessionDecision, SessionRejected> {
    if known {
        return Ok(SessionDecision::Replay);
    }
    if !WORK_MINUTES.contains(&s.work_minutes) {
        return Err(SessionRejected::WorkMinutesOutOfRange);
    }
    if s.started_at >= s.finished_at {
        return Err(SessionRejected::StartsAfterEnd);
    }
    if s.finished_at > now + MAX_CLOCK_SKEW {
        return Err(SessionRejected::FinishedInFuture);
    }
    Ok(if s.completed {
        SessionDecision::Grant { xp: SESSION_XP }
    } else {
        SessionDecision::RecordOnly
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }

    fn session(minutes: i64, completed: bool, start: &str, end: &str) -> Session {
        Session {
            work_minutes: minutes,
            completed,
            started_at: t(start),
            finished_at: t(end),
        }
    }

    const NOW: &str = "2026-03-02T17:00:00Z";

    #[test]
    fn minutes_are_bounded_inclusive() {
        let end = "2026-03-02T17:00:00Z";
        let ok = |m| register(session(m, true, "2026-03-02T15:00:00Z", end), false, t(NOW));
        assert_eq!(ok(1), Ok(SessionDecision::Grant { xp: 15 }));
        assert_eq!(ok(90), Ok(SessionDecision::Grant { xp: 15 }));
        for m in [0, -5, 91, 100_000] {
            assert_eq!(ok(m), Err(SessionRejected::WorkMinutesOutOfRange), "{m}");
        }
    }

    #[test]
    fn start_must_precede_end() {
        let at = "2026-03-02T17:00:00Z";
        assert_eq!(
            register(session(25, true, at, at), false, t(NOW)),
            Err(SessionRejected::StartsAfterEnd)
        );
    }

    #[test]
    fn five_minutes_of_skew_are_allowed_and_no_more() {
        let s = |end| session(25, true, "2026-03-02T16:40:00Z", end);
        assert!(register(s("2026-03-02T17:05:00Z"), false, t(NOW)).is_ok());
        assert_eq!(
            register(s("2026-03-02T17:05:01Z"), false, t(NOW)),
            Err(SessionRejected::FinishedInFuture)
        );
        // una sesión de hace un año sigue valiendo
        assert!(
            register(
                session(25, true, "2025-03-02T16:35:00Z", "2025-03-02T17:00:00Z"),
                false,
                t(NOW)
            )
            .is_ok()
        );
    }

    #[test]
    fn incomplete_records_without_xp_and_replay_wins_over_everything() {
        let s = session(7, false, "2026-03-02T16:53:00Z", "2026-03-02T17:00:00Z");
        assert_eq!(register(s, false, t(NOW)), Ok(SessionDecision::RecordOnly));
        // un reintento no se revalida: el reloj pudo haber cambiado
        let bad = session(0, true, NOW, NOW);
        assert_eq!(register(bad, true, t(NOW)), Ok(SessionDecision::Replay));
    }
}
