// What each habit tool does to the state, as pure functions over TodoState —
// habit-tools.ts wraps them in getState()/mutate(); habit-ops.test.ts drives
// them on fixture states. Writes go to TodoState.habits / habitLogs (app
// v45+) only — never to old habit card rows in the Habits project.
//
// Creation / validation mirrors the app's createHabit (todo repo →
// src/features/habits-view/habits-actions.ts) and its editor's toDraft
// (src/features/habits-view/HabitEditor.tsx). No free cap: the connector is
// Pro-only. Every write stamps updatedAt (per-record LWW in sync-merge.ts).

import {
  addDays, isActiveOn, isDateKey, isDueOn, isPausedOn, isPeriodCadence, localDateKey, periodProgress, toDateKey,
  weekStartOf,
} from "./habit-cadence.js";
import { addToHabit, clearHabitDay, dayCompletion, logFor, logsForHabit, setHabitNote, setHabitSkipped, setHabitValue } from "./habit-log.js";
import { currentStreak, todayProgress } from "./habit-metrics.js";
import { newId, type Habit, type HabitCadence, type HabitTimeOfDay, type HabitType, type TodoState } from "./state.js";

/** First app schemaVersion with habits[] + habitLogs[]. */
export const HABITS_SCHEMA_VERSION = 45;

/** MIRROR of HABIT_COLOR_KEYS / HABIT_GLYPHS in the app's src/lib/habit-constants.ts. */
export const HABIT_COLOR_KEYS = ["blue", "teal", "green", "amber", "violet", "pink"] as const;
export const HABIT_GLYPHS = ["●", "◆", "■", "▲", "★", "◉", "◈", "✦"] as const;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/; // same as the app's habit-reminders.ts

/** Today as the user's local YYYY-MM-DD (the connector runs on their machine). */
export function todayKey(): string {
  return localDateKey(new Date());
}

/** Old-shape blobs (pre-v45) still keep habits as task rows; the app
 *  converts them on its next load. Refuse rather than write a shape the
 *  app would have to reconcile. Guarantees both arrays on a v45+ blob. */
export function requireHabitsModel(s: TodoState): { habits: Habit[]; logs: NonNullable<TodoState["habitLogs"]> } {
  if ((s.schemaVersion ?? 0) < HABITS_SCHEMA_VERSION) {
    throw new Error(
      "Your aro.day data still uses the old habits format. Open aro.day once (signed in, Drive " +
      "connected) so it upgrades your habits, then try again.",
    );
  }
  if (!Array.isArray(s.habits)) s.habits = [];
  if (!Array.isArray(s.habitLogs)) s.habitLogs = [];
  return { habits: s.habits, logs: s.habitLogs };
}

/** MIRROR of the app's normalizeHabitTitle (src/lib/habit-constants.ts). */
export function normalizeHabitTitle(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** MIRROR of the app's nextLook: first colour / glyph not used yet. */
export function nextLook(habits: Habit[]): { color: string; glyph: string } {
  const n = habits.length;
  const color = HABIT_COLOR_KEYS.find((c) => !habits.some((h) => h.color === c)) ?? HABIT_COLOR_KEYS[n % HABIT_COLOR_KEYS.length]!;
  const glyph = HABIT_GLYPHS.find((g) => !habits.some((h) => h.glyph === g)) ?? HABIT_GLYPHS[n % HABIT_GLYPHS.length]!;
  return { color, glyph };
}

export function requireHabit(s: TodoState, id: string): Habit {
  const h = requireHabitsModel(s).habits.find((x) => x.id === id);
  if (!h) throw new Error(`No habit with id "${id}".`);
  return h;
}

function checkName(habits: Habit[], raw: string, exceptId: string | null): string {
  const name = raw.trim();
  if (!name) throw new Error("A habit needs a name.");
  const key = normalizeHabitTitle(name);
  // Archived habits included — same as the app's isDuplicateHabitName
  if (habits.some((h) => h.id !== exceptId && normalizeHabitTitle(h.name) === key)) {
    throw new Error(`A habit named "${name}" already exists.`);
  }
  return name;
}

function checkClock(v: string | null | undefined, field: string): string | null {
  if (v == null || v === "") return null;
  if (!HHMM_RE.test(v)) throw new Error(`${field} must be a 24-hour "HH:MM" time, got "${v}".`);
  return v;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The editor's cadence rules: no period cadence for a limit, at least one
 *  weekday, times clamped to what a week (7) / month (28) can hold. */
function checkCadence(type: HabitType, c: HabitCadence): HabitCadence {
  if (type === "limit" && isPeriodCadence(c)) {
    throw new Error("A limit habit is checked day by day, so it can't use a perWeek / perMonth cadence.");
  }
  switch (c.kind) {
    case "daily":
      return { kind: "daily" };
    case "days": {
      const weekdays = [...new Set(c.weekdays.filter((w) => Number.isInteger(w) && w >= 1 && w <= 7))].sort((a, b) => a - b);
      if (weekdays.length === 0) throw new Error("A days cadence needs at least one weekday (1 = Monday … 7 = Sunday).");
      return { kind: "days", weekdays };
    }
    case "perWeek":
    case "perMonth":
      if (!Number.isInteger(c.times) || c.times < 1) throw new Error("times must be a whole number of at least 1.");
      return { kind: c.kind, times: clamp(c.times, 1, c.kind === "perWeek" ? 7 : 28) };
    case "everyN":
      if (!Number.isInteger(c.days) || c.days < 1) throw new Error("days must be a whole number of at least 1.");
      return { kind: "everyN", days: clamp(c.days, 1, 365) };
  }
}

interface Definition { type: HabitType; target: number; unit: string | null; cadence: HabitCadence }

/** Goal + unit + cadence, validated together (they depend on the type). */
function checkDefinition(d: { type: HabitType; target?: number; unit?: string | null; cadence: HabitCadence }): Definition {
  let target = 1; // check habits are always out of 1
  if (d.type !== "check") {
    target = d.target ?? 1; // the editor's starting goal
    const min = d.type === "limit" ? 0 : 1;
    if (!Number.isInteger(target) || target < min) {
      throw new Error(`target must be a whole number of at least ${min} for a ${d.type} habit.`);
    }
  }
  // Timer amounts are minutes and a check has no amount, so only count / limit carry a unit
  const unit = d.type === "count" || d.type === "limit" ? (d.unit?.trim() || null) : null;
  return { type: d.type, target, unit, cadence: checkCadence(d.type, d.cadence) };
}

export interface HabitFields {
  name?: string;
  type?: HabitType;
  target?: number;
  unit?: string | null;
  cadence?: HabitCadence;
  timeOfDay?: HabitTimeOfDay;
  at?: string | null;
  reminders?: string[];
  glyph?: string;
  color?: (typeof HABIT_COLOR_KEYS)[number];
}

export function createHabitOp(
  s: TodoState,
  input: HabitFields & { name: string },
  nowIso: string,
  today: string,
): Habit {
  const { habits } = requireHabitsModel(s);
  const name = checkName(habits, input.name, null);
  const look = nextLook(habits);
  const habit: Habit = {
    id: newId("hab"),
    name,
    glyph: input.glyph ?? look.glyph,
    color: input.color ?? look.color,
    ...checkDefinition({ type: input.type ?? "check", target: input.target, unit: input.unit, cadence: input.cadence ?? { kind: "daily" } }),
    timeOfDay: input.timeOfDay ?? "any",
    at: checkClock(input.at, "at"),
    reminders: (input.reminders ?? []).map((r) => checkClock(r, "reminders")!).filter((r, i, a) => a.indexOf(r) === i).sort(),
    startDate: today,
    pausedFrom: null,
    pausedUntil: null,
    archivedAt: null,
    order: habits.reduce((max, h) => Math.max(max, h.order), -1) + 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  habits.push(habit);
  return habit;
}

/** Patch a habit's definition. Type / target / unit / cadence are
 *  re-validated together, so switching type keeps the record consistent. */
export function updateHabitOp(s: TodoState, id: string, patch: HabitFields, nowIso: string): Habit {
  const h = requireHabit(s, id);
  const habits = s.habits!;
  const name = patch.name !== undefined ? checkName(habits, patch.name, id) : h.name;
  const def = checkDefinition({
    type: patch.type ?? h.type,
    target: patch.target ?? h.target,
    unit: patch.unit !== undefined ? patch.unit : h.unit,
    cadence: patch.cadence ?? h.cadence,
  });
  Object.assign(h, def, { name });
  if (patch.glyph !== undefined) h.glyph = patch.glyph;
  if (patch.color !== undefined) h.color = patch.color;
  if (patch.timeOfDay !== undefined) h.timeOfDay = patch.timeOfDay;
  if (patch.at !== undefined) h.at = checkClock(patch.at, "at");
  if (patch.reminders !== undefined) {
    h.reminders = patch.reminders.map((r) => checkClock(r, "reminders")!).filter((r, i, a) => a.indexOf(r) === i).sort();
  }
  h.updatedAt = nowIso;
  return h;
}

/** Archive (archived: true) or bring back (false). Never deletes: a delete
 *  would tombstone the id, which no later edit can undo. */
export function archiveHabitOp(s: TodoState, id: string, archived: boolean, nowIso: string): Habit {
  const h = requireHabit(s, id);
  if (archived === !!h.archivedAt) return h;
  h.archivedAt = archived ? nowIso : null;
  h.updatedAt = nowIso;
  return h;
}

export interface LogInput {
  habitId: string;
  date: string;
  value?: number;
  add?: number;
  skip?: boolean;
  note?: string;
  clear?: boolean;
}

/** One day's entry: set or add to the amount, skip / un-skip, note. */
export function logHabitOp(s: TodoState, input: LogInput, nowIso: string, today: string) {
  const h = requireHabit(s, input.habitId);
  const { date } = input;
  if (!isDateKey(date)) throw new Error(`date must be YYYY-MM-DD, got "${date}".`);
  if (date > today) throw new Error(`${date} is in the future; habits can only be logged up to today (${today}).`);
  if (date < h.startDate) throw new Error(`${h.name} starts on ${h.startDate}; days before that don't count.`);
  if (h.archivedAt) throw new Error(`${h.name} is archived. Bring it back with archive_habit (archived: false) first.`);
  const edits = [input.value, input.add, input.skip, input.note].filter((x) => x !== undefined).length;
  if (input.clear) {
    if (edits > 0) throw new Error("clear resets the day on its own; don't combine it with value, add, skip or note.");
    clearHabitDay(s, h.id, date, nowIso);
    return { entry: logFor(s, h.id, date) ?? null, status: habitDayStatus(s, h, date, today) };
  }
  if (input.value !== undefined && input.add !== undefined) throw new Error("Give value OR add, not both.");
  if (edits === 0) throw new Error("Nothing to log: give value, add, skip, note or clear.");
  if (input.value !== undefined) setHabitValue(s, h.id, date, input.value, nowIso);
  if (input.add !== undefined) addToHabit(s, h.id, date, input.add, nowIso);
  if (input.skip !== undefined) setHabitSkipped(s, h.id, date, input.skip, nowIso);
  if (input.note !== undefined) setHabitNote(s, h.id, date, input.note, nowIso);
  return { entry: logFor(s, h.id, date)!, status: habitDayStatus(s, h, date, today) };
}

/** Where one habit stands on one day. `done` matches the app's today
 *  progress: a limit under its target is on track; a perWeek / perMonth
 *  habit is done once its period target is hit. */
export function habitDayStatus(s: TodoState, h: Habit, date: string, today: string) {
  const log = logFor(s, h.id, date);
  const ws = weekStartOf(s);
  const period = isPeriodCadence(h.cadence) ? periodProgress(h, s.habitLogs ?? [], date, ws) : null;
  const completion = dayCompletion(h, log);
  return {
    date,
    due: isDueOn(h, date),
    active: isActiveOn(h, date),
    value: log?.value ?? 0,
    target: h.target,
    unit: h.unit,
    skipped: !!log?.skipped,
    note: log?.note ?? null,
    done: !log?.skipped && ((period !== null && period.done >= period.target) || completion >= 1),
    period: period && { kind: h.cadence.kind, ...period },
    streak: currentStreak(h, s.habitLogs ?? [], today, ws),
  };
}

function habitSummary(s: TodoState, h: Habit, today: string) {
  return {
    id: h.id, name: h.name, glyph: h.glyph, color: h.color, type: h.type, target: h.target, unit: h.unit,
    cadence: h.cadence, timeOfDay: h.timeOfDay, at: h.at, reminders: h.reminders,
    startDate: h.startDate, archived: !!h.archivedAt, paused: isPausedOn(h, today),
    today: habitDayStatus(s, h, today, today),
  };
}

export function listHabitsOp(s: TodoState, opts: { includeArchived?: boolean }, today: string) {
  const { habits } = requireHabitsModel(s);
  const shown = habits.filter((h) => opts.includeArchived || !h.archivedAt).sort((a, b) => a.order - b.order);
  return { date: today, progress: todayProgress(s, today), habits: shown.map((h) => habitSummary(s, h, today)) };
}

/** A habit with its entries for the last `days` days (newest first). */
export function getHabitOp(s: TodoState, id: string, days: number, today: string) {
  const h = requireHabit(s, id);
  const from = addDays(today, -(days - 1));
  const entries = logsForHabit(s, h.id)
    .filter((l) => l.date >= from && l.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((l) => ({ date: l.date, value: l.value, skipped: !!l.skipped, note: l.note ?? null }));
  return {
    ...h,
    archivedOn: h.archivedAt ? toDateKey(h.archivedAt) : null,
    today: habitDayStatus(s, h, today, today),
    entries,
  };
}
