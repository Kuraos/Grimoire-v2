//! Adaptador delgado: rutas, D1, auth y zona horaria. Las reglas viven en `grimoire-domain`.

use std::sync::Arc;

use axum::Router;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use chrono::NaiveDate;
use subtle::ConstantTimeEq;
use tower_service::Service;
use worker::js_sys::{self, Object, Reflect};
use worker::{D1Database, Env, HttpRequest, console_error, event};

mod habits;

#[derive(Clone)]
pub(crate) struct AppState {
    pub db: Arc<D1Database>,
    pub tz: Arc<str>,
}

#[event(fetch)]
async fn fetch(req: HttpRequest, env: Env, _ctx: worker::Context) -> worker::Result<Response> {
    if req.uri().path() != "/health"
        && !authorized(&req, &env.secret("GRIMOIRE_TOKEN")?.to_string())
    {
        return Ok(AppError::Unauthorized.into_response());
    }
    let state = AppState {
        db: Arc::new(env.d1("DB")?),
        tz: env.var("GRIMOIRE_TZ")?.to_string().into(),
    };
    let router = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/habits", get(habits::list).post(habits::create))
        .route("/habits/{id}/complete", post(habits::complete))
        .with_state(state);
    Ok(router.into_service().call(req).await?)
}

/// `Authorization: Bearer <token>` comparado en tiempo constante. Un secreto vacío
/// no autoriza nada.
fn authorized(req: &HttpRequest, secret: &str) -> bool {
    let sent = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match sent {
        Some(token) if !secret.is_empty() => token.as_bytes().ct_eq(secret.as_bytes()).into(),
        _ => false,
    }
}

/// «Hoy» en la zona del usuario (ADR 0004), con `Intl` del runtime: no hace falta
/// empaquetar la base de zonas horarias en el wasm.
pub(crate) fn today(tz: &str) -> Result<NaiveDate, AppError> {
    let opts = Object::new();
    Reflect::set(&opts, &"timeZone".into(), &tz.into())
        .map_err(|_| AppError::Internal("no se pudo armar Intl".into()))?;
    // en-CA formatea como YYYY-MM-DD
    let s: String = js_sys::Date::new_0()
        .to_locale_date_string("en-CA", &opts)
        .into();
    s.parse()
        .map_err(|_| AppError::Internal(format!("fecha local inesperada: {s}")))
}

/// Instante actual en UTC, RFC 3339.
pub(crate) fn now_utc() -> String {
    js_sys::Date::new_0().to_iso_string().into()
}

#[derive(Debug)]
pub(crate) enum AppError {
    Unauthorized,
    NotFound(&'static str),
    Invalid(String),
    Conflict(String),
    Internal(String),
}

impl From<worker::Error> for AppError {
    fn from(e: worker::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, detail) = match self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "No autorizado".to_owned()),
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m.to_owned()),
            AppError::Invalid(m) => (StatusCode::UNPROCESSABLE_ENTITY, m),
            AppError::Conflict(m) => (StatusCode::CONFLICT, m),
            AppError::Internal(m) => {
                console_error!("{m}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Error interno".to_owned(),
                )
            }
        };
        (status, axum::Json(serde_json::json!({ "detail": detail }))).into_response()
    }
}
