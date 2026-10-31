//! Reglas de tareas y proyectos (v1: `routers/tasks.py`, `routers/projects.py`).
//!
//! Completar y descompletar son idempotentes por id de concesión (`docs/tasks/fase-2-tareas.md`,
//! decisión 2): quien llama consulta en `xp_log` lo que esa concesión ya hizo y este módulo
//! decide. El XP se suma con `xp::award_xp`, con el piso en 0.

use std::ops::RangeInclusive;

use chrono::NaiveDate;

/// v1: `TaskBase.xp_reward`.
pub const XP_REWARD: RangeInclusive<i64> = 5..=50;
pub const DEFAULT_XP_REWARD: i64 = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    Todo,
    Doing,
    Done,
}

impl TaskStatus {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "todo" => Some(Self::Todo),
            "doing" => Some(Self::Doing),
            "done" => Some(Self::Done),
            _ => None,
        }
    }

    /// Lo que se puede escribir con crear o `PATCH`. `done` solo se alcanza completando, con su
    /// XP (caracterizacion-v1.md, filas 12 y 13).
    pub fn parse_writable(s: &str) -> Option<Self> {
        Self::parse(s).filter(|status| *status != Self::Done)
    }
}

pub fn valid_priority(s: &str) -> bool {
    matches!(s, "low" | "medium" | "high")
}

pub fn valid_project_status(s: &str) -> bool {
    matches!(s, "active" | "paused" | "closed")
}

/// Clave fraccionaria del tablero: la genera el cliente, y aquí solo se valida el formato. El
/// alfabeto es ASCII para que el orden de SQLite y el del cliente sean el mismo.
pub fn valid_rank(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Cada ítem tiene que decir algo (fila 18). Solo se valida en la API, por si la migración trae
/// ítems vacíos de la v1.
pub fn valid_checklist_text(s: &str) -> bool {
    !s.trim().is_empty()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompleteRejected {
    /// Ya está completada, con otra concesión (dos dispositivos sin conexión). v1: 400.
    AlreadyCompleted,
    /// `local_date` posterior a hoy. Sin ventana de gracia: las tareas no tienen rachas.
    FutureDay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompleteDecision {
    /// Concede `xp` y deja la tarea en `done`.
    Grant { xp: i64 },
    /// Esta concesión ya se aplicó: es un reintento y no cambia nada.
    Replay,
}

/// ¿Qué hace `POST /tasks/{id}/complete`? `grant_known`: el id ya aparece en `xp_log`. Va primero:
/// un reintento tiene que responder igual aunque la tarea se haya descompletado después.
pub fn complete(
    status: TaskStatus,
    grant_known: bool,
    xp_reward: i64,
    on: NaiveDate,
    today: NaiveDate,
) -> Result<CompleteDecision, CompleteRejected> {
    if grant_known {
        return Ok(CompleteDecision::Replay);
    }
    if status == TaskStatus::Done {
        return Err(CompleteRejected::AlreadyCompleted);
    }
    if on > today {
        return Err(CompleteRejected::FutureDay);
    }
    Ok(CompleteDecision::Grant { xp: xp_reward })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UncompleteRejected {
    /// v1: 400 «La tarea no está completada».
    NotCompleted,
    /// El id no corresponde a ninguna concesión de esta tarea.
    UnknownGrant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UncompleteDecision {
    /// Reabre la tarea y resta `refund`: solo el saldo de esta concesión (fila 11).
    Reopen { refund: i64 },
    /// Reintento, o concesión que ya no es la vigente: no cambia nada.
    Replay,
}

/// La concesión que manda el cliente frente al estado de la tarea.
#[derive(Debug, Clone, Copy)]
pub struct UncompleteInput<'a> {
    pub status: TaskStatus,
    /// `tasks.grant_id`. `None` en una tarea migrada que se completó sin XP.
    pub current_grant: Option<&'a str>,
    pub requested_grant: Option<&'a str>,
    /// El id pedido aparece en `xp_log`.
    pub grant_known: bool,
    /// Suma de `xp_log` para ese id: lo que queda por devolver.
    pub balance: i64,
}

/// ¿Qué hace `POST /tasks/{id}/uncomplete`?
pub fn uncomplete(i: UncompleteInput<'_>) -> Result<UncompleteDecision, UncompleteRejected> {
    if i.status == TaskStatus::Done && i.requested_grant == i.current_grant {
        return Ok(UncompleteDecision::Reopen {
            refund: i.balance.max(0),
        });
    }
    if i.grant_known {
        return Ok(UncompleteDecision::Replay);
    }
    Err(if i.status == TaskStatus::Done {
        UncompleteRejected::UnknownGrant
    } else {
        UncompleteRejected::NotCompleted
    })
}
