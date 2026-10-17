// Notes-collection helpers (notes.ts) — the load-time hoist that mirrors the
// app's hoistTaskNotes, and the LWW / soft-delete write rules. Run: bun test
import { describe, expect, test } from "bun:test";
import type { Note, TaskNote, TodoState } from "./state.js";
import { hoistTaskNotes, liveNotes, patchNote, requireLiveNote, resolveHome, softDeleteNote, stripHtml } from "./notes.js";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-02-01T00:00:00.000Z";

function legacy(id: string, html: string, updatedAt = T0): TaskNote {
  return { id, html, createdAt: T0, updatedAt };
}

function state(over: Partial<TodoState> = {}): TodoState {
  return {
    schemaVersion: 44, tasks: [], groups: [], sessions: [], trash: [], people: [], tombstones: [],
    externalEvents: [], settings: {}, meta: { lastModifiedBy: "seed", lastModifiedAt: T0 }, ...over,
  };
}

describe("hoistTaskNotes (pre-v44 back-compat)", () => {
  test("creates notes[] when missing and moves task.noteList into it with a task home", () => {
    const s = state({
      schemaVersion: 43,
      tasks: [{ id: "t1", title: "A", groupId: "g", status: "queued", noteList: [legacy("n1", "<p>x</p>")] }],
    });
    delete s.notes;
    expect(hoistTaskNotes(s)).toBe(true);
    expect(s.notes).toHaveLength(1);
    expect(s.notes![0]!.home).toEqual({ kind: "task", id: "t1" });
    expect(s.tasks[0]!.noteList).toEqual([]);
  });

  test("hoists notes from trashed tasks too", () => {
    const s = state({ trash: [{ id: "t9", noteList: [legacy("n9", "<p>old</p>")] }] });
    hoistTaskNotes(s);
    expect(s.notes!.map((n) => n.home)).toEqual([{ kind: "task", id: "t9" }]);
  });

  test("is idempotent and skips tombstoned ids", () => {
    const s = state({
      tombstones: [{ id: "dead" }],
      tasks: [{ id: "t1", title: "A", groupId: "g", status: "queued", noteList: [legacy("n1", "a"), legacy("dead", "b")] }],
    });
    hoistTaskNotes(s);
    expect(hoistTaskNotes(s)).toBe(false);
    expect(s.notes!.map((n) => n.id)).toEqual(["n1"]);
  });

  test("a newer legacy copy updates an existing note's body; an older one does not", () => {
    const existing: Note = { ...legacy("n1", "<p>old</p>"), home: { kind: "task", id: "t1" } };
    const s = state({
      notes: [existing],
      tasks: [{ id: "t1", title: "A", groupId: "g", status: "queued", noteList: [legacy("n1", "<p>new</p>", T1)] }],
    });
    hoistTaskNotes(s);
    expect(s.notes![0]!.html).toBe("<p>new</p>");
    s.tasks[0]!.noteList = [legacy("n1", "<p>stale</p>", T0)];
    hoistTaskNotes(s);
    expect(s.notes![0]!.html).toBe("<p>new</p>");
  });
});

describe("liveNotes", () => {
  test("drops soft-deleted notes and notes homed on a task that no longer exists", () => {
    const s = state({
      tasks: [{ id: "t1", title: "A", groupId: "g", status: "queued" }],
      notes: [
        { ...legacy("a", ""), home: { kind: "task", id: "t1" } },
        { ...legacy("b", ""), home: { kind: "task", id: "gone" } },
        { ...legacy("c", ""), home: null, deletedAt: T1 },
        { ...legacy("d", ""), home: null },
      ],
    });
    expect(liveNotes(s).map((n) => n.id)).toEqual(["a", "d"]);
  });
});

describe("resolveHome", () => {
  const s = state({
    tasks: [{ id: "t1", title: "A", groupId: "g1", status: "queued" }],
    groups: [{ id: "g1", name: "Work" }],
  });
  test("task, project, or loose", () => {
    expect(resolveHome(s, { taskId: "t1" })).toEqual({ kind: "task", id: "t1" });
    expect(resolveHome(s, { projectId: "g1" })).toEqual({ kind: "project", id: "g1" });
    expect(resolveHome(s, {})).toBeNull();
  });
  test("rejects both, and unknown ids", () => {
    expect(() => resolveHome(s, { taskId: "t1", projectId: "g1" })).toThrow(/not both/);
    expect(() => resolveHome(s, { taskId: "nope" })).toThrow(/No task/);
    expect(() => resolveHome(s, { projectId: "nope" })).toThrow(/No project/);
  });
});

describe("writes bump updatedAt (LWW) and delete is soft", () => {
  test("patchNote applies the patch and bumps updatedAt", () => {
    const s = state({ notes: [{ ...legacy("n1", "<p>a</p>"), home: null }] });
    const n = patchNote(s, "n1", { title: "T" });
    expect(n.title).toBe("T");
    expect(n.updatedAt > T0).toBe(true);
  });
  test("softDeleteNote keeps the note, sets deletedAt == updatedAt", () => {
    const s = state({ notes: [{ ...legacy("n1", "<p>a</p>"), home: null }] });
    const n = softDeleteNote(s, "n1");
    expect(s.notes).toHaveLength(1);
    expect(n.deletedAt).toBe(n.updatedAt);
    expect(() => requireLiveNote(s, "n1")).toThrow(/deleted/);
    expect(() => softDeleteNote(s, "n1")).toThrow(/deleted/);
  });
  test("unknown id errors", () => {
    expect(() => patchNote(state({ notes: [] }), "x", { title: "y" })).toThrow(/No note/);
  });
});

describe("stripHtml", () => {
  test("one line per block, entities decoded", () => {
    expect(stripHtml("<h2>Agenda</h2><ul><li><p>a &amp; b</p></li></ul>")).toBe("Agenda\na & b");
  });
});
