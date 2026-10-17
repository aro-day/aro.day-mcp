// habit-ops: what each habit tool does to a state. Run: bun test
import { describe, expect, test } from "bun:test";
import {
  archiveHabitOp, createHabitOp, getHabitOp, listHabitsOp, logHabitOp, requireHabitsModel, updateHabitOp,
} from "./habit-ops.js";
import { mkHabit, mkLog, mkState } from "./habit-test-fixtures.js";
import type { TodoState } from "./state.js";

const TODAY = "2026-10-17"; // Saturday
const T1 = "2026-10-17T09:00:00.000Z";
const T2 = "2026-10-17T10:00:00.000Z";

describe("requireHabitsModel", () => {
  test("refuses a pre-v45 blob with a clear message", () => {
    const s = { ...mkState([], []), schemaVersion: 44 } as TodoState;
    delete s.habits;
    expect(() => requireHabitsModel(s)).toThrow(/Open aro.day once/);
    expect(s.habits).toBeUndefined(); // nothing written into an old blob
  });

  test("initializes missing arrays on a v45+ blob", () => {
    const s = mkState([], []);
    delete s.habits;
    delete s.habitLogs;
    requireHabitsModel(s);
    expect(s.habits).toEqual([]);
    expect(s.habitLogs).toEqual([]);
  });
});

describe("createHabitOp", () => {
  test("app defaults: check, daily, any, starts today, next order, unused look", () => {
    const s = mkState([mkHabit({ order: 4 })], []);
    const h = createHabitOp(s, { name: "  Read  " }, T1, TODAY);
    expect(h.id.startsWith("hab_")).toBe(true);
    expect(h).toMatchObject({
      name: "Read", type: "check", target: 1, unit: null, cadence: { kind: "daily" }, timeOfDay: "any",
      at: null, reminders: [], startDate: TODAY, pausedFrom: null, pausedUntil: null, archivedAt: null,
      order: 5, createdAt: T1, updatedAt: T1,
    });
    // mkHabit uses blue + ●, so the next free ones are teal + ◆
    expect(h.color).toBe("teal");
    expect(h.glyph).toBe("◆");
    expect(s.habits).toHaveLength(2);
  });

  test("count keeps its unit and goal; timer drops a unit; check forces target 1", () => {
    const s = mkState([], []);
    expect(createHabitOp(s, { name: "Water", type: "count", target: 8, unit: " glasses " }, T1, TODAY))
      .toMatchObject({ target: 8, unit: "glasses" });
    expect(createHabitOp(s, { name: "Focus", type: "timer", target: 30, unit: "min" }, T1, TODAY))
      .toMatchObject({ target: 30, unit: null });
    expect(createHabitOp(s, { name: "Pray", type: "check", target: 5 }, T1, TODAY).target).toBe(1);
  });

  test("a limit may target 0 but may not use a period cadence", () => {
    const s = mkState([], []);
    expect(createHabitOp(s, { name: "Soda", type: "limit", target: 0 }, T1, TODAY).target).toBe(0);
    expect(() => createHabitOp(s, { name: "Coffee", type: "limit", target: 2, cadence: { kind: "perWeek", times: 3 } }, T1, TODAY))
      .toThrow(/limit/);
  });

  test("rejects a duplicate name (case/space-insensitive, archived included)", () => {
    const s = mkState([mkHabit({ name: "Read 20 min", archivedAt: T1 })], []);
    expect(() => createHabitOp(s, { name: "read  20 MIN" }, T1, TODAY)).toThrow(/already exists/);
  });

  test("validates cadence, times and clocks", () => {
    const s = mkState([], []);
    expect(createHabitOp(s, { name: "Gym", cadence: { kind: "days", weekdays: [5, 1, 3, 1] } }, T1, TODAY).cadence)
      .toEqual({ kind: "days", weekdays: [1, 3, 5] });
    expect(() => createHabitOp(s, { name: "X", cadence: { kind: "days", weekdays: [] } }, T1, TODAY)).toThrow(/weekday/);
    expect(() => createHabitOp(s, { name: "Y", type: "count", target: 0 }, T1, TODAY)).toThrow(/target/);
    expect(() => createHabitOp(s, { name: "Z", at: "25:00" }, T1, TODAY)).toThrow(/HH:MM/);
    expect(createHabitOp(s, { name: "W", reminders: ["21:00", "07:30", "21:00"] }, T1, TODAY).reminders)
      .toEqual(["07:30", "21:00"]);
  });

  test("refuses on an old-shape blob", () => {
    const s = { ...mkState([], []), schemaVersion: 44 } as TodoState;
    expect(() => createHabitOp(s, { name: "Read" }, T1, TODAY)).toThrow(/old habits format/);
  });
});

describe("updateHabitOp", () => {
  test("patches fields and stamps updatedAt", () => {
    const s = mkState([mkHabit()], []);
    const h = updateHabitOp(s, "h1", { name: "Hydrate", timeOfDay: "morning", at: "07:00", color: "pink" }, T2);
    expect(h).toMatchObject({ name: "Hydrate", timeOfDay: "morning", at: "07:00", color: "pink", updatedAt: T2 });
  });

  test("switching type re-validates goal and unit together", () => {
    const s = mkState([mkHabit({ type: "count", target: 8, unit: "glasses" })], []);
    expect(updateHabitOp(s, "h1", { type: "timer" }, T2)).toMatchObject({ type: "timer", target: 8, unit: null });
    expect(updateHabitOp(s, "h1", { type: "check" }, T2)).toMatchObject({ type: "check", target: 1 });
  });

  test("rejects a name another habit uses, and an unknown id", () => {
    const s = mkState([mkHabit(), mkHabit({ id: "h2", name: "Read" })], []);
    expect(() => updateHabitOp(s, "h2", { name: "water" }, T2)).toThrow(/already exists/);
    expect(updateHabitOp(s, "h1", { name: "Water" }, T2).name).toBe("Water"); // own name is fine
    expect(() => updateHabitOp(s, "nope", { name: "Q" }, T2)).toThrow(/No habit/);
  });
});

describe("archiveHabitOp", () => {
  test("archives and brings back, stamping updatedAt; never removes the record", () => {
    const s = mkState([mkHabit()], []);
    expect(archiveHabitOp(s, "h1", true, T1)).toMatchObject({ archivedAt: T1, updatedAt: T1 });
    expect(archiveHabitOp(s, "h1", false, T2)).toMatchObject({ archivedAt: null, updatedAt: T2 });
    expect(s.habits).toHaveLength(1);
    expect(s.tombstones ?? []).toEqual([]);
  });
});

describe("logHabitOp", () => {
  test("sets a value with the per-day id and reports the day", () => {
    const s = mkState([mkHabit({ type: "count", target: 8 })], []);
    const r = logHabitOp(s, { habitId: "h1", date: TODAY, value: 8 }, T1, TODAY);
    expect(r.entry).toEqual({ id: "hl_h1_2026-10-17", habitId: "h1", date: TODAY, value: 8, updatedAt: T1 });
    expect(r.status).toMatchObject({ due: true, value: 8, target: 8, done: true });
  });

  test("add accumulates on the same entry; never below 0", () => {
    const s = mkState([mkHabit({ type: "count", target: 8 })], []);
    logHabitOp(s, { habitId: "h1", date: TODAY, add: 3 }, T1, TODAY);
    expect(logHabitOp(s, { habitId: "h1", date: TODAY, add: 2 }, T2, TODAY).entry!.value).toBe(5);
    expect(logHabitOp(s, { habitId: "h1", date: TODAY, add: -9 }, T2, TODAY).entry!.value).toBe(0);
    expect(s.habitLogs).toHaveLength(1);
  });

  test("skip with a note; a skipped day is not done", () => {
    const s = mkState([mkHabit()], []);
    const r = logHabitOp(s, { habitId: "h1", date: "2026-10-16", skip: true, note: " sick " }, T1, TODAY);
    expect(r.entry).toMatchObject({ skipped: true, note: "sick" });
    expect(r.status).toMatchObject({ skipped: true, done: false, note: "sick" });
  });

  test("clear blanks the day in place (the entry stays, no tombstone)", () => {
    const s = mkState([mkHabit()], [mkLog("h1", TODAY, 1, { note: "x" })]);
    const r = logHabitOp(s, { habitId: "h1", date: TODAY, clear: true }, T2, TODAY);
    expect(r.entry).toEqual({ id: "hl_h1_2026-10-17", habitId: "h1", date: TODAY, value: 0, updatedAt: T2 });
    expect(() => logHabitOp(s, { habitId: "h1", date: TODAY, clear: true, value: 1 }, T2, TODAY)).toThrow(/on its own/);
  });

  test("streak in the status counts the logged day", () => {
    const s = mkState([mkHabit()], [mkLog("h1", "2026-10-15"), mkLog("h1", "2026-10-16")]);
    expect(logHabitOp(s, { habitId: "h1", date: TODAY, value: 1 }, T1, TODAY).status.streak).toEqual({ count: 3, unit: "day" });
  });

  test("refuses future days, days before the start, archived habits and empty or mixed input", () => {
    const s = mkState([mkHabit(), mkHabit({ id: "h2", name: "Old", archivedAt: T1 })], []);
    expect(() => logHabitOp(s, { habitId: "h1", date: "2026-10-18", value: 1 }, T1, TODAY)).toThrow(/future/);
    expect(() => logHabitOp(s, { habitId: "h1", date: "2026-08-31", value: 1 }, T1, TODAY)).toThrow(/starts on/);
    expect(() => logHabitOp(s, { habitId: "h1", date: "17/10/2026", value: 1 }, T1, TODAY)).toThrow(/YYYY-MM-DD/);
    expect(() => logHabitOp(s, { habitId: "h2", date: TODAY, value: 1 }, T1, TODAY)).toThrow(/archived/);
    expect(() => logHabitOp(s, { habitId: "h1", date: TODAY }, T1, TODAY)).toThrow(/Nothing to log/);
    expect(() => logHabitOp(s, { habitId: "h1", date: TODAY, value: 1, add: 1 }, T1, TODAY)).toThrow(/not both/);
    expect(s.habitLogs).toEqual([]);
  });
});

describe("listHabitsOp / getHabitOp", () => {
  const s = mkState([
    mkHabit({ order: 1 }),
    mkHabit({ id: "h2", name: "Gym", order: 0, cadence: { kind: "perWeek", times: 3 } }),
    mkHabit({ id: "h3", name: "Old", order: 2, archivedAt: "2026-10-01T09:00:00.000Z" }),
  ], [mkLog("h1", TODAY), mkLog("h2", "2026-10-12"), mkLog("h2", "2026-10-14"), mkLog("h1", "2026-09-01")]);

  test("lists live habits by order with today's status, streak and totals", () => {
    const r = listHabitsOp(s, {}, TODAY);
    expect(r.date).toBe(TODAY);
    expect(r.habits.map((h) => h.id)).toEqual(["h2", "h1"]);
    expect(r.habits[1]!.today).toMatchObject({ value: 1, done: true, streak: { count: 1, unit: "day" } });
    expect(r.habits[0]!.today.period).toEqual({ kind: "perWeek", done: 2, target: 3 });
    expect(r.progress).toEqual({ done: 1, due: 2 });
    expect(listHabitsOp(s, { includeArchived: true }, TODAY).habits).toHaveLength(3);
  });

  test("get_habit returns the record and recent entries, newest first", () => {
    const r = getHabitOp(s, "h1", 14, TODAY);
    expect(r.name).toBe("Water");
    expect(r.entries).toEqual([{ date: TODAY, value: 1, skipped: false, note: null }]); // Sep 1 is outside 14 days
    expect(getHabitOp(s, "h3", 7, TODAY).archivedOn).toBe("2026-10-01");
  });
});
