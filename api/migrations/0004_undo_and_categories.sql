-- Deshacer por marca (caracterizacion-v1.md, fila 5) y catálogo de categorías de hábitos.

-- La marca que originó el movimiento. NULL en lo que no viene de una marca.
ALTER TABLE xp_log ADD COLUMN mark_id TEXT;
CREATE INDEX xp_log_mark ON xp_log (mark_id);

-- El nombre es la llave de negocio: habits.category lo guarda como texto, igual que la v1.
CREATE TABLE habit_categories (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
    color TEXT NOT NULL DEFAULT '#9b7fc4'
);

-- Las 6 por defecto de la v1 (`HABIT_CATEGORY_DEFAULTS`). Los ID no son secretos.
INSERT INTO habit_categories (id, name, color) VALUES
    ('00000000-0000-7000-8000-00000000c001', 'Físico', '#6a9b7f'),
    ('00000000-0000-7000-8000-00000000c002', 'Académico', '#9b7fc4'),
    ('00000000-0000-7000-8000-00000000c003', 'Idioma', '#7f8fc4'),
    ('00000000-0000-7000-8000-00000000c004', 'Proyecto', '#c47f9b'),
    ('00000000-0000-7000-8000-00000000c005', 'TCG', '#c4a87f'),
    ('00000000-0000-7000-8000-00000000c006', 'Otro', '#8a7a9c');
