// MIRROR of the app's src/lib/habit-log.test.ts (todo repo).
import { describe, expect, it } from "bun:test";
import {
  addToHabit, clearHabitDay, dayCompletion, habitLogId, isDaySuccess, logFor, logsForHabit,
  setHabitNote, setHabitSkipped, setHabitValue,
} from "./habit-log.js";
import { mkHabit, mkLog, mkState } from "./habit-test-fixtures.js";

const T1 = "2026-10-17T09:00:00.000Z";
const T2 = "2026-10-17T10:00:00.000Z";

describe("ids and lookups", () => {
  it("one fixed id per habit per day", () => {
    expect(habitLogId("h1", "2026-10-17")).toBe("hl_h1_2026-10-17");
  });
  it("logsForHabit / logFor read only that habit", () => {
    const s = mkState([], [mkLog("h1", "2026-10-16"), mkLog("h2", "2026-10-16"), mkLog("h1", "2026-10-17")]);
    expect(logsForHabit(s, "h1").map((l) => l.date)).toEqual(["2026-10-16", "2026-10-17"]);
    expect(logFor(s, "h2", "2026-10-16")?.id).toBe("hl_h2_2026-10-16");
    expect(logFor(s, "h2", "2026-10-17")).toBeUndefined();
    expect(logsForHabit(mkState([], undefined as unknown as HabitLog[]), "h1")).toEqual([]);
  });
});

describe("writes", () => {
  it("setHabitValue creates then updates the day's entry and stamps updatedAt", () => {
    const s = mkState([], undefined as unknown as HabitLog[]);
    const a = setHabitValue(s, "h1", "2026-10-17", 3, T1);
    expect(a).toEqual({ id: "hl_h1_2026-10-17", habitId: "h1", date: "2026-10-17", value: 3, updatedAt: T1 });
    setHabitValue(s, "h1", "2026-10-17", 5, T2);
    expect(s.habitLogs).toHaveLength(1);
    expect(s.habitLogs![0]).toMatchObject({ value: 5, updatedAt: T2 });
  });
  it("setHabitValue clamps at 0, drops non-numbers and un-skips the day", () => {
    const s = mkState([], [mkLog("h1", "2026-10-17", 2, { skipped: true })]);
    setHabitValue(s, "h1", "2026-10-17", -4, T1);
    expect(s.habitLogs![0]!.value).toBe(0);
    expect("skipped" in s.habitLogs![0]!).toBe(false);
    setHabitValue(s, "h1", "2026-10-17", Number.NaN, T2);
    expect(s.habitLogs![0]!.value).toBe(0);
  });
  it("addToHabit adds to the current value and never goes below 0", () => {
    const s = mkState([], []);
    addToHabit(s, "h1", "2026-10-17", 1, T1);
    addToHabit(s, "h1", "2026-10-17", 1, T1);
    expect(logFor(s, "h1", "2026-10-17")!.value).toBe(2);
    addToHabit(s, "h1", "2026-10-17", -5, T2);
    expect(logFor(s, "h1", "2026-10-17")!.value).toBe(0);
  });
  it("setHabitSkipped keeps the amount and toggles the flag", () => {
    const s = mkState([], [mkLog("h1", "2026-10-17", 4)]);
    setHabitSkipped(s, "h1", "2026-10-17", true, T1);
    expect(logFor(s, "h1", "2026-10-17")).toMatchObject({ value: 4, skipped: true, updatedAt: T1 });
    setHabitSkipped(s, "h1", "2026-10-17", false, T2);
    expect("skipped" in logFor(s, "h1", "2026-10-17")!).toBe(false);
    setHabitSkipped(s, "h1", "2026-10-15", true, T2);
    expect(logFor(s, "h1", "2026-10-15")).toMatchObject({ value: 0, skipped: true });
  });
  it("setHabitNote trims, and an empty note removes it", () => {
    const s = mkState([], []);
    setHabitNote(s, "h1", "2026-10-17", "  travelling  ", T1);
    expect(logFor(s, "h1", "2026-10-17")).toMatchObject({ note: "travelling", value: 0 });
    setHabitNote(s, "h1", "2026-10-17", "   ", T2);
    expect("note" in logFor(s, "h1", "2026-10-17")!).toBe(false);
  });
  it("clearHabitDay blanks the entry in place (no tombstone) so the day can be logged again", () => {
    const s = mkState([], [mkLog("h1", "2026-10-17", 3, { skipped: true, note: "x" })]);
    expect(clearHabitDay(s, "h1", "2026-10-17", T2)).toBe(true);
    expect(logFor(s, "h1", "2026-10-17")).toEqual({
      id: "hl_h1_2026-10-17", habitId: "h1", date: "2026-10-17", value: 0, updatedAt: T2,
    });
    expect(clearHabitDay(s, "h1", "2026-10-10", T2)).toBe(false);
    expect(logFor(s, "h1", "2026-10-10")).toBeUndefined();
  });
});

// Review focus 2: the per-entry merge. sync-merge.ts mergeCollection is
// union-by-id, higher updatedAt wins; mirrored here because it isn't
// exported and habitLogs are only wired into mergeStates in P2.
function lwwUnion(a: HabitLog[], b: HabitLog[]): HabitLog[] {
  const m = new Map(a.map((x) => [x.id, x]));
  for (const x of b) {
    const cur = m.get(x.id);
    if (!cur || x.updatedAt > cur.updatedAt) m.set(x.id, x);
  }
  return [...m.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
}

describe("two devices logging the same day", () => {
  it("different habits and days both survive the merge", () => {
    const base = [mkLog("water", "2026-10-15")];
    const phone = mkState([], structuredClone(base));
    const laptop = mkState([], structuredClone(base));
    setHabitValue(phone, "water", "2026-10-17", 1, "2026-10-17T08:00:00.000Z");
    setHabitValue(laptop, "read", "2026-10-17", 20, "2026-10-17T08:01:00.000Z");
    setHabitValue(laptop, "water", "2026-10-16", 1, "2026-10-17T08:02:00.000Z");
    const merged = lwwUnion(phone.habitLogs!, laptop.habitLogs!);
    expect(merged.map((l) => l.id)).toEqual([
      "hl_read_2026-10-17", "hl_water_2026-10-15", "hl_water_2026-10-16", "hl_water_2026-10-17",
    ]);
  });
  it("the same habit and day collapse to one entry, latest edit wins", () => {
    const phone = mkState([], []);
    const laptop = mkState([], []);
    addToHabit(phone, "water", "2026-10-17", 3, "2026-10-17T08:00:00.000Z");
    addToHabit(laptop, "water", "2026-10-17", 5, "2026-10-17T09:00:00.000Z");
    const merged = lwwUnion(phone.habitLogs!, laptop.habitLogs!);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.value).toBe(5);
  });
  it("a cleared day beats the older value on the other device", () => {
    const phone = mkState([], [mkLog("water", "2026-10-17", 1, { updatedAt: T1 })]);
    const laptop = mkState([], [mkLog("water", "2026-10-17", 1, { updatedAt: T1 })]);
    clearHabitDay(laptop, "water", "2026-10-17", T2);
    expect(lwwUnion(phone.habitLogs!, laptop.habitLogs!)[0]!.value).toBe(0);
  });
});

describe("dayCompletion", () => {
  it("check: done at value ≥ 1", () => {
    const h = mkHabit();
    expect(dayCompletion(h, mkLog("h1", "2026-10-17", 1))).toBe(1);
    expect(dayCompletion(h, mkLog("h1", "2026-10-17", 0))).toBe(0);
    expect(dayCompletion(h, undefined)).toBe(0);
  });
  it("count / timer: partial credit, capped at 1", () => {
    const h = mkHabit({ type: "count", target: 8 });
    expect(dayCompletion(h, mkLog("h1", "2026-10-17", 4))).toBe(0.5);
    expect(dayCompletion(h, mkLog("h1", "2026-10-17", 12))).toBe(1);
    expect(dayCompletion(mkHabit({ type: "timer", target: 20 }), mkLog("h1", "2026-10-17", 5))).toBe(0.25);
  });
  it("limit: at or under the target passes, a missing entry passes, over fails", () => {
    const h = mkHabit({ type: "limit", target: 2 });
    expect(dayCompletion(h, undefined)).toBe(1);
    expect(dayCompletion(h, mkLog("h1", "2026-10-17", 2))).toBe(1);
    expect(dayCompletion(h, mkLog("h1", "2026-10-17", 3))).toBe(0);
    expect(dayCompletion(mkHabit({ type: "limit", target: 0 }), mkLog("h1", "2026-10-17", 0))).toBe(1);
  });
  it("a skipped day earns nothing", () => {
    expect(dayCompletion(mkHabit(), mkLog("h1", "2026-10-17", 1, { skipped: true }))).toBe(0);
  });
});

describe("isDaySuccess", () => {
  const today = "2026-10-17";
  it("future days and skipped days are never a success", () => {
    expect(isDaySuccess(mkHabit(), mkLog("h1", "2026-10-18"), "2026-10-18", today)).toBe(false);
    expect(isDaySuccess(mkHabit(), mkLog("h1", "2026-10-16", 1, { skipped: true }), "2026-10-16", today)).toBe(false);
  });
  it("check / count need full completion, today included", () => {
    expect(isDaySuccess(mkHabit(), mkLog("h1", today), today, today)).toBe(true);
    const c = mkHabit({ type: "count", target: 8 });
    expect(isDaySuccess(c, mkLog("h1", "2026-10-16", 7), "2026-10-16", today)).toBe(false);
    expect(isDaySuccess(c, mkLog("h1", "2026-10-16", 8), "2026-10-16", today)).toBe(true);
  });
  it("review focus 4: a limit with no entries passes past days and is pending today", () => {
    const h = mkHabit({ type: "limit", target: 2 });
    expect(isDaySuccess(h, undefined, "2026-10-16", today)).toBe(true);
    expect(isDaySuccess(h, undefined, today, today)).toBe(false);
    expect(isDaySuccess(h, mkLog("h1", "2026-10-16", 3), "2026-10-16", today)).toBe(false);
  });
});
