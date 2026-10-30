//! Usuario: XP, nivel, título y vidas. `GET /user` asienta perezosamente los días que
//! ya no pueden recibir marcas y calcula los provisionales (ADR 0005). No hay cron.

use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use chrono::{Days, NaiveDate};
use grimoire_domain::cadence::WeekdaySet;
use grimoire_domain::habits::Marks;
use grimoire_domain::lives::{
    DailyHabit, DayEvent, Outcome, SCAN_WINDOW_DAYS, evaluate_days, provisional_range,
    settle_range, settle_through,
};
use grimoire_domain::xp::{title_for_level, xp_for_level, xp_to_level};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use worker::query;

use crate::habits::{marks_by_habit, parse_date};
use crate::{AppError, AppState, local_date_of, log_d1, now_utc, today};

// Asentar es una escritura concurrente: teléfono y tablet pueden abrir a la vez. Las
// dos sentencias van en un `batch` (transacción) y llevan la MISMA guarda sobre el
// `settled_through` leído. La penalización va primero: el `batch` ejecuta todas sus
// sentencias aunque el UPDATE no afecte filas, y después del UPDATE la guarda ya no
// vería el valor leído. El monto aplicado (piso en 0) sale del XP de ese momento.
/// ?1 id del registro · ?2 penalización nominal · ?3 instante · ?4 usuario · ?5 `settled_through` leído
pub(crate) const SETTLE_PENALTY: &str = "INSERT INTO xp_log (id, source, source_id, amount, created_at) \
     SELECT ?1, 'streak_penalty', NULL, -MIN(?2, xp), ?3 FROM users \
     WHERE id = ?4 AND settled_through IS ?5 AND MIN(?2, xp) > 0";
/// ?1 vidas · ?2 penalización nominal · ?3 nuevo `settled_through` · ?4 usuario ·
/// ?5 `settled_through` leído. Sin fila devuelta: otro request asentó primero.
pub(crate) const SETTLE_USER: &str = "UPDATE users \
     SET lives = ?1, xp = MAX(0, xp - ?2), settled_through = ?3 \
     WHERE id = ?4 AND settled_through IS ?5 RETURNING xp";

#[derive(Deserialize)]
struct UserRow {
    id: String,
    name: String,
    xp: i64,
    lives: u8,
    settled_through: Option<String>,
}

#[derive(Deserialize)]
struct DailyRow {
    id: String,
    name: String,
    days: Option<String>,
    created_at: String,
}

#[derive(Deserialize)]
struct XpRow {
    xp: i64,
}

#[derive(Serialize)]
struct EventOut {
    day: String,
    /// `life_lost`, `life_regained` o `xp_penalty`.
    kind: &'static str,
    /// Nombres de los hábitos que rompieron su racha.
    habits: Vec<String>,
    xp_penalty: i64,
    /// Día aún no asentado: puede cambiar si llega una marca tardía (ADR 0005).
    provisional: bool,
}

#[derive(Serialize)]
pub struct UserOut {
    id: String,
    name: String,
    xp: i64,
    level: u32,
    title: &'static str,
    /// Provisionales: incluyen los días terminados que aún no se asientan.
    lives: u8,
    settled_through: Option<String>,
    xp_for_current_level: i64,
    xp_for_next_level: i64,
    xp_into_level: i64,
    xp_span: i64,
    /// Los días que asentó este request y los provisionales.
    events: Vec<EventOut>,
}

struct UserState {
    user: UserRow,
    settled_through: Option<NaiveDate>,
    habits: Vec<(DailyRow, Option<WeekdaySet>, NaiveDate)>,
    marks: HashMap<String, Marks>,
}

impl UserState {
    fn daily(&self) -> Vec<DailyHabit<'_>> {
        self.habits
            .iter()
            .map(|(h, days, created_on)| DailyHabit {
                id: &h.id,
                days: *days,
                created_on: *created_on,
                marks: &self.marks[&h.id],
            })
            .collect()
    }

    fn events_out(&self, events: &[DayEvent], provisional: bool) -> Vec<EventOut> {
        let name = |id: &str| {
            self.habits
                .iter()
                .find(|(h, ..)| h.id == id)
                .map(|(h, ..)| h.name.clone())
                .unwrap_or_default()
        };
        events
            .iter()
            .map(|e| {
                let (kind, xp_penalty) = match e.outcome {
                    Outcome::LifeLost => ("life_lost", 0),
                    Outcome::LifeRegained => ("life_regained", 0),
                    Outcome::XpPenalty(n) => ("xp_penalty", n),
                };
                EventOut {
                    day: e.day.to_string(),
                    kind,
                    habits: e.broken.iter().map(|id| name(id)).collect(),
                    xp_penalty,
                    provisional,
                }
            })
            .collect()
    }
}

async fn read_state(s: &AppState, today: NaiveDate) -> Result<UserState, AppError> {
    // un día se rompe contra la ocasión anterior del hábito: hasta 7 días antes
    let from = today - Days::new(SCAN_WINDOW_DAYS + 7);
    let res =
        s.db.batch(vec![
            s.db.prepare("SELECT id, name, xp, lives, settled_through FROM users LIMIT 1"),
            s.db.prepare(
                "SELECT id, name, days, created_at FROM habits \
                 WHERE active = 1 AND frequency = 'daily' ORDER BY created_at",
            ),
            query!(
                &s.db,
                "SELECT habit_id, group_concat(local_date) AS dates FROM habit_logs \
                 WHERE habit_id IN (SELECT id FROM habits WHERE active = 1 AND frequency = 'daily') \
                 AND local_date >= ?1 GROUP BY habit_id",
                from.to_string()
            )?,
        ])
        .await?;
    log_d1("user: lectura", &res);
    let user = res[0]
        .results::<UserRow>()?
        .pop()
        .ok_or_else(|| AppError::Internal("no hay usuario".into()))?;
    let habits: Vec<_> = res[1]
        .results::<DailyRow>()?
        .into_iter()
        .map(|h| {
            let days = WeekdaySet::parse(h.days.as_deref().unwrap_or(""))
                .map_err(|_| AppError::Internal("hábito con days inválido".into()))?;
            let created_on = local_date_of(&h.created_at, &s.tz)?;
            Ok((h, days, created_on))
        })
        .collect::<Result<_, AppError>>()?;
    let mut marks = marks_by_habit(&res[2])?;
    for (h, ..) in &habits {
        marks.entry(h.id.clone()).or_default();
    }
    Ok(UserState {
        settled_through: user
            .settled_through
            .as_deref()
            .map(parse_date)
            .transpose()?,
        user,
        habits,
        marks,
    })
}

fn respond(st: &UserState, today: NaiveDate, mut events: Vec<EventOut>) -> UserOut {
    let mut lives = st.user.lives;
    if let Some(range) = provisional_range(st.settled_through, today) {
        let (l, ev) = evaluate_days(lives, range, &st.daily());
        lives = l;
        events.extend(st.events_out(&ev, true));
    }
    // v1 `_enrich`: el nivel 1 empieza en 0 XP, los demás en nivel² · 100
    let level = xp_to_level(st.user.xp);
    let cur = if level <= 1 { 0 } else { xp_for_level(level) };
    let next = xp_for_level(level + 1);
    UserOut {
        id: st.user.id.clone(),
        name: st.user.name.clone(),
        xp: st.user.xp,
        level,
        title: title_for_level(level),
        lives,
        settled_through: st.user.settled_through.clone(),
        xp_for_current_level: cur,
        xp_for_next_level: next,
        xp_into_level: (st.user.xp - cur).max(0),
        xp_span: (next - cur).max(1),
        events,
    }
}

#[worker::send]
pub async fn read(State(s): State<AppState>) -> Result<Json<UserOut>, AppError> {
    let today = today(&s.tz)?;
    // ponytail: 3 intentos; solo se repite si otro request asentó entre la lectura y
    // la escritura, y entonces el siguiente ya no tiene nada que asentar
    for _ in 0..3 {
        let mut st = read_state(&s, today).await?;
        let Some(range) = settle_range(st.settled_through, today) else {
            return Ok(Json(respond(&st, today, Vec::new())));
        };
        let (lives, events) = evaluate_days(st.user.lives, range, &st.daily());
        let penalty: i64 = events
            .iter()
            .map(|e| match e.outcome {
                Outcome::XpPenalty(n) => n,
                _ => 0,
            })
            .sum();
        let settled = st.events_out(&events, false);
        let read_settled = st.user.settled_through.clone();
        let new_settled = settle_through(today).to_string();
        let mut writes = Vec::new();
        if penalty > 0 {
            writes.push(query!(
                &s.db,
                SETTLE_PENALTY,
                Uuid::now_v7().to_string(),
                penalty,
                now_utc(),
                st.user.id,
                read_settled
            )?);
        }
        writes.push(query!(
            &s.db,
            SETTLE_USER,
            lives,
            penalty,
            new_settled,
            st.user.id,
            read_settled
        )?);
        let res = s.db.batch(writes).await?;
        log_d1("user: asentar", &res);
        let Some(row) = res.last().unwrap().results::<XpRow>()?.pop() else {
            continue; // otro request asentó primero: releer sin cobrar
        };
        st.user.xp = row.xp;
        st.user.lives = lives;
        st.user.settled_through = Some(new_settled);
        st.settled_through = Some(settle_through(today));
        return Ok(Json(respond(&st, today, settled)));
    }
    Err(AppError::Internal(
        "no se pudo asentar: conflicto repetido".into(),
    ))
}

#[cfg(test)]
mod tests {
    //! Las sentencias reales de asentar, contra SQLite (D1 es SQLite). Simula dos
    //! requests que leyeron el mismo estado y escriben uno tras otro: la vida o la
    //! penalización se cobran una sola vez.
    use super::{SETTLE_PENALTY, SETTLE_USER};
    use rusqlite::{Connection, OptionalExtension, params};

    const USER: &str = "00000000-0000-7000-8000-000000000001";

    fn db(xp: i64, lives: i64, settled: Option<&str>) -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        c.execute_batch(include_str!("../../../migrations/0002_lives.sql"))
            .unwrap();
        // el XP de partida también está en xp_log: users.xp = suma de xp_log
        c.execute(
            "INSERT INTO xp_log VALUES ('seed', 'habit', NULL, ?1, '2026-03-01T00:00:00Z')",
            [xp],
        )
        .unwrap();
        c.execute(
            "UPDATE users SET xp = ?1, lives = ?2, settled_through = ?3",
            params![xp, lives, settled],
        )
        .unwrap();
        c
    }

    /// Un asentamiento, como el `batch` del worker. Devuelve si escribió.
    fn settle(
        c: &mut Connection,
        log_id: &str,
        read: Option<&str>,
        lives: i64,
        penalty: i64,
        new: &str,
    ) -> bool {
        let tx = c.transaction().unwrap();
        if penalty > 0 {
            tx.execute(
                SETTLE_PENALTY,
                params![log_id, penalty, "2026-03-05T12:00:00Z", USER, read],
            )
            .unwrap();
        }
        let wrote = tx
            .query_row(SETTLE_USER, params![lives, penalty, new, USER, read], |r| {
                r.get::<_, i64>(0)
            })
            .optional()
            .unwrap()
            .is_some();
        tx.commit().unwrap();
        wrote
    }

    fn state(c: &Connection) -> (i64, i64, String, i64, i64) {
        c.query_row(
            "SELECT xp, lives, settled_through, \
             (SELECT SUM(amount) FROM xp_log), \
             (SELECT COUNT(*) FROM xp_log WHERE source = 'streak_penalty') FROM users",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap()
    }

    #[test]
    fn life_is_charged_once() {
        let mut c = db(100, 3, Some("2026-03-01"));
        let read = Some("2026-03-01");
        assert!(settle(&mut c, "a", read, 2, 0, "2026-03-02"));
        assert!(!settle(&mut c, "b", read, 2, 0, "2026-03-02"));
        assert_eq!(state(&c), (100, 2, "2026-03-02".into(), 100, 0));
    }

    #[test]
    fn penalty_is_charged_once() {
        let mut c = db(100, 0, Some("2026-03-01"));
        let read = Some("2026-03-01");
        assert!(settle(&mut c, "a", read, 0, 15, "2026-03-02"));
        assert!(!settle(&mut c, "b", read, 0, 15, "2026-03-02"));
        let (xp, lives, settled, sum, penalties) = state(&c);
        assert_eq!(
            (xp, lives, settled.as_str(), penalties),
            (85, 0, "2026-03-02", 1)
        );
        assert_eq!(sum, xp, "users.xp = suma de xp_log");
    }

    /// Nunca asentado (`settled_through` NULL): la guarda `IS ?` también compara NULL.
    #[test]
    fn first_settlement_from_null_is_charged_once() {
        let mut c = db(100, 0, None);
        assert!(settle(&mut c, "a", None, 0, 30, "2026-03-02"));
        assert!(!settle(&mut c, "b", None, 0, 30, "2026-03-02"));
        assert_eq!(state(&c), (70, 0, "2026-03-02".into(), 70, 1));
    }

    /// Piso en 0: se registra lo aplicado, no lo nominal.
    #[test]
    fn penalty_respects_the_floor() {
        let mut c = db(10, 0, Some("2026-03-01"));
        assert!(settle(&mut c, "a", Some("2026-03-01"), 0, 15, "2026-03-02"));
        assert_eq!(state(&c), (0, 0, "2026-03-02".into(), 0, 1));
    }

    /// Con el XP ya en 0 no se escribe una penalización de 0.
    #[test]
    fn no_penalty_row_when_xp_is_zero() {
        let mut c = db(0, 0, Some("2026-03-01"));
        assert!(settle(&mut c, "a", Some("2026-03-01"), 0, 15, "2026-03-02"));
        assert_eq!(state(&c), (0, 0, "2026-03-02".into(), 0, 0));
    }
}
