// Habit records (app v45+), re-exported by state.ts (the schema mirror) whose
// TodoState.habits / habitLogs use them. Top-level collections that replaced the old habit "card lineages" (task
// rows in the Habits project linked by habitGroupId). Mirror of the app's
// Habit / HabitLog / HabitCadence / HabitType / HabitTimeOfDay (todo repo →
// src/types/window-state.d.ts) — keep in lockstep. Dates are local
// YYYY-MM-DD; every write stamps updatedAt (per-record LWW in sync-merge.ts).

/** check = yes/no; count/timer = reach `target` (timer values are minutes);
 *  limit = stay at or under `target`. */
export type HabitType = "check" | "count" | "timer" | "limit";
export type HabitCadence =
  | { kind: "daily" }
  | { kind: "days"; weekdays: number[] } // ISO 1..7 (Mon..Sun)
  | { kind: "perWeek" | "perMonth"; times: number }
  | { kind: "everyN"; days: number }; // anchored on startDate
export type HabitTimeOfDay = "morning" | "afternoon" | "evening" | "any";

export interface Habit {
  id: string;
  name: string;
  glyph: string;
  color: string; // palette key (habit-ops.ts HABIT_COLOR_KEYS), not a hex
  type: HabitType;
  target: number; // check: 1. limit: may be 0
  unit: string | null;
  cadence: HabitCadence;
  timeOfDay: HabitTimeOfDay;
  at: string | null; // "HH:MM"
  reminders: string[]; // "HH:MM" each
  startDate: string;
  pausedFrom: string | null; // pause window [pausedFrom, pausedUntil)
  pausedUntil: string | null;
  archivedAt: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
  runningSince?: string | null; // timer habits: live interval start
}

/** One habit's entry for one local day, id `hl_<habitId>_<date>`. value:
 *  check 0/1, count units, timer minutes, limit amount taken. Never
 *  tombstoned — a cleared day stays as a blank entry. */
export interface HabitLog {
  id: string;
  habitId: string;
  date: string;
  value: number;
  skipped?: boolean;
  note?: string;
  updatedAt: string;
}
