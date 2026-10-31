-- Tareas, proyectos y checklist (docs/tasks/fase-2-tareas.md).

CREATE TABLE projects (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL CHECK (length(name) > 0),
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
    color           TEXT NOT NULL DEFAULT '#9b7fc4',
    category        TEXT,
    -- Solo la escribe la migración de datos: la API ni la recibe ni la devuelve.
    vault_note_path TEXT,
    created_at      TEXT NOT NULL
);

-- `status` es la única verdad: `completed` se deriva de `status = 'done'`.
CREATE TABLE tasks (
    id              TEXT PRIMARY KEY,
    title           TEXT    NOT NULL CHECK (length(title) > 0),
    description     TEXT,
    category        TEXT,
    priority        TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    project_id      TEXT REFERENCES projects (id) ON DELETE SET NULL,
    due_date        TEXT,
    xp_reward       INTEGER NOT NULL DEFAULT 15 CHECK (xp_reward BETWEEN 5 AND 50),
    status          TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    -- Clave fraccionaria del tablero. Orden: rank, id.
    rank            TEXT    NOT NULL CHECK (length(rank) > 0),
    -- Concesión vigente: `xp_log.mark_id` de lo que pagó completarla. NULL si está abierta.
    grant_id        TEXT,
    completed_at    TEXT,
    -- Día local de la acción, aunque se sincronice después.
    completed_on    TEXT,
    remind_at       TEXT,
    -- Separadas por comas, igual que la v1.
    tags            TEXT,
    vault_note_path TEXT,
    created_at      TEXT    NOT NULL
);
CREATE INDEX tasks_project ON tasks (project_id);

-- `text` sin CHECK: la API rechaza vacíos, pero la migración puede traerlos de la v1.
CREATE TABLE checklist_items (
    id       TEXT PRIMARY KEY,
    task_id  TEXT    NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    text     TEXT    NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    position INTEGER NOT NULL
);
CREATE INDEX checklist_items_task ON checklist_items (task_id, position);
