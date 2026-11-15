-- Las marcas de un día (fase-2-transversal.md, 2.5.4): `GET /diary/{date}` arma el resumen con
-- `HABITS_DONE`, que filtra `habit_logs` solo por `local_date`. `habit_logs_habit_day` empieza por
-- `habit_id` y no sirve para eso, así que cada apertura del Inicio recorría todas las marcas
-- (`SCAN`, 9 383 filas con el seed de bench).
CREATE INDEX habit_logs_local_date ON habit_logs (local_date);
