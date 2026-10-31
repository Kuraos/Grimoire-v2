//! Reglas de tareas, con casos de la v1 y de las diferencias de `caracterizacion-v1.md`.

use chrono::NaiveDate;
use grimoire_domain::achievements::{TaskFacts, earned_on_task_complete};
use grimoire_domain::tasks::{
    CompleteDecision, CompleteRejected, TaskStatus, UncompleteDecision, UncompleteInput,
    UncompleteRejected, complete, uncomplete, valid_checklist_text, valid_priority,
    valid_project_status, valid_rank,
};

fn d(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

fn input<'a>(
    status: TaskStatus,
    current: Option<&'a str>,
    requested: Option<&'a str>,
    known: bool,
    balance: i64,
) -> UncompleteInput<'a> {
    UncompleteInput {
        status,
        current_grant: current,
        requested_grant: requested,
        grant_known: known,
        balance,
    }
}

#[test]
fn complete_grants_once_and_retry_changes_nothing() {
    let today = d("2026-03-02");
    assert_eq!(
        complete(TaskStatus::Doing, false, 50, today, today),
        Ok(CompleteDecision::Grant { xp: 50 })
    );
    assert_eq!(
        complete(TaskStatus::Done, true, 50, today, today),
        Ok(CompleteDecision::Replay)
    );
    // la respuesta se perdió y la tarea ya se descompletó: tampoco paga de nuevo
    assert_eq!(
        complete(TaskStatus::Todo, true, 50, today, today),
        Ok(CompleteDecision::Replay)
    );
}

/// Dos dispositivos sin conexión completan la misma tarea: el segundo no paga (fila 16).
#[test]
fn complete_with_another_grant_is_rejected() {
    let today = d("2026-03-02");
    assert_eq!(
        complete(TaskStatus::Done, false, 50, today, today),
        Err(CompleteRejected::AlreadyCompleted)
    );
}

/// Sin ventana de gracia, pero el día no puede ser futuro.
#[test]
fn complete_accepts_any_past_day_but_not_the_future() {
    let today = d("2026-03-02");
    assert!(complete(TaskStatus::Todo, false, 15, d("2025-01-01"), today).is_ok());
    assert_eq!(
        complete(TaskStatus::Todo, false, 15, d("2026-03-03"), today),
        Err(CompleteRejected::FutureDay)
    );
}

/// `descompletar_piso`: solo el saldo de la concesión vigente, no todo el historial (fila 11).
#[test]
fn uncomplete_refunds_the_balance_of_the_current_grant() {
    assert_eq!(
        uncomplete(input(TaskStatus::Done, Some("g2"), Some("g2"), true, 15)),
        Ok(UncompleteDecision::Reopen { refund: 15 })
    );
}

/// Tarea migrada que se completó en la v1 sin XP: se reabre sin devolver nada.
#[test]
fn uncomplete_without_grant_reopens_for_free() {
    assert_eq!(
        uncomplete(input(TaskStatus::Done, None, None, false, 0)),
        Ok(UncompleteDecision::Reopen { refund: 0 })
    );
}

#[test]
fn uncomplete_retry_and_stale_grant_change_nothing() {
    // reintento: ya está abierta, con el saldo en 0
    assert_eq!(
        uncomplete(input(TaskStatus::Todo, None, Some("g1"), true, 0)),
        Ok(UncompleteDecision::Replay)
    );
    // otra concesión la completó después
    assert_eq!(
        uncomplete(input(TaskStatus::Done, Some("g2"), Some("g1"), true, 0)),
        Ok(UncompleteDecision::Replay)
    );
}

#[test]
fn uncomplete_rejects_what_was_never_granted() {
    assert_eq!(
        uncomplete(input(TaskStatus::Todo, None, None, false, 0)),
        Err(UncompleteRejected::NotCompleted)
    );
    assert_eq!(
        uncomplete(input(TaskStatus::Done, Some("g1"), Some("otra"), false, 0)),
        Err(UncompleteRejected::UnknownGrant)
    );
}

/// `kanban_estado` y `crear_y_validar`: `done` no se escribe directamente (filas 12 y 13).
#[test]
fn done_is_not_writable() {
    assert_eq!(TaskStatus::parse("done"), Some(TaskStatus::Done));
    assert_eq!(TaskStatus::parse_writable("done"), None);
    assert_eq!(TaskStatus::parse_writable("doing"), Some(TaskStatus::Doing));
    assert_eq!(TaskStatus::parse_writable("inventado"), None);
}

#[test]
fn v1_validations() {
    assert!(valid_priority("high") && !valid_priority("urgente"));
    assert!(valid_project_status("closed") && !valid_project_status("inventado"));
}

#[test]
fn rank_is_ascii_alphanumeric() {
    assert!(valid_rank("a0") && valid_rank("Zz9"));
    assert!(!valid_rank("") && !valid_rank("a-b") && !valid_rank("ñ"));
}

/// La v1 aceptaba texto vacío (fila 18).
#[test]
fn checklist_text_must_say_something() {
    assert!(valid_checklist_text("Uno"));
    assert!(!valid_checklist_text("") && !valid_checklist_text("   "));
}

#[test]
fn task_achievements_in_v1_order() {
    let facts = |level, project_finished, completed_tasks| TaskFacts {
        level,
        project_finished,
        completed_tasks,
    };
    assert!(earned_on_task_complete(facts(4, false, 99)).is_empty());
    assert_eq!(
        earned_on_task_complete(facts(5, true, 100)),
        ["ascension", "project_master", "task_centurion"]
    );
}
