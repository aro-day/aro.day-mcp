// Habit schedule rules — pure. MIRROR of the app's src/lib/habit-cadence.ts
// (todo repo), plus the two date helpers it imports from src/lib/recurrence.ts
// (localDateKey, parseLocalDateKey) and clampWeekStart from
// src/lib/week-start.ts. Keep in lockstep: a rule that drifts here makes the
// connector report a different "due" / "done" than the app shows.
//
// Dates are local YYYY-MM-DD strings (the connector runs on the user's own
// machine, so process-local time is the user's). "Active" = started, not
// paused, not archived. "Due" = active AND the cadence asks for it that day.

import { dayCompletion } from "./habit-log.js";
import type { Habit, HabitCadence, HabitLog, TodoState } from "./state.js";

/** Matches clampWeekStart's fallback (Monday). */
export const DEFAULT_HABIT_WEEK_START = 1;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(v: string): boolean {
  return DAY_KEY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function parseLocalDateKey(key: string): Date {
  const parts = key.split("-").map(Number);
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

/** settings.calendar.weekStartsOn (0 = Sunday … 6) → legal range, Monday fallback. */
export function clampWeekStart(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 1;
}

/** A date string or ISO timestamp → local YYYY-MM-DD. */
export function toDateKey(v: string): string {
  return DAY_KEY_RE.test(v) ? v : localDateKey(new Date(v));
}

export function addDays(date: string, n: number): string {
  const d = parseLocalDateKey(date);
  // Constructing from parts (not +n*86400000 ms) keeps DST days 1 day long
  return localDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Whole days from a to b (b − a). UTC parts avoid DST hour drift. */
export function dayDiff(a: string, b: string): number {
  const pa = parseLocalDateKey(a);
  const pb = parseLocalDateKey(b);
  return Math.round(
    (Date.UTC(pb.getFullYear(), pb.getMonth(), pb.getDate()) - Date.UTC(pa.getFullYear(), pa.getMonth(), pa.getDate()))
    / 86_400_000,
  );
}

/** ISO weekday 1..7 (Mon..Sun). */
export function isoWeekdayOf(date: string): number {
  const dow = parseLocalDateKey(date).getDay();
  return dow === 0 ? 7 : dow;
}

/** The habit's week start from settings (Monday when unset or invalid). */
export function weekStartOf(s: TodoState): number {
  const cal = (s.settings as { calendar?: { weekStartsOn?: unknown } } | undefined)?.calendar;
  return clampWeekStart(cal?.weekStartsOn);
}

/** First day of the week holding `date`. */
export function weekStartKey(date: string, weekStartsOn: number = DEFAULT_HABIT_WEEK_START): string {
  return addDays(date, -((parseLocalDateKey(date).getDay() - weekStartsOn + 7) % 7));
}

export function isPausedOn(h: Habit, date: string): boolean {
  // A half-set pause (no start) can't say which days it covers; treat as none
  if (!h.pausedFrom || !h.pausedUntil) return false;
  return date >= h.pausedFrom && date < h.pausedUntil;
}

export function isActiveOn(h: Habit, date: string): boolean {
  if (date < h.startDate) return false;
  // The archive day itself stays active so an entry made that day counts
  if (h.archivedAt && date > toDateKey(h.archivedAt)) return false;
  return !isPausedOn(h, date);
}

export function isDueOn(h: Habit, date: string): boolean {
  if (!isActiveOn(h, date)) return false;
  const c = h.cadence;
  switch (c.kind) {
    case "daily":
    case "perWeek":
    case "perMonth":
      return true;
    case "days":
      return c.weekdays.includes(isoWeekdayOf(date));
    case "everyN":
      return c.days >= 1 && dayDiff(h.startDate, date) % Math.floor(c.days) === 0;
  }
}

export function isPeriodCadence(c: HabitCadence): c is { kind: "perWeek" | "perMonth"; times: number } {
  return c.kind === "perWeek" || c.kind === "perMonth";
}

/** The week / month containing `date` for perWeek / perMonth habits; null
 *  for day-based cadences. */
export function periodRange(
  h: Habit,
  date: string,
  weekStartsOn: number = DEFAULT_HABIT_WEEK_START,
): { start: string; end: string } | null {
  if (h.cadence.kind === "perWeek") {
    const start = weekStartKey(date, weekStartsOn);
    return { start, end: addDays(start, 6) };
  }
  if (h.cadence.kind === "perMonth") {
    const d = parseLocalDateKey(date);
    return {
      start: localDateKey(new Date(d.getFullYear(), d.getMonth(), 1)),
      end: localDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    };
  }
  return null;
}

/** Successful days so far in the period holding `date` (up to `date`), vs
 *  the period target. Day-based cadences report `date` itself out of 1. */
export function periodProgress(
  h: Habit,
  logs: HabitLog[],
  date: string,
  weekStartsOn: number = DEFAULT_HABIT_WEEK_START,
): { done: number; target: number } {
  const own = new Map<string, HabitLog>();
  for (const l of logs) if (l.habitId === h.id) own.set(l.date, l);
  const range = periodRange(h, date, weekStartsOn);
  if (!range || !isPeriodCadence(h.cadence)) {
    const log = own.get(date);
    return { done: !log?.skipped && dayCompletion(h, log) >= 1 ? 1 : 0, target: 1 };
  }
  let done = 0;
  for (let d = range.start; d <= date && d <= range.end; d = addDays(d, 1)) {
    const log = own.get(d);
    if (!isActiveOn(h, d) || log?.skipped) continue;
    if (dayCompletion(h, log) >= 1) done++;
  }
  return { done, target: h.cadence.times };
}
