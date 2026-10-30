-- Esquema inicial (fase 0): usuario, hábitos, marcas y bitácora de XP.
-- IDs: UUID en texto generados por el cliente (ADR 0004).
-- Instantes: RFC 3339 en UTC. Día de una marca: local_date explícito (America/Bogota).

-- Nivel y título no se guardan: se derivan del XP con grimoire-domain.
CREATE TABLE users (
    id         TEXT PRIMARY KEY,
    name       TEXT    NOT NULL DEFAULT 'Grimoirista',
    xp         INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
    created_at TEXT    NOT NULL
);

-- Un solo usuario (v1: get_user crea el primero). El ID no es secreto.
INSERT INTO users (id, created_at)
VALUES ('00000000-0000-7000-8000-000000000001', '2026-10-29T00:00:00Z');

-- Mismas columnas que la v1, para que la migración de datos sea directa (ADR 0006).
CREATE TABLE habits (
    id              TEXT PRIMARY KEY,
    name            TEXT    NOT NULL CHECK (length(name) > 0),
    category        TEXT    NOT NULL CHECK (length(category) > 0),
    frequency       TEXT    NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
    -- "0,1,5" (0 = lunes), normalizado; NULL = todos los días. Solo aplica a daily.
    days            TEXT,
    target_per_week INTEGER NOT NULL DEFAULT 1 CHECK (target_per_week BETWEEN 1 AND 7),
    xp_reward       INTEGER NOT NULL DEFAULT 20 CHECK (xp_reward BETWEEN 10 AND 100),
    color           TEXT    NOT NULL DEFAULT '#9b7fc4',
    active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    notes           TEXT,
    tags            TEXT,
    created_at      TEXT    NOT NULL
);

CREATE TABLE habit_logs (
    id           TEXT PRIMARY KEY,
    habit_id     TEXT NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
    local_date   TEXT NOT NULL,
    completed_at TEXT NOT NULL
);

-- En la v1 ningún hábito, diario o semanal, se marca dos veces el mismo día.
CREATE UNIQUE INDEX habit_logs_habit_day ON habit_logs (habit_id, local_date);

-- amount es lo aplicado (el XP total nunca baja de 0), no lo pedido.
CREATE TABLE xp_log (
    id         TEXT PRIMARY KEY,
    source     TEXT    NOT NULL,
    source_id  TEXT,
    amount     INTEGER NOT NULL,
    created_at TEXT    NOT NULL
);
CREATE INDEX xp_log_source ON xp_log (source, source_id);
