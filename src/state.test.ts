// Pure-helper tests (no network, no SDK). Run: bun test
import { describe, expect, test } from "bun:test";
import { newId, nowIso, stampUpdated, stampMeta, type TodoState } from "./state.js";

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
