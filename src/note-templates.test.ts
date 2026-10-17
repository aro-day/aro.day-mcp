// Note templates (note-templates.ts) — the copy of the app's built-ins and
// its {{var}} filling. Run: bun test
import { describe, expect, test } from "bun:test";
import type { TodoState } from "./state.js";
import {
  BUILTIN_TEMPLATE_IDS, allTemplates, fillContextFor, fillTemplate, instantiateTemplate, isoWeek, templateById,
} from "./note-templates.js";

const T0 = "2026-01-01T00:00:00.000Z";
const NOW = new Date(2026, 9, 17, 9, 30); // Sat 17 Oct 2026, local time

function state(over: Partial<TodoState> = {}): TodoState {
  return {
    schemaVersion: 44, tasks: [], groups: [], sessions: [], trash: [], people: [], tombstones: [],
    externalEvents: [], settings: {}, meta: { lastModifiedBy: "seed", lastModifiedAt: T0 }, ...over,
  };
}

describe("built-in templates", () => {
  test("same ids, same order as the app (src/data/note-templates.ts)", () => {
    expect(BUILTIN_TEMPLATE_IDS).toEqual(["blank", "meeting", "decision", "brief", "daily", "weekly", "retro", "research"]);
  });

  test("meeting renders the app's h2 / p / bullet / checklist shapes", () => {
    expect(templateById(state(), "meeting")!.html).toBe(
      "<h2>Attendees</h2><p></p><h2>Agenda</h2><ul><li><p></p></li></ul><h2>Notes</h2><p></p>" +
      "<h2>Action items</h2><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p></p></li></ul>",
    );
  });

  test("weekly's top-3 checklist has three rows", () => {
    expect(templateById(state(), "weekly")!.html.match(/data-type="taskItem"/g)).toHaveLength(3);
  });

  test("blank is empty and untitled", () => {
    const blank = templateById(state(), "blank")!;
    expect(instantiateTemplate(blank, { now: NOW, locale: "en" })).toEqual({ title: null, html: "" });
  });

  test("user templates follow the built-ins and resolve by id", () => {
    const s = state({
      noteTemplates: [{
        id: "tpl_1", name: "Standup", glyph: "◈", titlePattern: "{{task}} standup", html: "<h2>Yesterday</h2>",
        defaultHome: "context", createdAt: T0, updatedAt: T0,
      }],
    });
    expect(allTemplates(s).map((t) => t.id).at(-1)).toBe("tpl_1");
    expect(templateById(s, "tpl_1")!.builtin).toBe(false);
    expect(templateById(s, "nope")).toBeNull();
  });
});

describe("fillTemplate", () => {
  const ctx = { now: NOW, locale: "en", project: "Thesis", task: "Draft intro" };
  test("fills date, weekday, week, project, task; drops cursor", () => {
    expect(fillTemplate("{{date}}", ctx)).toBe("Oct 17, 2026");
    expect(fillTemplate("{{weekday}}", ctx)).toBe("Saturday");
    expect(fillTemplate("Week {{week}}", ctx)).toBe(`Week ${isoWeek(NOW)}`);
    expect(fillTemplate("{{project}} / {{task}}", ctx)).toBe("Thesis / Draft intro");
    expect(fillTemplate("Research: {{cursor}}", ctx)).toBe("Research:");
  });
  test("unknown variables stay literal", () => {
    expect(fillTemplate("{{nope}} x", ctx)).toBe("{{nope}} x");
  });
  test("isoWeek: 1 Jan 2026 (a Thursday) is week 1; 28 Dec 2026 is week 53", () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2026, 11, 28))).toBe(53);
  });
});

describe("instantiateTemplate + fillContextFor", () => {
  const s = state({
    groups: [{ id: "g1", name: "Thesis" }],
    tasks: [{ id: "t1", title: "Draft intro", groupId: "g1", status: "queued" }],
  });
  const brief = templateById(s, "brief")!;
  test("a task home supplies both the task and its project name", () => {
    expect(fillContextFor(s, { kind: "task", id: "t1" }, NOW)).toMatchObject({ project: "Thesis", task: "Draft intro" });
  });
  test("{{project}} title with a project home", () => {
    expect(instantiateTemplate(brief, fillContextFor(s, { kind: "project", id: "g1" }, NOW)).title).toBe("Thesis brief");
  });
  test("{{project}} title with no project falls back to the template name", () => {
    expect(instantiateTemplate(brief, fillContextFor(s, null, NOW)).title).toBe("Project brief");
  });
});
