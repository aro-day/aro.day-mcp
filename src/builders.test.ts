// Contract test: connector-created entities must carry every field the app
// marks REQUIRED. The app's migration is version-gated and the connector
// echoes the version it read (see drive.ts + the builders' comment in
// state.ts), so a missing required field is NEVER healed by the app — it
// ships as a malformed entity. This test pins the lockstep with the app's
// canonical schema (todo repo → src/types/window-state.d.ts). When the app
// promotes a field to required, add it to the matching list below; the test
// then fails until the corresponding builder sets it. Run: bun test
import { describe, expect, test } from "bun:test";
import { buildTask, buildGroup, buildNote } from "./state.js";

// Mirror of the non-optional fields in window-state.d.ts (interface Task /
// Group / TaskNote). Keep in lockstep with that file.
const REQUIRED_TASK = ["id", "title", "status", "groupId", "order"] as const;
const REQUIRED_GROUP = ["id", "name", "order", "collapsed"] as const;
const REQUIRED_NOTE = ["id", "html", "createdAt", "updatedAt"] as const;

function present(obj: Record<string, unknown>, key: string): boolean {
  return key in obj && obj[key] !== undefined && obj[key] !== null;
}

describe("buildTask", () => {
  const t = buildTask({ title: "Write the spec", groupId: "grp_1", order: 0 }) as unknown as Record<string, unknown>;

  for (const key of REQUIRED_TASK) {
    test(`sets required field "${key}"`, () => {
      expect(present(t, key)).toBe(true);
    });
  }

  test("status is a valid enum value", () => {
    expect(["queued", "in-progress", "done"]).toContain(t.status);
  });
  test("order is a number", () => {
    expect(typeof t.order).toBe("number");
  });
  test("priority defaults to 2 (medium)", () => {
    expect(t.priority).toBe(2);
  });
  test("tags defaults to an array (never undefined — app maps over it)", () => {
    expect(Array.isArray(t.tags)).toBe(true);
  });
  test("updatedAt (LWW key) is stamped", () => {
    expect(typeof t.updatedAt).toBe("string");
    expect(Number.isFinite(new Date(t.updatedAt as string).getTime())).toBe(true);
  });
  test("passes through optional inputs", () => {
    const t2 = buildTask({
      title: "x", groupId: "grp_1", order: 3, priority: 1,
      dueAt: "2026-06-01T00:00:00.000Z", scheduledAt: "2026-06-01T09:00:00.000Z",
      estimationMinutes: 45, tags: ["work"],
    }) as unknown as Record<string, unknown>;
    expect(t2.priority).toBe(1);
    expect(t2.dueAt).toBe("2026-06-01T00:00:00.000Z");
    expect(t2.scheduledAt).toBe("2026-06-01T09:00:00.000Z");
    expect(t2.estimationMinutes).toBe(45);
    expect(t2.tags).toEqual(["work"]);
    expect(t2.order).toBe(3);
  });
});

describe("buildGroup", () => {
  const g = buildGroup({ name: "Inbox", order: 0 }) as unknown as Record<string, unknown>;

  for (const key of REQUIRED_GROUP) {
    test(`sets required field "${key}"`, () => {
      expect(present(g, key)).toBe(true);
    });
  }

  test("collapsed defaults to false (boolean, not undefined)", () => {
    expect(g.collapsed).toBe(false);
  });
  test("updatedAt (LWW key) is stamped", () => {
    expect(typeof g.updatedAt).toBe("string");
  });
});

describe("buildNote", () => {
  const n = buildNote({ text: "ran the build" }) as unknown as Record<string, unknown>;

  for (const key of REQUIRED_NOTE) {
    test(`sets required field "${key}"`, () => {
      expect(present(n, key)).toBe(true);
    });
  }

  test("escapes HTML in the note text", () => {
    const evil = buildNote({ text: "<script>alert(1)</script>" }) as unknown as Record<string, unknown>;
    expect(evil.html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
  test("source defaults to ai (connector provenance)", () => {
    expect(n.source).toBe("ai");
  });
  test("createdAt and updatedAt share the same stamp", () => {
    expect(n.createdAt).toBe(n.updatedAt);
  });
});
