// Pure-helper tests (no network, no SDK). Run: bun test
import { describe, expect, test } from "bun:test";
import { newId, nowIso, stampUpdated, stampMeta, defaultProjectId, type TodoState, type Group } from "./state.js";

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

  test("falls back to the first group when every group is a habit group", () => {
    expect(defaultProjectId({ groups: [g("h1", "habit"), g("h2", "habit")] })).toBe("h1");
  });

  test("undefined when there are no groups", () => {
    expect(defaultProjectId({ groups: [] })).toBeUndefined();
  });
});
