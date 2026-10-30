//! Adaptador delgado: rutas, D1, auth y zona horaria. Las reglas viven en `grimoire-domain`.

use std::sync::Arc;

use axum::Router;
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use chrono::NaiveDate;
use subtle::ConstantTimeEq;
use tower_service::Service;
use worker::js_sys::{self, Object, Reflect};
use worker::{D1Database, D1Result, Env, HttpRequest, console_error, console_log, event};

mod habits;

#[derive(Clone)]
pub(crate) struct AppState {
    pub db: Arc<D1Database>,
    pub tz: Arc<str>,
}

#[event(fetch)]
async fn fetch(req: HttpRequest, env: Env, _ctx: worker::Context) -> worker::Result<Response> {
    // CORS solo para el origen de la APK (CORS_ORIGIN); la web la sirve el propio
    // worker, así que es mismo origen y no lo necesita
    let allowed = env.var("CORS_ORIGIN")?.to_string();
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .filter(|o| o.as_bytes() == allowed.as_bytes())
        .cloned();

    // el preflight no lleva Authorization: se responde antes del chequeo de auth
    let mut res = if req.method() == Method::OPTIONS {
        let mut res = StatusCode::NO_CONTENT.into_response();
        if origin.is_some() {
            let h = res.headers_mut();
            h.insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static("GET, POST, OPTIONS"),
            );
            h.insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static("Authorization, Content-Type"),
            );
            h.insert(
                header::ACCESS_CONTROL_MAX_AGE,
                HeaderValue::from_static("86400"),
            );
        }
        res
    } else if req.uri().path() != "/health"
        && !authorized(&req, &env.secret("GRIMOIRE_TOKEN")?.to_string())
    {
        AppError::Unauthorized.into_response()
    } else {
        let state = AppState {
            db: Arc::new(env.d1("DB")?),
            tz: env.var("GRIMOIRE_TZ")?.to_string().into(),
        };
        let router = Router::new()
            .route("/health", get(|| async { "ok" }))
            .route("/habits", get(habits::list).post(habits::create))
            .route("/habits/{id}/complete", post(habits::complete))
            .with_state(state);
        router.into_service().call(req).await?
    };

    // también en 401 y errores: si no, la APK no puede leer el motivo
    let h = res.headers_mut();
    h.insert(header::VARY, HeaderValue::from_static("Origin"));
    if let Some(origin) = origin {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    Ok(res)
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

/// «Hoy» en la zona del usuario (ADR 0004).
pub(crate) fn today(tz: &str) -> Result<NaiveDate, AppError> {
    local_date(&js_sys::Date::new_0(), tz)
}

/// Día local de un instante RFC 3339 (p. ej. `habits.created_at`).
pub(crate) fn local_date_of(instant: &str, tz: &str) -> Result<NaiveDate, AppError> {
    local_date(&js_sys::Date::new(&instant.into()), tz)
}

/// Con `Intl` del runtime: no hace falta empaquetar la base de zonas en el wasm.
fn local_date(date: &js_sys::Date, tz: &str) -> Result<NaiveDate, AppError> {
    // con una fecha inválida toLocaleDateString lanza RangeError, que en wasm aborta
    if date.get_time().is_nan() {
        return Err(AppError::Internal("instante inválido".into()));
    }
    let opts = Object::new();
    Reflect::set(&opts, &"timeZone".into(), &tz.into())
        .map_err(|_| AppError::Internal("no se pudo armar Intl".into()))?;
    // en-CA formatea como YYYY-MM-DD
    let s: String = date.to_locale_date_string("en-CA", &opts).into();
    s.parse()
        .map_err(|_| AppError::Internal("fecha local inesperada de Intl".into()))
}

/// Filas que D1 escaneó y escribió en un `batch` (cuotas del plan gratis: 5 M
/// leídas y 100 000 escritas por día, ADR 0007). Sale en `wrangler tail`.
pub(crate) fn log_d1(what: &str, results: &[D1Result]) {
    let (mut read, mut written) = (0, 0);
    for meta in results.iter().filter_map(|r| r.meta().ok().flatten()) {
        read += meta.rows_read.unwrap_or(0);
        written += meta.rows_written.unwrap_or(0);
    }
    console_log!("{what} rows_read={read} rows_written={written}");
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
        // los errores de serde citan el valor que no encajó: no van al log
        match e {
            worker::Error::SerdeJsonError(_) | worker::Error::SerdeWasmBindgenError(_) => {
                AppError::Internal("fila de D1 con forma inesperada".into())
            }
            e => AppError::Internal(e.to_string()),
        }
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
