// MIRROR of the currentStreak and todayProgress cases in the app's
// src/lib/habit-metrics.test.ts (todo repo) — the two metrics the connector ports.
import { describe, expect, it } from "bun:test";
import { currentStreak, todayProgress } from "./habit-metrics.js";
import { daysBetween, doneOn, mkHabit, mkLog, mkState } from "./habit-test-fixtures.js";

const TODAY = "2026-10-17"; // Saturday
const daily = mkHabit();
const without = (dates: string[], drop: string[]) => dates.filter((d) => !drop.includes(d));

describe("currentStreak — day cadences", () => {
  it("counts consecutive done days; today pending never breaks it", () => {
    const logs = doneOn("h1", daysBetween("2026-10-10", "2026-10-16"));
    expect(currentStreak(daily, logs, TODAY)).toEqual({ count: 7, unit: "day" });
    expect(currentStreak(daily, [...logs, mkLog("h1", TODAY)], TODAY)).toEqual({ count: 8, unit: "day" });
  });
  it("a missed past day breaks it", () => {
    const logs = doneOn("h1", without(daysBetween("2026-10-10", "2026-10-16"), ["2026-10-13"]));
    expect(currentStreak(daily, logs, TODAY).count).toBe(3);
  });
  it("review focus 5: a skipped day neither counts nor breaks", () => {
    const logs = [
      ...doneOn("h1", without(daysBetween("2026-10-10", "2026-10-16"), ["2026-10-13"])),
      mkLog("h1", "2026-10-13", 0, { skipped: true }),
    ];
    expect(currentStreak(daily, logs, TODAY).count).toBe(6);
  });
  it("review focus 5: a paused range neither counts nor breaks", () => {
    const h = mkHabit({ pausedFrom: "2026-10-12", pausedUntil: "2026-10-15" });
    const logs = doneOn("h1", ["2026-10-10", "2026-10-11", "2026-10-15", "2026-10-16"]);
    expect(currentStreak(h, logs, TODAY).count).toBe(4);
  });
  it("days done before a pause still count while paused", () => {
    const h = mkHabit({ pausedFrom: TODAY, pausedUntil: "2026-11-01" });
    expect(currentStreak(h, doneOn("h1", daysBetween("2026-10-01", "2026-10-16")), TODAY).count).toBe(16);
  });
  it("some days: only scheduled days count, rest days never break", () => {
    const h = mkHabit({ cadence: { kind: "days", weekdays: [1, 3, 5] } });
    const mwf = ["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-16"];
    expect(currentStreak(h, doneOn("h1", mwf), TODAY)).toEqual({ count: 6, unit: "day" });
    expect(currentStreak(h, doneOn("h1", without(mwf, ["2026-10-14"])), TODAY).count).toBe(1);
  });
  it("every N days counts due days", () => {
    const h = mkHabit({ startDate: "2026-10-01", cadence: { kind: "everyN", days: 2 } });
    const odd = daysBetween("2026-10-01", "2026-10-15").filter((d) => Number(d.slice(8)) % 2 === 1);
    expect(currentStreak(h, doneOn("h1", odd), TODAY).count).toBe(8);
  });
  it("stops at the start date", () => {
    const h = mkHabit({ startDate: "2026-10-14" });
    expect(currentStreak(h, doneOn("h1", daysBetween("2026-10-01", "2026-10-16")), TODAY).count).toBe(3);
  });
  it("count habits need the full goal", () => {
    const h = mkHabit({ type: "count", target: 8 });
    const logs = [mkLog("h1", "2026-10-14", 8), mkLog("h1", "2026-10-15", 9), mkLog("h1", "2026-10-16", 7)];
    expect(currentStreak(h, logs, TODAY).count).toBe(0);
    expect(currentStreak(h, logs.slice(0, 2), "2026-10-16").count).toBe(2);
  });
  it("review focus 4: a limit with no entries passes past days, today pending", () => {
    const h = mkHabit({ type: "limit", target: 2, startDate: "2026-10-10" });
    expect(currentStreak(h, [], TODAY).count).toBe(7);
    expect(currentStreak(h, [mkLog("h1", "2026-10-14", 3)], TODAY).count).toBe(2);
    expect(currentStreak(h, [mkLog("h1", TODAY, 5)], TODAY).count).toBe(7); // today over: still pending
  });
});

describe("currentStreak — period cadences", () => {
  const wk = mkHabit({ cadence: { kind: "perWeek", times: 3 } });
  // Weeks (Mon start): Sep 21-27, Sep 28-Oct 4, Oct 5-11, Oct 12-18 (current)
  const twoGoodWeeks = doneOn("h1", ["2026-09-28", "2026-09-30", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-11"]);

  it("review focus 3: counts weeks that hit the target; rest days never break", () => {
    expect(currentStreak(wk, [...twoGoodWeeks, mkLog("h1", "2026-10-13")], TODAY)).toEqual({ count: 2, unit: "week" });
  });
  it("the current week counts once it hits the target", () => {
    const logs = [...twoGoodWeeks, ...doneOn("h1", ["2026-10-12", "2026-10-13", "2026-10-15"])];
    expect(currentStreak(wk, logs, TODAY).count).toBe(3);
  });
  it("breaks only on a missed week", () => {
    const missedBefore = [...twoGoodWeeks, ...doneOn("h1", ["2026-09-21", "2026-09-22"])];
    const h = mkHabit({ cadence: { kind: "perWeek", times: 3 }, startDate: "2026-09-14" });
    const earlier = doneOn("h1", ["2026-09-14", "2026-09-15", "2026-09-16"]);
    expect(currentStreak(h, [...missedBefore, ...earlier], TODAY).count).toBe(2);
  });
  it("a short week with a skip or pause neither counts nor breaks", () => {
    const h = mkHabit({ cadence: { kind: "perWeek", times: 3 }, startDate: "2026-09-14" });
    const logs = [
      ...doneOn("h1", ["2026-09-14", "2026-09-15", "2026-09-16"]),
      ...doneOn("h1", ["2026-09-21"]), mkLog("h1", "2026-09-22", 0, { skipped: true }),
      ...twoGoodWeeks,
    ];
    expect(currentStreak(h, logs, TODAY).count).toBe(3);
  });
  it("a partial first week does not break it", () => {
    const h = mkHabit({ cadence: { kind: "perWeek", times: 3 }, startDate: "2026-10-01" });
    const logs = doneOn("h1", ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-11"]);
    expect(currentStreak(h, logs, TODAY).count).toBe(1);
  });
  it("follows the week start", () => {
    // Sunday weeks: Oct 4-10 has 3, Oct 11-17 (current) has 1
    const logs = doneOn("h1", ["2026-10-04", "2026-10-06", "2026-10-10", "2026-10-12"]);
    expect(currentStreak(wk, logs, TODAY, 0).count).toBe(1);
    expect(currentStreak(wk, logs, TODAY, 1).count).toBe(0); // Mon weeks: Oct 5-11 has only 2
  });
  it("months for perMonth", () => {
    const h = mkHabit({ cadence: { kind: "perMonth", times: 2 }, startDate: "2026-08-01" });
    const logs = doneOn("h1", ["2026-08-03", "2026-08-20", "2026-09-01", "2026-09-30", "2026-10-02"]);
    expect(currentStreak(h, logs, TODAY)).toEqual({ count: 2, unit: "month" });
  });
});

describe("todayProgress", () => {
  it("counts today's due habits and the ones done", () => {
    const habits = [
      mkHabit({ id: "stretch" }),
      mkHabit({ id: "water", type: "count", target: 8 }),
      mkHabit({ id: "coffee", type: "limit", target: 2 }),
      mkHabit({ id: "gym", cadence: { kind: "days", weekdays: [1, 3, 5] } }),   // not due Sat
      mkHabit({ id: "run", cadence: { kind: "perWeek", times: 2 } }),
      mkHabit({ id: "old", archivedAt: "2026-10-17T08:00:00.000Z" }),
      mkHabit({ id: "trip", pausedFrom: "2026-10-15", pausedUntil: "2026-10-20" }),
      mkHabit({ id: "later", startDate: "2026-10-20" }),
      mkHabit({ id: "rest" }),
    ];
    const logs = [
      mkLog("stretch", TODAY), mkLog("water", TODAY, 5), mkLog("coffee", TODAY, 1),
      mkLog("run", "2026-10-12"), mkLog("run", "2026-10-14"),
      mkLog("rest", TODAY, 0, { skipped: true }),
    ];
    expect(todayProgress(mkState(habits, logs), TODAY)).toEqual({ done: 3, due: 4 });
  });
  it("a perWeek habit met earlier in a Sunday week is done", () => {
    const habits = [mkHabit({ id: "run", cadence: { kind: "perWeek", times: 1 } })];
    const logs = [mkLog("run", "2026-10-11")]; // Sunday
    expect(todayProgress(mkState(habits, logs, 0), TODAY)).toEqual({ done: 1, due: 1 });
    expect(todayProgress(mkState(habits, logs, 1), TODAY)).toEqual({ done: 0, due: 1 }); // Mon week starts Oct 12
    expect(todayProgress(mkState(habits, logs, 6), TODAY)).toEqual({ done: 0, due: 1 });
  });
  it("handles missing collections", () => {
    expect(todayProgress(mkState(undefined as unknown as Habit[], undefined as unknown as HabitLog[]), TODAY)).toEqual({ done: 0, due: 0 });
  });
});
