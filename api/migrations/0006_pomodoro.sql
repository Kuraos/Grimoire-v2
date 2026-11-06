-- Sesiones de pomodoro (docs/tasks/fase-2-pomodoro.md, 2.3.2; ADR 0006).

-- `work_minutes` y las horas sin CHECK: la API rechaza lo inválido (fila 28), pero la migración de
-- datos puede traerlo de la v1. Referencias con `SET NULL`: borrar la tarea o el proyecto deja una
-- «Sesión libre» (fila 30).
CREATE TABLE pomodoro_sessions (
    id           TEXT PRIMARY KEY,
    task_id      TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    project_id   TEXT REFERENCES projects (id) ON DELETE SET NULL,
    work_minutes INTEGER NOT NULL,
    completed    INTEGER NOT NULL CHECK (completed IN (0, 1)),
    started_at   TEXT    NOT NULL,
    -- `ends_at` del bloque en el cliente, no la hora de la request (fila 25).
    finished_at  TEXT    NOT NULL,
    -- Día de `finished_at` en America/Bogota, aunque se sincronice después.
    local_date   TEXT    NOT NULL
);
CREATE INDEX pomodoro_sessions_day ON pomodoro_sessions (local_date);
-- Para `pomodoro_minutes` de `GET /projects`.
CREATE INDEX pomodoro_sessions_project ON pomodoro_sessions (project_id, completed);
