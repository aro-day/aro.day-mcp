// The note tools' state changes (note-ops.ts), on fixture states — every
// read and write goes through TodoState.notes, never task.noteList.
// Run: bun test
import { describe, expect, test } from "bun:test";
import type { TodoState } from "./state.js";
import { hoistTaskNotes } from "./notes.js";
import {
  createNoteFromTemplateOp, createNoteOp, deleteNoteOp, getNoteOp, listNotesOp, listTemplatesOp, setNoteOp, taskWithNotes,
} from "./note-ops.js";

const T0 = "2026-01-01T00:00:00.000Z";

function state(): TodoState {
  return {
    schemaVersion: 44,
    tasks: [{ id: "t1", title: "Draft intro", groupId: "g1", status: "queued", updatedAt: T0 }],
    groups: [{ id: "g1", name: "Thesis" }],
    sessions: [], trash: [], people: [], tombstones: [], externalEvents: [], settings: {},
    notes: [], meta: { lastModifiedBy: "seed", lastModifiedAt: T0 },
  };
}

describe("createNoteOp (create_note / append_note / create_task notes)", () => {
  test("task note lands in notes[] with a task home, AI source, and never in task.noteList", () => {
    const s = state();
    const n = createNoteOp(s, { taskId: "t1", text: "ran the build", title: "CI" });
    expect(s.notes).toEqual([n]);
    expect(n).toMatchObject({ home: { kind: "task", id: "t1" }, source: "ai", title: "CI", html: "<p>ran the build</p>" });
    expect(s.tasks[0]!.noteList).toBeUndefined();
    expect(s.tasks[0]!.updatedAt).toBe(T0);
  });
  test("project and loose homes", () => {
    const s = state();
    expect(createNoteOp(s, { projectId: "g1", text: "x" }).home).toEqual({ kind: "project", id: "g1" });
    expect(createNoteOp(s, { text: "y", tags: ["idea"] })).toMatchObject({ home: null, tags: ["idea"] });
  });
  test("a home that does not exist is an error and writes nothing", () => {
    const s = state();
    expect(() => createNoteOp(s, { taskId: "nope", text: "x" })).toThrow(/No task/);
    expect(s.notes).toEqual([]);
  });
});

describe("createNoteFromTemplateOp", () => {
  const now = new Date(2026, 9, 17, 9, 30);
  test("fills the title from the home and records templateId", () => {
    const s = state();
    const n = createNoteFromTemplateOp(s, { templateId: "brief", projectId: "g1" }, now);
    expect(n).toMatchObject({ title: "Thesis brief", templateId: "brief", home: { kind: "project", id: "g1" }, source: "ai" });
    expect(n.html.startsWith("<h2>Goal</h2>")).toBe(true);
  });
  test("loose by default; title override wins", () => {
    const n = createNoteFromTemplateOp(state(), { templateId: "meeting", title: "Kickoff" }, now);
    expect(n.home).toBeNull();
    expect(n.title).toBe("Kickoff");
  });
  test("unknown template lists the available ids", () => {
    expect(() => createNoteFromTemplateOp(state(), { templateId: "nope" })).toThrow(/Available: blank, meeting/);
  });
});

describe("reads", () => {
  test("taskWithNotes inlines live task notes and drops the legacy noteList", () => {
    const s = state();
    s.tasks[0]!.noteList = [{ id: "old", html: "<p>legacy</p>", createdAt: T0, updatedAt: T0 }];
    hoistTaskNotes(s); // what store.getState() does on every load
    const live = createNoteOp(s, { taskId: "t1", text: "new" });
    const gone = createNoteOp(s, { taskId: "t1", text: "bye" });
    deleteNoteOp(s, gone.id);
    const view = taskWithNotes(s, s.tasks[0]!);
    expect(view.notes.map((n) => n.id)).toEqual(["old", live.id]);
    expect("noteList" in view).toBe(false);
  });

  test("listNotesOp filters by home / loose / query, pinned first then newest", () => {
    const s = state();
    const a = createNoteOp(s, { taskId: "t1", text: "alpha" });
    const b = createNoteOp(s, { projectId: "g1", text: "beta plan" });
    const c = createNoteOp(s, { text: "gamma plan" });
    a.updatedAt = "2026-03-01T00:00:00.000Z";
    b.updatedAt = "2026-02-01T00:00:00.000Z";
    c.updatedAt = "2026-04-01T00:00:00.000Z";
    b.pinned = true;
    expect(listNotesOp(s, {}).map((n) => n.id)).toEqual([b.id, c.id, a.id]);
    expect(listNotesOp(s, { taskId: "t1" }).map((n) => n.id)).toEqual([a.id]);
    expect(listNotesOp(s, { projectId: "g1" }).map((n) => n.id)).toEqual([b.id]);
    expect(listNotesOp(s, { loose: true }).map((n) => n.id)).toEqual([c.id]);
    expect(listNotesOp(s, { query: "PLAN" }).map((n) => n.id)).toEqual([b.id, c.id]);
    expect(listNotesOp(s, { limit: 1 })).toHaveLength(1);
    expect(listNotesOp(s, { taskId: "t1" })[0]).toMatchObject({ preview: "alpha", home: { kind: "task", id: "t1" } });
  });

  test("getNoteOp returns the full note; deleted notes are not readable", () => {
    const s = state();
    const n = createNoteOp(s, { text: "x" });
    expect(getNoteOp(s, n.id)).toBe(n);
    deleteNoteOp(s, n.id);
    expect(() => getNoteOp(s, n.id)).toThrow(/deleted/);
  });

  test("listTemplatesOp lists built-ins with their section headings", () => {
    const meeting = listTemplatesOp(state()).find((t) => t.id === "meeting")!;
    expect(meeting.sections).toEqual(["Attendees", "Agenda", "Notes", "Action items"]);
    expect(meeting.builtin).toBe(true);
  });
});

describe("setNoteOp / deleteNoteOp (edit + delete by id, any home)", () => {
  test("edits text, title, tags, pinned on a project note and bumps updatedAt", () => {
    const s = state();
    const n = createNoteOp(s, { projectId: "g1", text: "x" });
    n.updatedAt = T0;
    setNoteOp(s, { noteId: n.id, text: "- a\n- b", title: null, tags: ["t"], pinned: true });
    expect(n).toMatchObject({ html: "<ul><li>a</li><li>b</li></ul>", title: null, tags: ["t"], pinned: true });
    expect(n.updatedAt > T0).toBe(true);
  });
  test("requires at least one field", () => {
    const s = state();
    const n = createNoteOp(s, { text: "x" });
    expect(() => setNoteOp(s, { noteId: n.id })).toThrow(/Nothing to change/);
  });
  test("delete is a soft delete that bumps updatedAt", () => {
    const s = state();
    const n = createNoteOp(s, { taskId: "t1", text: "x" });
    n.updatedAt = T0;
    deleteNoteOp(s, n.id);
    expect(s.notes).toHaveLength(1);
    expect(n.deletedAt).toBe(n.updatedAt);
    expect(n.updatedAt > T0).toBe(true);
  });
});
