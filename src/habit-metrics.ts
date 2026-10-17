// Habit stats the connector reports — pure. MIRROR of currentStreak and
// todayProgress (plus their private helpers) in the app's
// src/lib/habit-metrics.ts (todo repo); keep in lockstep so the streak the
// agent quotes is the one aro.day shows.
//
// Shared rules: a skipped day or a day the habit isn't active neither counts
// nor breaks anything; today is never a miss until it is over; perWeek /
// perMonth habits are measured in periods — a missed period breaks a streak
// only if every day of it was active and unskipped.

import {
  addDays, DEFAULT_HABIT_WEEK_START, isActiveOn, isDueOn, isPeriodCadence, periodProgress, periodRange, weekStartOf,
} from "./habit-cadence.js";
import { dayCompletion, isDaySuccess } from "./habit-log.js";
import type { Habit, HabitLog, TodoState } from "./state.js";

export type StreakUnit = "day" | "week" | "month";
export interface Streak { count: number; unit: StreakUnit }

// Runaway-loop guard on malformed data: 30 years of days / periods
const MAX_WALK = 11_000;

function byDate(h: Habit, logs: HabitLog[]): Map<string, HabitLog> {
  const m = new Map<string, HabitLog>();
  for (const l of logs) if (l.habitId === h.id) m.set(l.date, l);
  return m;
}

function unitOf(h: Habit): StreakUnit {
  if (h.cadence.kind === "perWeek") return "week";
  if (h.cadence.kind === "perMonth") return "month";
  return "day";
}

type DayOutcome = "success" | "miss" | "neutral";

function dayOutcome(h: Habit, own: Map<string, HabitLog>, d: string, today: string): DayOutcome {
  if (d > today || !isDueOn(h, d)) return "neutral";
  const log = own.get(d);
  if (log?.skipped) return "neutral";
  if (isDaySuccess(h, log, d, today)) return "success";
  return d === today ? "neutral" : "miss";
}

interface Period { start: string; end: string; done: number; target: number; outcome: DayOutcome }

function periodAt(h: Habit, logs: HabitLog[], own: Map<string, HabitLog>, date: string, today: string, ws: number): Period {
  const range = periodRange(h, date, ws)!;
  const current = range.start <= today && today <= range.end;
  const { done, target } = periodProgress(h, logs, current ? today : range.end, ws);
  if (done >= target) return { ...range, done, target, outcome: "success" };
  if (current) return { ...range, done, target, outcome: "neutral" };
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    if (!isActiveOn(h, d) || own.get(d)?.skipped) return { ...range, done, target, outcome: "neutral" };
  }
  return { ...range, done, target, outcome: "miss" };
}

export function currentStreak(h: Habit, logs: HabitLog[], today: string, weekStartsOn: number = DEFAULT_HABIT_WEEK_START): Streak {
  const own = byDate(h, logs);
  let count = 0;
  if (isPeriodCadence(h.cadence)) {
    let p = periodAt(h, logs, own, today, today, weekStartsOn);
    for (let i = 0; i < MAX_WALK && p.end >= h.startDate; i++) {
      if (p.outcome === "success") count++;
      else if (p.outcome === "miss") break;
      p = periodAt(h, logs, own, addDays(p.start, -1), today, weekStartsOn);
    }
    return { count, unit: unitOf(h) };
  }
  let d = today;
  for (let i = 0; i < MAX_WALK && d >= h.startDate; i++, d = addDays(d, -1)) {
    const o = dayOutcome(h, own, d, today);
    if (o === "success") count++;
    else if (o === "miss") break;
  }
  return { count, unit: "day" };
}

/** Today's live habits: how many are due and how many are done. A limit
 *  under its target counts as done (on track); a perWeek / perMonth habit
 *  whose period target is already hit counts as done. Skipped today ⇒ not due. */
export function todayProgress(s: TodoState, today: string): { done: number; due: number } {
  const ws = weekStartOf(s);
  const logs = s.habitLogs ?? [];
  const own = new Map<string, HabitLog>();
  for (const l of logs) if (l.date === today) own.set(l.habitId, l);
  let done = 0;
  let due = 0;
  for (const h of s.habits ?? []) {
    if (h.archivedAt || !isDueOn(h, today)) continue;
    const log = own.get(h.id);
    if (log?.skipped) continue;
    due++;
    const period = isPeriodCadence(h.cadence) ? periodProgress(h, logs, today, ws) : null;
    if ((period && period.done >= period.target) || dayCompletion(h, log) >= 1) done++;
  }
  return { done, due };
}
