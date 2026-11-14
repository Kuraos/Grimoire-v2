-- Diario (docs/tasks/fase-2-diario.md, 2.4.2; ADR 0006).

-- Una entrada por día. `written` lo calcula el dominio al guardar (`diary::is_written`, fila 35):
-- `trim()` de SQLite solo quita espacios, y los conteos (logros, marcas, volumen, búsqueda) tienen
-- que decir lo mismo que el XP.
CREATE TABLE diary_entries (
    id         TEXT PRIMARY KEY,
    local_date TEXT    NOT NULL UNIQUE,
    content    TEXT    NOT NULL,
    -- Texto libre separado por comas, sin normalizar, como en la v1.
    tags       TEXT,
    written    INTEGER NOT NULL CHECK (written IN (0, 1)),
    -- `save_id` del último guardado aplicado (decisión 1).
    save_id    TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);
-- Volumen (12 meses), marcas y conteo de escritas.
CREATE INDEX diary_entries_written ON diary_entries (written, local_date);

-- Lo que un guardado pisó sin haberlo visto (decisión 1). Sin referencia a `diary_entries`: es una
-- copia, y descartarla la borra.
CREATE TABLE diary_conflicts (
    -- `save_id` del guardado que la causó: cada guardado causa a lo sumo una, y repetirlo no duplica.
    id         TEXT PRIMARY KEY,
    local_date TEXT NOT NULL,
    content    TEXT NOT NULL,
    tags       TEXT,
    -- `save_id` de la versión pisada.
    save_id    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX diary_conflicts_day ON diary_conflicts (local_date);
