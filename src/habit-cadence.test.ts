// MIRROR of the app's src/lib/habit-cadence.test.ts (todo repo).
import { describe, expect, it } from "bun:test";
import { addDays, isActiveOn, isDueOn, periodProgress, periodRange, weekStartOf } from "./habit-cadence.js";
import { mkHabit, mkLog, mkState } from "./habit-test-fixtures.js";

describe("addDays", () => {
  it("crosses month, year and DST boundaries on local dates", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // EU DST weekend
  });
});

describe("isActiveOn", () => {
  it("starts on startDate", () => {
    const h = mkHabit({ startDate: "2026-10-05" });
    expect(isActiveOn(h, "2026-10-04")).toBe(false);
    expect(isActiveOn(h, "2026-10-05")).toBe(true);
  });
  it("is off inside the pause window [pausedFrom, pausedUntil) only", () => {
    const h = mkHabit({ pausedFrom: "2026-10-10", pausedUntil: "2026-10-15" });
    expect(isActiveOn(h, "2026-10-09")).toBe(true);
    expect(isActiveOn(h, "2026-10-10")).toBe(false);
    expect(isActiveOn(h, "2026-10-14")).toBe(false);
    expect(isActiveOn(h, "2026-10-15")).toBe(true);
  });
  it("ignores a half-set pause", () => {
    expect(isActiveOn(mkHabit({ pausedUntil: "2026-11-01" }), "2026-10-17")).toBe(true);
  });
  it("stays active on the archive day and stops after it", () => {
    const archivedAt = new Date(2026, 9, 12, 10, 0).toISOString();
    const h = mkHabit({ archivedAt });
    expect(isActiveOn(h, "2026-10-12")).toBe(true);
    expect(isActiveOn(h, "2026-10-13")).toBe(false);
  });
});

describe("isDueOn", () => {
  it("daily is due every active day", () => {
    expect(isDueOn(mkHabit(), "2026-10-17")).toBe(true);
    expect(isDueOn(mkHabit({ startDate: "2026-10-18" }), "2026-10-17")).toBe(false);
  });
  it("days uses ISO weekdays", () => {
    const h = mkHabit({ cadence: { kind: "days", weekdays: [1, 3, 5] } });
    expect(isDueOn(h, "2026-10-12")).toBe(true);  // Mon
    expect(isDueOn(h, "2026-10-13")).toBe(false); // Tue
    expect(isDueOn(h, "2026-10-16")).toBe(true);  // Fri
    expect(isDueOn(mkHabit({ cadence: { kind: "days", weekdays: [7] } }), "2026-10-18")).toBe(true); // Sun
  });
  it("everyN is anchored on startDate", () => {
    const h = mkHabit({ startDate: "2026-10-01", cadence: { kind: "everyN", days: 3 } });
    expect(isDueOn(h, "2026-10-01")).toBe(true);
    expect(isDueOn(h, "2026-10-02")).toBe(false);
    expect(isDueOn(h, "2026-10-04")).toBe(true);
    expect(isDueOn(h, "2026-11-03")).toBe(true); // 33 days later, across a month
    expect(isDueOn(h, "2026-09-28")).toBe(false);
  });
  it("perWeek / perMonth can be done on any active day", () => {
    expect(isDueOn(mkHabit({ cadence: { kind: "perWeek", times: 3 } }), "2026-10-13")).toBe(true);
    expect(isDueOn(mkHabit({ cadence: { kind: "perMonth", times: 4 } }), "2026-10-13")).toBe(true);
  });
  it("is never due while paused", () => {
    const h = mkHabit({ pausedFrom: "2026-10-10", pausedUntil: "2026-10-20" });
    expect(isDueOn(h, "2026-10-17")).toBe(false);
  });
});

describe("periodRange", () => {
  const wk = mkHabit({ cadence: { kind: "perWeek", times: 3 } });
  it("follows the week start", () => {
    expect(periodRange(wk, "2026-10-17")).toEqual({ start: "2026-10-12", end: "2026-10-18" });    // Mon default
    expect(periodRange(wk, "2026-10-17", 0)).toEqual({ start: "2026-10-11", end: "2026-10-17" }); // Sun
    expect(periodRange(wk, "2026-10-17", 6)).toEqual({ start: "2026-10-17", end: "2026-10-23" }); // Sat
  });
  it("months are calendar months, leap years included", () => {
    const mo = mkHabit({ cadence: { kind: "perMonth", times: 4 } });
    expect(periodRange(mo, "2028-02-15")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
  it("is null for day-based cadences", () => {
    expect(periodRange(mkHabit(), "2026-10-17")).toBeNull();
    expect(periodRange(mkHabit({ cadence: { kind: "everyN", days: 2 } }), "2026-10-17")).toBeNull();
  });
});

describe("periodProgress", () => {
  it("counts successful days in the period up to the date", () => {
    const h = mkHabit({ cadence: { kind: "perWeek", times: 3 } });
    const logs = [
      mkLog("h1", "2026-10-12"),
      mkLog("h1", "2026-10-14"),
      mkLog("h1", "2026-10-15", 0, { skipped: true }),
      mkLog("h1", "2026-10-16", 0),         // cleared day
      mkLog("h1", "2026-10-10"),            // last week
    ];
    expect(periodProgress(h, logs, "2026-10-17")).toEqual({ done: 2, target: 3 });
    expect(periodProgress(h, logs, "2026-10-13")).toEqual({ done: 1, target: 3 });
  });
  it("a count day only counts once it reaches the goal", () => {
    const h = mkHabit({ type: "count", target: 8, cadence: { kind: "perWeek", times: 2 } });
    const logs = [mkLog("h1", "2026-10-12", 5), mkLog("h1", "2026-10-13", 8)];
    expect(periodProgress(h, logs, "2026-10-17")).toEqual({ done: 1, target: 2 });
  });
  it("ignores other habits' logs", () => {
    const h = mkHabit({ cadence: { kind: "perWeek", times: 3 } });
    expect(periodProgress(h, [mkLog("h2", "2026-10-12")], "2026-10-17")).toEqual({ done: 0, target: 3 });
  });
  it("day-based cadences report the day itself", () => {
    expect(periodProgress(mkHabit(), [mkLog("h1", "2026-10-17")], "2026-10-17")).toEqual({ done: 1, target: 1 });
    expect(periodProgress(mkHabit(), [], "2026-10-17")).toEqual({ done: 0, target: 1 });
  });
});

describe("weekStartOf", () => {
  it("reads settings.calendar.weekStartsOn, Monday by default", () => {
    expect(weekStartOf(mkState([], []))).toBe(1);
    expect(weekStartOf(mkState([], [], 0))).toBe(0);
    expect(weekStartOf(mkState([], [], 9))).toBe(1);
  });
});
