// Habit day entries (TodoState.habitLogs) — pure state helpers. MIRROR of
// the app's src/lib/habit-log.ts (todo repo); keep in lockstep.
//
// Sync contract (app's src/state/sync-merge.ts): an entry's id is fixed per
// (habit, day) — habitLogId — so two devices logging different days or habits
// merge per entry, and the same day dedups to the newer edit. Every write here
// stamps updatedAt. Entries are NEVER removed + tombstoned: a tombstone beats
// any later re-create of the same id, which would make that day impossible
// to log again. A cleared day stays as a blank entry instead.

import type { Habit, HabitLog, TodoState } from "./state.js";

/** The one id for a habit's entry on a local day. */
export function habitLogId(habitId: string, date: string): string {
  return `hl_${habitId}_${date}`;
}

function logsArr(s: TodoState): HabitLog[] {
  if (!Array.isArray(s.habitLogs)) s.habitLogs = [];
  return s.habitLogs;
}

export function logsForHabit(s: TodoState, id: string): HabitLog[] {
  return (s.habitLogs ?? []).filter((l) => l.habitId === id);
}

export function logFor(s: TodoState, id: string, date: string): HabitLog | undefined {
  const logId = habitLogId(id, date);
  return (s.habitLogs ?? []).find((l) => l.id === logId);
}

function upsert(s: TodoState, id: string, date: string, nowIso: string): HabitLog {
  const existing = logFor(s, id, date);
  if (existing) {
    existing.updatedAt = nowIso;
    return existing;
  }
  const created: HabitLog = { id: habitLogId(id, date), habitId: id, date, value: 0, updatedAt: nowIso };
  logsArr(s).push(created);
  return created;
}

function clampValue(v: number): number {
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** Sets the day's amount (check: 1 done / 0 not). Recording an amount
 *  un-skips the day — the user did act on it. */
export function setHabitValue(s: TodoState, id: string, date: string, value: number, nowIso: string): HabitLog {
  const log = upsert(s, id, date, nowIso);
  log.value = clampValue(value);
  delete log.skipped;
  return log;
}

/** Adds `delta` (may be negative) to the day's amount, never below 0. */
export function addToHabit(s: TodoState, id: string, date: string, delta: number, nowIso: string): HabitLog {
  const current = logFor(s, id, date)?.value ?? 0;
  return setHabitValue(s, id, date, current + (Number.isFinite(delta) ? delta : 0), nowIso);
}

/** Marks / unmarks a day as skipped. The amount is kept (un-skipping brings
 *  it back); every metric ignores the amount while the day is skipped. */
export function setHabitSkipped(s: TodoState, id: string, date: string, skipped: boolean, nowIso: string): HabitLog {
  const log = upsert(s, id, date, nowIso);
  if (skipped) log.skipped = true;
  else delete log.skipped;
  return log;
}

export function setHabitNote(s: TodoState, id: string, date: string, note: string, nowIso: string): HabitLog {
  const log = upsert(s, id, date, nowIso);
  const trimmed = note.trim();
  if (trimmed) log.note = trimmed;
  else delete log.note;
  return log;
}

/** Resets the day to blank (value 0, no skip, no note) as an LWW edit, so the
 *  clear reaches other devices and the day can be logged again (see header).
 *  Returns false when the day had no entry. */
export function clearHabitDay(s: TodoState, id: string, date: string, nowIso: string): boolean {
  const log = logFor(s, id, date);
  if (!log) return false;
  log.value = 0;
  delete log.skipped;
  delete log.note;
  log.updatedAt = nowIso;
  return true;
}

/** How much of the day's goal the entry reaches, 0..1. A limit day with no
 *  entry is 1; whether that may count yet is isDaySuccess's job. A skipped
 *  entry earns nothing. */
export function dayCompletion(h: Habit, log: HabitLog | undefined): number {
  if (log?.skipped) return 0;
  const value = log?.value ?? 0;
  switch (h.type) {
    case "check":
      return value >= 1 ? 1 : 0;
    case "count":
    case "timer":
      // target 0 would divide by zero; any amount meets a zero goal
      return h.target > 0 ? Math.min(1, value / h.target) : (value > 0 ? 1 : 0);
    case "limit":
      return value <= h.target ? 1 : 0;
  }
}

/** Did the habit fully succeed on `date`? Future and skipped days never do.
 *  A limit day is only earned once it is over — today stays pending. */
export function isDaySuccess(h: Habit, log: HabitLog | undefined, date: string, today: string): boolean {
  if (date > today || log?.skipped) return false;
  if (h.type === "limit" && date >= today) return false;
  return dayCompletion(h, log) >= 1;
}
