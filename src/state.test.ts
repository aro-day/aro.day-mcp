// Pure-helper tests (no network, no SDK). Run: bun test
import { describe, expect, test } from "bun:test";
import { newId, nowIso, stampUpdated, stampMeta, defaultProjectId, isHabitGroup, visibleTasks, type TodoState, type Group } from "./state.js";

describe("state helpers", () => {
  test("newId carries the prefix and is reasonably unique", () => {
    const a = newId("t");
    const b = newId("t");
    expect(a.startsWith("t_")).toBe(true);
    expect(a).not.toBe(b);
  });

  test("nowIso is a valid ISO timestamp", () => {
    expect(Number.isFinite(new Date(nowIso()).getTime())).toBe(true);
  });

  test("stampUpdated sets updatedAt to an ISO string and returns the entity", () => {
    const e: { id: string; updatedAt?: string } = { id: "x" };
    const r = stampUpdated(e);
    expect(r).toBe(e);
    expect(typeof e.updatedAt).toBe("string");
    expect(Number.isFinite(new Date(e.updatedAt!).getTime())).toBe(true);
  });

  test("stampMeta updates lastModifiedBy + lastModifiedAt", () => {
    const s = { meta: { lastModifiedBy: "seed", lastModifiedAt: "2020-01-01T00:00:00.000Z" } } as unknown as TodoState;
    stampMeta(s);
    expect(s.meta.lastModifiedBy).toBe("aroday-mcp");
    expect(s.meta.lastModifiedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("defaultProjectId", () => {
  const g = (id: string, kind?: "habit" | null): Group => ({ id, name: id, kind });

  test("skips a leading habit group and returns the first non-habit project", () => {
    // The Habits project is order 0 in the real app, so groups[0] would
    // trap a plain task in the locked Habits project. Default past it.
    expect(defaultProjectId({ groups: [g("grp_habits", "habit"), g("grp_inbox"), g("grp_work")] })).toBe("grp_inbox");
  });

  test("returns the first group when none are habits", () => {
    expect(defaultProjectId({ groups: [g("grp_inbox"), g("grp_work")] })).toBe("grp_inbox");
  });

  test("treats kind null/undefined as non-habit", () => {
    expect(defaultProjectId({ groups: [g("a", null), g("b")] })).toBe("a");
  });

  test("never picks a habit group, even when every group is one", () => {
    // Since app v45 a task in the Habits project is an old-shape habit row
    // the app deletes (v46), so there is no valid default here.
    expect(defaultProjectId({ groups: [g("h1", "habit"), g("h2", "habit")] })).toBeUndefined();
  });

  test("skips grp_habits by id even when its kind is missing", () => {
    expect(defaultProjectId({ groups: [g("grp_habits"), g("grp_inbox")] })).toBe("grp_inbox");
  });

  test("undefined when there are no groups", () => {
    expect(defaultProjectId({ groups: [] })).toBeUndefined();
  });
});

describe("isHabitGroup", () => {
  test("matches the Habits project by id or by kind", () => {
    expect(isHabitGroup({ id: "grp_habits" })).toBe(true);
    expect(isHabitGroup({ id: "g1", kind: "habit" })).toBe(true);
    expect(isHabitGroup({ id: "g1", kind: null })).toBe(false);
    expect(isHabitGroup(undefined)).toBe(false);
  });
});

describe("visibleTasks", () => {
  test("drops archived tasks and old habit card rows in the Habits project", () => {
    const groups = [{ id: "grp_habits", name: "Habits", kind: "habit" as const }, { id: "g1", name: "Work" }];
    const tasks = [
      { id: "t1", title: "a", groupId: "g1", status: "queued" as const },
      { id: "t2", title: "b", groupId: "g1", status: "queued" as const, archived: true },
      { id: "t3", title: "Read", groupId: "grp_habits", status: "queued" as const },
    ];
    expect(visibleTasks({ tasks, groups }).map((t) => t.id)).toEqual(["t1"]);
  });
});
