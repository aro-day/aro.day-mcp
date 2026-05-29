// Unit tests for the deterministic session→task matcher.
// Run: bun test src/session-match.test.ts

import { describe, expect, test } from "bun:test";
import { rankTasksForSession } from "./session-match.js";
import type { Task } from "./state.js";

function task(over: Partial<Task> & { id: string; title: string }): Task {
  return {
    groupId: "g1", status: "queued", priority: 2, order: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Task;
}

describe("rankTasksForSession", () => {
  test("ranks the lexically-closest task first", () => {
    const tasks = [
      task({ id: "t1", title: "Refactor the billing webhook handler" }),
      task({ id: "t2", title: "Write onboarding docs" }),
      task({ id: "t3", title: "Investigate webhook retry storms" }),
    ];
    const r = rankTasksForSession(tasks, { hint: "fix the webhook retry bug" });
    expect(r[0]!.id).toBe("t3"); // matches "webhook" + "retry" (2)
    expect(r[0]!.score).toBeGreaterThanOrEqual(2);
    expect(r.map((x) => x.id)).toContain("t1"); // matches "webhook" (1)
    expect(r.map((x) => x.id)).not.toContain("t2"); // no overlap
  });

  test("matches on the repo basename, not the owner", () => {
    const tasks = [task({ id: "t1", title: "Polish the todo app card layout" })];
    const r = rankTasksForSession(tasks, { repo: "MotazAbuElnasr/todo.sh" });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("t1"); // "todo" overlaps
  });

  test("matches on tags too", () => {
    const tasks = [task({ id: "t1", title: "Quarterly review", tags: ["payments", "dodo"] })];
    const r = rankTasksForSession(tasks, { hint: "payments reconciliation" });
    expect(r[0]?.id).toBe("t1");
  });

  test("skips done and archived tasks", () => {
    const tasks = [
      task({ id: "t1", title: "webhook fix", status: "done" }),
      task({ id: "t2", title: "webhook fix", archived: true }),
      task({ id: "t3", title: "webhook fix" }),
    ];
    const r = rankTasksForSession(tasks, { hint: "webhook" });
    expect(r.map((x) => x.id)).toEqual(["t3"]);
  });

  test("returns nothing when the query has no usable tokens", () => {
    const tasks = [task({ id: "t1", title: "Anything" })];
    expect(rankTasksForSession(tasks, { branch: "main" })).toEqual([]); // stopword-only
    expect(rankTasksForSession(tasks, {})).toEqual([]);
  });

  test("honours the limit", () => {
    const tasks = Array.from({ length: 8 }, (_, i) => task({ id: `t${i}`, title: "webhook task" }));
    expect(rankTasksForSession(tasks, { hint: "webhook" }, 3)).toHaveLength(3);
  });
});
