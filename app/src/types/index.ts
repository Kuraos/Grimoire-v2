export interface UserEvent {
  day: string;
  kind: "life_lost" | "life_regained" | "xp_penalty";
  habits: string[];
  xp_penalty: number;
  /** Día aún sin asentar: puede cambiar si llega una marca tardía (ADR 0005). */
  provisional: boolean;
}

export interface User {
  id: string;
  name: string;
  xp: number;
  level: number;
  title: string;
  lives: number;
  settled_through: string | null;
  xp_for_current_level: number;
  xp_for_next_level: number;
  xp_into_level: number;
  xp_span: number;
  events: UserEvent[];
}

export interface Habit {
  id: string;
  name: string;
  category: string;
  frequency: string;
  /** días en que toca, "0,1,4" con 0 = lunes. null = todos (sólo aplica a "daily") */
  days: string | null;
  /** marcas necesarias para dar la semana por hecha (sólo aplica a "weekly") */
  target_per_week: number;
  xp_reward: number;
  color: string;
  active: boolean;
  notes: string | null;
  tags: string | null;
  created_at: string;
  streak: number;
  /** Constancia de los últimos 90 días, en porcentaje. */
  completion_rate: number;
  done_today: boolean;
  /** La última marca, para deshacerla. */
  last_mark: { id: string; local_date: string } | null;
}

/** Lo que se edita de un hábito. */
export type HabitInput = Pick<
  Habit,
  "name" | "category" | "frequency" | "days" | "target_per_week" | "xp_reward" | "color" | "notes" | "tags"
>;

export interface HabitMark {
  id: string;
  local_date: string;
  completed_at: string;
}

export interface HabitDetail extends Habit {
  best_streak: number;
  total_xp: number;
  last_completed: string | null;
  marks: HabitMark[];
  xp_series: { date: string; xp: number }[];
}

export interface HabitCategory {
  id: string;
  name: string;
  color: string;
  habit_count: number;
}

export interface UnlockedAchievement {
  key: string;
  name: string;
  icon: string;
}

/** Respuesta de marcar y de deshacer. */
export interface CompleteOut {
  xp_earned: number;
  new_xp: number;
  new_level: number;
  title: string;
  leveled_up: boolean;
  streak: number;
  achievements_unlocked: UnlockedAchievement[];
}

// Tareas y proyectos de la v2. `Task` y `Project`, más abajo, son los de la v1 que aún usan los
// componentes portados; se reemplazan cuando esos componentes pasen a ids de texto (2.2.5).

export interface ApiChecklistItem {
  id: string;
  task_id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface ApiTask {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: "high" | "medium" | "low";
  project_id: string | null;
  due_date: string | null;
  xp_reward: number;
  status: "todo" | "doing" | "done";
  /** Clave fraccionaria del tablero: `ORDER BY rank, id`. */
  rank: string;
  /** La concesión vigente, para descompletar. `null` en una tarea migrada sin XP. */
  grant_id: string | null;
  completed: boolean;
  completed_at: string | null;
  completed_on: string | null;
  remind_at: string | null;
  tags: string | null;
  created_at: string;
  checklist: ApiChecklistItem[];
  checklist_done: number;
  checklist_total: number;
}

/** Lo que se edita de una tarea. Entrar o salir de `done` solo es por completar y descompletar. */
export type TaskInput = Partial<
  Pick<ApiTask, "description" | "category" | "priority" | "project_id" | "due_date" | "xp_reward" | "remind_at" | "tags">
> & { title: string };

export interface TaskHistoryPage {
  tasks: ApiTask[];
  next_cursor: string | null;
}

export interface ApiProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  color: string;
  category: string | null;
  created_at: string;
  tasks_total: number;
  tasks_pending: number;
}

export type ProjectInput = Partial<Pick<ApiProject, "description" | "status" | "color" | "category">> & { name: string };

export interface Project {
  id: number;
  name: string;
  description: string | null;
  status: string;
  color: string;
  category: string | null;
  vault_note_path: string | null;
  created_at: string;
  tasks_total: number;
  tasks_pending: number;
  pomodoro_hours: number;
}

export interface ChecklistItem {
  id: number;
  task_id: number;
  text: string;
  done: boolean;
  position: number;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  priority: "high" | "medium" | "low";
  project_id: number | null;
  due_date: string | null;
  xp_reward: number;
  completed: boolean;
  completed_at: string | null;
  status: "todo" | "doing" | "done";
  position: number;
  remind_at: string | null;
  tags: string | null;
  vault_note_path: string | null;
  created_at: string;
  checklist: ChecklistItem[];
  checklist_done: number;
  checklist_total: number;
}

export interface PomodoroSession {
  id: number;
  task_id: number | null;
  project_id: number | null;
  work_minutes: number;
  completed: boolean;
  started_at: string;
  finished_at: string | null;
  task_title: string | null;
}

export interface CalendarEvent {
  id: number;
  title: string;
  category: string | null;
  color: string;
  start_dt: string;
  end_dt: string | null;
  notes: string | null;
  recurrence: "none" | "daily" | "weekly";
  recurrence_until: string | null;
  is_occurrence?: boolean;
}

export interface IcsImportResult {
  created: number;
  updated: number;
  events_in_file: number;
  titles: string[];
  warnings: string[];
}

export interface DiaryEntry {
  id: number;
  entry_date: string;
  content: string;
  tags: string | null;
  updated_at: string;
}

export interface Checkin {
  id: number;
  checkin_date: string;
  energy: number;
  mood: number;
  note: string | null;
}

export type Tier = "common" | "rare" | "epic" | "legendary";

export interface Achievement {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  tier: Tier;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number;
}

export interface Quest {
  id: number;
  scope: "daily" | "weekly";
  metric: string;
  target: number;
  title: string;
  icon: string;
  xp_reward: number;
  claimed: boolean;
  progress: number;
  completed: boolean;
}

export interface BackupEntry {
  filename: string;
  kind: "auto" | "manual";
  size_kb: number;
  created_at: string;
}

export interface StreakEval {
  lives: number;
  life_lost: boolean;
  lives_gained: number;
  broken_habits: string[];
  xp_penalty: number;
  new_xp: number;
}

export interface WeeklyReview {
  id: number;
  week_iso: string;
  what_worked: string | null;
  what_failed: string | null;
  next_change: string | null;
  rating: number | null;
  created_at: string;
}

export interface XPEventResponse {
  xp_earned: number;
  new_xp: number;
  new_level: number;
  title: string;
  leveled_up: boolean;
  streak: number | null;
  total_today_minutes: number | null;
  achievement_unlocked: Achievement | null;
}

export interface DaySummary {
  habits_done: { name: string; color: string; category: string }[];
  pomodoro_sessions: { work_minutes: number; task_title: string | null; finished_at: string | null }[];
  pomodoro_minutes: number;
  xp_earned: number;
  checkin: Checkin | null;
}

export interface Stats {
  period: string;
  xp_total: number;
  xp_by_day: { date: string; xp: number }[];
  habits_completed: number;
  habits_possible: number;
  habits_rate: number;
  pomodoro_sessions: number;
  pomodoro_minutes_total: number;
  tasks_closed: number;
  avg_energy: number | null;
  avg_mood: number | null;
  xp_by_category: { category: string; xp: number }[];
  mood_energy: { date: string; energy: number; mood: number; xp: number }[];
  top_streaks: { name: string; color: string; frequency: string; streak: number }[];
  hours_by_project: { project: string; color: string; hours: number }[];
  heatmap: { date: string; count: number }[];
}

/* ---- Erario. Todo importe es un entero en unidades menores; ver utils.ts. ---- */

export interface Account {
  id: number;
  name: string;
  kind: string; // cash|bank|savings|debt
  currency: string;
  opening_minor: number;
  color: string;
  archived: boolean;
  created_at: string;
  /** calculado en el backend a partir de los asientos; nunca persistido */
  balance_minor: number;
}

export interface LedgerCategory {
  id: number;
  name: string;
  kind: string; // expense|income
  color: string;
  icon: string;
  archived: boolean;
  entry_count: number;
  // El cerco NO vive aquí: es de un mes. Ver BudgetMonth.
}

export interface BudgetLine {
  category_id: number;
  name: string;
  color: string;
  amount_minor: number;
  /** mes de la fila que lo fija. Distinto del consultado = viene arrastrado. */
  source_month: string | null;
}

export interface BudgetMonth {
  month: string;
  currency: string;
  total_minor: number;
  lines: BudgetLine[];
}

export interface LedgerEntry {
  id: number;
  account_id: number;
  /** null = sin clasificar, que es un estado válido y visible */
  category_id: number | null;
  kind: string; // expense|income|transfer
  /** siempre positivo: el signo lo pone `kind` */
  amount_minor: number;
  occurred_on: string; // YYYY-MM-DD
  concept: string;
  note: string | null;
  tags: string | null;
  counter_account_id: number | null;
  /** aporte a una reliquia; sólo tiene sentido en un traspaso */
  goal_id: number | null;
  created_at: string;
}

export interface CategoryTotal {
  category_id: number | null;
  name: string;
  color: string;
  kind: string;
  total_minor: number;
  /** el cerco vigente del mes; null = partida sin asignación */
  budget_minor: number | null;
}

export interface LedgerSummary {
  month: string; // YYYY-MM
  currency: string;
  income_minor: number;
  expense_minor: number;
  /** ingresos − gastos; los traspasos no cuentan */
  net_minor: number;
  entry_count: number;
  unclassified_count: number;
  days_with_entries: number;
  /** suma de los cercos de las partidas activas; 0 = todavía no hay asignaciones */
  budget_total_minor: number;
  budgeted_spent_minor: number;
  /** gasto real que no cuenta contra ningún cerco: sin asignación o sin partida */
  unbudgeted_spent_minor: number;
  /** asignado − gastado con cerco; puede ser negativo */
  available_minor: number;
  /** días del mes que quedan, hoy incluido; 0 si el mes ya cerró */
  days_left: number;
  by_category: CategoryTotal[];
}

export interface SavingsGoal {
  id: number;
  name: string;
  target_minor: number;
  account_id: number;
  deadline: string | null;
  /** sellado al alcanzarla; nunca se reabre */
  achieved_at: string | null;
  color: string;
  icon: string;
  archived: boolean;
  created_at: string;
  /** deducido de los traspasos marcados; nunca persistido */
  saved_minor: number;
}

export interface LedgerStats {
  currency: string;
  daily: { date: string; expense_minor: number }[];
  monthly: { month: string; expense_minor: number; income_minor: number }[];
  series: { month: string; category_id: number; name: string; color: string; total_minor: number }[];
}

export interface LedgerMonthReview {
  id: number;
  month_key: string; // YYYY-MM
  what_worked: string | null;
  what_leaked: string | null;
  next_change: string | null;
  rating: number | null;
  /** cifras congeladas al cerrar: los cercos son globales y cambiarlos después
   *  reescribiría lo que decía esta revisión */
  budget_total_minor: number;
  spent_minor: number;
  unclassified_count: number;
  created_at: string;
}

/** El alta devuelve la fila y, si tocaba, el XP del día. */
export interface LedgerEntryCreated {
  entry: LedgerEntry;
  xp: XPEventResponse | null;
}

export interface WeekSummary {
  week_iso: string;
  xp_total: number;
  xp_prev: number;
  xp_delta_pct: number | null;
  habits_completed: number;
  habits_possible: number;
  pomodoro_sessions: number;
  pomodoro_minutes: number;
  tasks_closed: number;
  tasks_open: number;
  avg_energy: number | null;
  avg_mood: number | null;
}

/* ---------------------------------------------------------------------------
   LA PALESTRA
   ---------------------------------------------------------------------------
   El peso viaja SIEMPRE en gramos y las medidas del cuerpo en milésimas de su
   unidad. La conversión ocurre en los bordes —al pintar y al leer lo tecleado—
   con `formatWeight` y `parseWeight` de utils.ts, nunca en medio.

   Los campos marcados como derivados no existen en la base: salen de las series
   o de distancia y duración, igual que el saldo de un arca sale de sus asientos.
   --------------------------------------------------------------------------- */

export type TrainingKind = "strength" | "hema" | "cardio";
export type CardioKind = "run" | "bike" | "other";
export type BodyMetricKind = "weight" | "waist" | "chest" | "arm" | "thigh" | "hip";

export interface MuscleGroup {
  id: number;
  name: string;
  color: string;
  icon: string;
}

export interface Exercise {
  id: number;
  name: string;
  muscle_group_id: number | null;
  archived: boolean;
  created_at: string;
  /** el ejercicio más fácil del que éste viene en la cadena de progresión */
  progresses_from_id: number | null;
  notes: string | null;
  /** reps (o segundos, en los estáticos) a partir de las cuales se considera dominado */
  mastery_reps: number | null;
}

export interface RoutineTemplate {
  id: number;
  name: string;
  notes: string | null;
  items: { exercise_id: number; position: number; sets: number; reps: number }[];
}

export interface ProgressionHint {
  exercise_id: number;
  next_exercise_ids: number[];
  mastery_reps: number;
  sessions_ok: number;
}

export interface TrainingSet {
  id: number;
  exercise_id: number;
  position: number;
  reps: number;
  weight_g: number;
  rpe: number | null;
  /** derivado: Epley, con el peso tal cual a una repetición */
  est_1rm_g: number;
  /** por encima de 10 reps la estimación se marca, no se oculta */
  low_confidence: boolean;
}

export interface TrainingSession {
  id: number;
  kind: TrainingKind;
  occurred_on: string;
  name: string | null;
  duration_s: number | null;
  notes: string | null;
  intensity: number | null;
  techniques: string | null;
  cardio_kind: CardioKind | null;
  distance_m: number | null;
  habit_id: number | null;
  /** la marca de rito que nació de esta sesión; null si no marcó ninguna */
  habit_log_id: number | null;
  created_at: string;
  sets: TrainingSet[];
  /** derivados */
  volume_g: number;
  set_count: number;
  /** segundos por kilómetro; null sin distancia — no se divide entre cero */
  pace_s_per_km: number | null;
}

export interface TrainingSessionCreated {
  session: TrainingSession;
  xp: XPEventResponse | null;
  habit_marked: boolean;
  /** por qué se marcó el rito o por qué no. La razón la sabe el backend. */
  habit_note: string | null;
}

export interface StrengthGoal {
  id: number;
  exercise_id: number;
  target_weight_g: number;
  target_reps: number;
  deadline: string | null;
  /** sellado al alcanzarla; nunca se reabre */
  achieved_at: string | null;
  color: string;
  icon: string;
  archived: boolean;
  created_at: string;
  /** deducidos de las series; nunca persistidos */
  best_weight_g: number;
  qualifying_sets: number;
}

export interface BodyMetric {
  id: number;
  kind: BodyMetricKind;
  measured_on: string;
  value_milli: number;
  note: string | null;
  created_at: string;
  unit: string;
}

export interface BodyMetricPoint {
  measured_on: string;
  value_milli: number;
  /** media móvil de cuatro medidas: la respuesta a «¿baja o es ruido?» */
  trend_milli: number;
}

export interface BodyMetricSeries {
  kind: BodyMetricKind;
  unit: string;
  points: BodyMetricPoint[];
}

export interface TrainingSummary {
  today: TrainingSession | null;
  sessions_this_week: number;
  volume_this_week_g: number;
  days_this_week: number;
  /** rito sugerido por modalidad, deducido de la última sesión que eligió uno */
  suggested_habit: Record<string, number>;
  weight_unit: "kg" | "lb";
}

export interface ExercisePoint {
  occurred_on: string;
  top_weight_g: number;
  est_1rm_g: number;
  reps_at_top: number;
  low_confidence: boolean;
  /** se dibuja en tinta, no se premia: un récord sin meta declarada es dato */
  is_record: boolean;
}

export interface ExerciseProgress {
  exercise_id: number;
  points: ExercisePoint[];
}

export interface VolumeWeek {
  week_start: string;
  groups: { muscle_group_id: number | null; volume_g: number }[];
}

export interface TrainingStats {
  volume_weeks: VolumeWeek[];
  sessions_by_kind: Record<string, number>;
  total_sessions: number;
  total_volume_g: number;
}

// Antes en context.tsx (v1), que no se porta porque llama a la API.
export interface Toast {
  id: number;
  achievement?: Achievement;
  title: string;
  body: string;
  icon?: string;
  variant?: "default" | "error";
}

export interface LevelUp {
  level: number;
  title: string;
}
