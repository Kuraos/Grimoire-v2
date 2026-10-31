//! Rutas de proyectos. `pomodoro_hours` llega con Pomodoro (caracterizacion-v1.md, fila 22) y
//! `vault_note_path` solo lo escribe la migración de datos.

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use grimoire_domain::tasks::valid_project_status;
use serde::{Deserialize, Serialize};
use worker::query;
use worker::wasm_bindgen::JsValue;

use crate::habits::{body, opt_text, parse_uuid, present};
use crate::{AppError, AppState, log_d1, now_utc};

const SELECT_PROJECT: &str = "SELECT p.id, p.name, p.description, p.status, p.color, p.category, \
     p.created_at, COUNT(t.id) AS tasks_total, COALESCE(SUM(t.status <> 'done'), 0) AS tasks_pending \
     FROM projects p LEFT JOIN tasks t ON t.project_id = p.id";

#[derive(Deserialize, Serialize)]
pub struct Project {
    id: String,
    name: String,
    description: Option<String>,
    status: String,
    color: String,
    category: Option<String>,
    created_at: String,
    tasks_total: i64,
    tasks_pending: i64,
}

fn check_name(n: &str) -> Result<(), AppError> {
    if n.is_empty() {
        return Err(AppError::Invalid("El nombre es obligatorio".into()));
    }
    Ok(())
}

fn check_status(s: &str) -> Result<(), AppError> {
    if valid_project_status(s) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Estado inválido: «{s}»")))
    }
}

#[worker::send]
pub async fn list(State(s): State<AppState>) -> Result<Json<Vec<Project>>, AppError> {
    let res =
        s.db.batch(vec![s.db.prepare(format!(
            "{SELECT_PROJECT} GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC"
        ))])
        .await?;
    log_d1("GET /projects", &res);
    Ok(Json(res[0].results()?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewProject {
    id: String,
    name: String,
    description: Option<String>,
    status: Option<String>,
    color: Option<String>,
    category: Option<String>,
}

/// Repetir el id devuelve el proyecto existente (200); crearlo, 201.
#[worker::send]
pub async fn create(
    State(s): State<AppState>,
    json: Result<Json<NewProject>, JsonRejection>,
) -> Result<(StatusCode, Json<Project>), AppError> {
    let p = body(json)?;
    let id = parse_uuid(&p.id)?;
    check_name(&p.name)?;
    let status = p.status.as_deref().unwrap_or("active");
    check_status(status)?;
    let res =
        s.db.batch(vec![
            query!(
                &s.db,
                "INSERT INTO projects (id, name, description, status, color, category, created_at) \
                 VALUES (?1, ?2, ?3, ?4, COALESCE(?5, '#9b7fc4'), ?6, ?7) \
                 ON CONFLICT (id) DO NOTHING",
                id,
                p.name,
                p.description,
                status,
                p.color,
                p.category,
                now_utc()
            )?,
            query!(
                &s.db,
                &format!("{SELECT_PROJECT} WHERE p.id = ?1 GROUP BY p.id"),
                id
            )?,
        ])
        .await?;
    log_d1("POST /projects", &res);
    let created = res[0].meta()?.and_then(|m| m.changes).unwrap_or(0) > 0;
    let project = res[1]
        .results::<Project>()?
        .pop()
        .ok_or_else(|| AppError::Internal("proyecto recién creado no encontrado".into()))?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(project)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectPatch {
    name: Option<String>,
    #[serde(default, deserialize_with = "present")]
    description: Option<Option<String>>,
    status: Option<String>,
    color: Option<String>,
    #[serde(default, deserialize_with = "present")]
    category: Option<Option<String>>,
}

#[worker::send]
pub async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    json: Result<Json<ProjectPatch>, JsonRejection>,
) -> Result<Json<Project>, AppError> {
    let p = body(json)?;
    let id = parse_uuid(&id)?;
    let mut sets: Vec<(&str, JsValue)> = Vec::new();
    if let Some(v) = &p.name {
        check_name(v)?;
        sets.push(("name", v.as_str().into()));
    }
    if let Some(v) = &p.description {
        sets.push(("description", opt_text(v.as_deref())));
    }
    if let Some(v) = &p.status {
        check_status(v)?;
        sets.push(("status", v.as_str().into()));
    }
    if let Some(v) = &p.color {
        sets.push(("color", v.as_str().into()));
    }
    if let Some(v) = &p.category {
        sets.push(("category", opt_text(v.as_deref())));
    }
    let mut stmts = Vec::new();
    if !sets.is_empty() {
        let assigns: Vec<String> = sets
            .iter()
            .enumerate()
            .map(|(i, (col, _))| format!("{col} = ?{}", i + 1))
            .collect();
        let mut binds: Vec<JsValue> = sets.into_iter().map(|(_, v)| v).collect();
        binds.push(id.as_str().into());
        stmts.push(
            s.db.prepare(format!(
                "UPDATE projects SET {} WHERE id = ?{}",
                assigns.join(", "),
                binds.len()
            ))
            .bind(&binds)?,
        );
    }
    stmts.push(query!(
        &s.db,
        &format!("{SELECT_PROJECT} WHERE p.id = ?1 GROUP BY p.id"),
        id
    )?);
    let res = s.db.batch(stmts).await?;
    log_d1("PATCH /projects/{id}", &res);
    res.last()
        .unwrap()
        .results::<Project>()?
        .pop()
        .map(Json)
        .ok_or(AppError::NotFound("Proyecto no encontrado"))
}

/// Sus tareas quedan sin proyecto (`ON DELETE SET NULL`). Repetirlo da 204 (fila 15).
#[worker::send]
pub async fn remove(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let id = parse_uuid(&id)?;
    let res =
        s.db.batch(vec![query!(
            &s.db,
            "DELETE FROM projects WHERE id = ?1",
            id
        )?])
        .await?;
    log_d1("DELETE /projects/{id}", &res);
    Ok(StatusCode::NO_CONTENT)
}
