// Shared bun:test fixtures for the habit helpers. MIRROR of the app's
// src/lib/habit-test-fixtures.ts (todo repo). Test-only. 2026-10-17 is a Saturday.
import type { Habit, HabitLog, TodoState } from "./state.js";

export function mkHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: "h1", name: "Water", glyph: "●", color: "blue",
    type: "check", target: 1, unit: null,
    cadence: { kind: "daily" }, timeOfDay: "any", at: null, reminders: [],
    startDate: "2026-09-01", pausedFrom: null, pausedUntil: null, archivedAt: null,
    order: 0, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z",
    ...over,
  };
}

export function mkLog(habitId: string, date: string, value = 1, extra: Partial<HabitLog> = {}): HabitLog {
  return { id: `hl_${habitId}_${date}`, habitId, date, value, updatedAt: `${date}T20:00:00.000Z`, ...extra };
}

/** Every local day from `from` to `to` inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number) as [number, number, number];
  for (let i = 0; ; i++) {
    const dt = new Date(y, m - 1, d + i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    if (key > to) break;
    out.push(key);
  }
  return out;
}

export function doneOn(habitId: string, dates: string[], value = 1): HabitLog[] {
  return dates.map((d) => mkLog(habitId, d, value));
}

export function mkState(habits: Habit[], habitLogs: HabitLog[], weekStartsOn?: number): TodoState {
  return {
    schemaVersion: 45, tasks: [], groups: [], sessions: [], trash: [], people: [], externalEvents: [],
    habits, habitLogs,
    settings: { calendar: weekStartsOn === undefined ? {} : { weekStartsOn } },
    meta: { lastModifiedBy: "test", lastModifiedAt: "2026-10-17T00:00:00.000Z" },
  } as unknown as TodoState;
}
