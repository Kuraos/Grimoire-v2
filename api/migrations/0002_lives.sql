-- Vidas y punto de control de la evaluación de rachas (ADR 0005).
-- settled_through: último día local (YYYY-MM-DD) ya asentado; NULL = nunca.
ALTER TABLE users ADD COLUMN lives INTEGER NOT NULL DEFAULT 3 CHECK (lives BETWEEN 0 AND 3);
ALTER TABLE users ADD COLUMN settled_through TEXT;
