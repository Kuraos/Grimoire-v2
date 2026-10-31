//! Catálogo de categorías de hábitos (v1: `routers/habit_categories.py`).

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use worker::query;

use crate::habits::{body, parse_uuid};
use crate::{AppError, AppState, log_d1};

const COLUMNS: &str = "id, name, color, \
     (SELECT COUNT(*) FROM habits WHERE category = habit_categories.name) AS habit_count";

/// ?1 id · ?2 nombre · ?3 color. La v1 no admite dos nombres que solo difieran en
/// mayúsculas; repetir el ID no hace nada.
pub(crate) const CREATE_CATEGORY: &str = "INSERT INTO habit_categories (id, name, color) \
     SELECT ?1, ?2, COALESCE(?3, '#9b7fc4') \
     WHERE NOT EXISTS (SELECT 1 FROM habit_categories WHERE lower(name) = lower(?2)) \
     ON CONFLICT (id) DO NOTHING";

#[derive(Deserialize, Serialize)]
pub struct Category {
    id: String,
    name: String,
    color: String,
    /// Hábitos activos y archivados que la usan.
    habit_count: u32,
}

#[worker::send]
pub async fn list(State(s): State<AppState>) -> Result<Json<Vec<Category>>, AppError> {
    let res =
        s.db.prepare(format!(
            "SELECT {COLUMNS} FROM habit_categories ORDER BY name"
        ))
        .all()
        .await?;
    log_d1("GET /habit-categories", std::slice::from_ref(&res));
    Ok(Json(res.results()?))
}

#[derive(Deserialize)]
pub struct NewCategory {
    id: String,
    name: String,
    color: Option<String>,
}

/// Crea una categoría con el ID del cliente. Repetir el ID devuelve la existente (200).
#[worker::send]
pub async fn create(
    State(s): State<AppState>,
    json: Result<Json<NewCategory>, JsonRejection>,
) -> Result<(StatusCode, Json<Category>), AppError> {
    let c = body(json)?;
    let id = parse_uuid(&c.id)?;
    let name = c.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid(
            "El nombre de la categoría no puede estar vacío.".into(),
        ));
    }
    let res =
        s.db.batch(vec![
            query!(&s.db, CREATE_CATEGORY, id, name, c.color)?,
            query!(
                &s.db,
                &format!("SELECT {COLUMNS} FROM habit_categories WHERE id = ?1"),
                id
            )?,
            query!(
                &s.db,
                "SELECT name FROM habit_categories WHERE lower(name) = lower(?1)",
                name
            )?,
        ])
        .await?;
    log_d1("POST /habit-categories", &res);
    if let Some(category) = res[1].results::<Category>()?.pop() {
        let created = res[0].meta()?.and_then(|m| m.changes).unwrap_or(0) > 0;
        let status = if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        };
        return Ok((status, Json(category)));
    }
    let existing = res[2]
        .results::<NameRow>()?
        .pop()
        .ok_or_else(|| AppError::Internal("categoría no creada ni encontrada".into()))?;
    Err(AppError::Conflict(format!(
        "Ya existe una categoría llamada «{}».",
        existing.name
    )))
}

#[derive(Deserialize)]
struct NameRow {
    name: String,
}

#[worker::send]
pub async fn delete(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let id = parse_uuid(&id)?;
    let res =
        s.db.batch(vec![query!(
            &s.db,
            &format!("SELECT {COLUMNS} FROM habit_categories WHERE id = ?1"),
            id
        )?])
        .await?;
    let cat = res[0]
        .results::<Category>()?
        .pop()
        .ok_or(AppError::NotFound("Categoría no encontrada"))?;
    if cat.habit_count > 0 {
        // nunca se reasignan hábitos en silencio: primero hay que moverlos (v1)
        return Err(AppError::Conflict(format!(
            "«{}» está en uso por {} hábito(s). Cambia su categoría antes de eliminarla.",
            cat.name, cat.habit_count
        )));
    }
    let res =
        s.db.batch(vec![query!(
            &s.db,
            "DELETE FROM habit_categories WHERE id = ?1",
            id
        )?])
        .await?;
    log_d1("DELETE /habit-categories", &res);
    Ok(StatusCode::NO_CONTENT)
}
