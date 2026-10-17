// MCP note tools — read/write the top-level notes collection (app v44+).
// Thin adapters over note-ops.ts; registered from server.ts next to
// tools.ts. get_task / create_task (tools.ts) also route notes through
// note-ops.ts so there is one write path.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getState, mutate } from "./store.js";
import {
  createNoteFromTemplateOp, createNoteOp, deleteNoteOp, getNoteOp, listNotesOp, listTemplatesOp, setNoteOp,
} from "./note-ops.js";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const json = (v: unknown) => ok(JSON.stringify(v, null, 2));

const homeArgs = {
  taskId: z.string().optional().describe("Attach the note to this task"),
  projectId: z.string().optional().describe("Attach the note to this project (not a task)"),
};

export function registerNoteTools(server: McpServer): void {
  // --- reads ---
  server.registerTool("list_notes", {
    title: "List notes",
    description:
      "List notes (title, home, a short text preview), pinned first then newest. " +
      "Filter by taskId, projectId (notes homed on the project itself), loose " +
      "(notes with no home), or a text query. Use get_note for the full body.",
    inputSchema: {
      ...homeArgs,
      loose: z.boolean().optional().describe("Only notes with no task/project home"),
      query: z.string().optional().describe("Case-insensitive substring over title and text"),
      limit: z.number().int().positive().max(500).optional(),
    },
  }, async (args) => json(listNotesOp(await getState(), args)));

  server.registerTool("get_note", {
    title: "Get note",
    description: "Get one note in full (HTML body, home, tags, template).",
    inputSchema: { noteId: z.string() },
  }, async (args) => json(getNoteOp(await getState(), args.noteId)));

  server.registerTool("list_note_templates", {
    title: "List note templates",
    description: "List the built-in note templates and the user's own templates, with their section headings.",
    inputSchema: {},
  }, async () => json(listTemplatesOp(await getState())));

  // --- writes (each stamps updatedAt; notes merge per note in the app) ---
  server.registerTool("create_note", {
    title: "Create note",
    description:
      "Create a note on a task (taskId), on a project (projectId), or loose " +
      "(neither). Plain text: blank lines split paragraphs, '- ' lines become " +
      "a bullet list. Marked AI-authored.",
    inputSchema: {
      ...homeArgs,
      text: z.string().min(1),
      title: z.string().optional(),
      tags: z.array(z.string()).max(12).optional(),
    },
  }, async (args) => json(await mutate((s) => {
    const n = createNoteOp(s, args);
    return { noteId: n.id, home: n.home };
  })));

  server.registerTool("create_note_from_template", {
    title: "Create note from template",
    description:
      "Create a note from a template (see list_note_templates; built-ins: blank, " +
      "meeting, decision, brief, daily, weekly, retro, research). Fills {{date}}, " +
      "{{project}}, {{task}} etc. Home is taskId, projectId, or loose (neither).",
    inputSchema: {
      templateId: z.string(),
      ...homeArgs,
      title: z.string().optional().describe("Override the template's title"),
    },
  }, async (args) => json(await mutate((s) => {
    const n = createNoteFromTemplateOp(s, args);
    return { noteId: n.id, title: n.title ?? null, home: n.home, templateId: n.templateId };
  })));

  server.registerTool("append_note", {
    title: "Append note",
    description:
      "Add a note to a task. Use to write back what an AI did (a first pass, a " +
      "result). Same as create_note with taskId.",
    inputSchema: {
      taskId: z.string(),
      text: z.string().min(1),
      title: z.string().optional(),
    },
  }, async (args) => json(await mutate((s) => {
    const n = createNoteOp(s, args);
    return { taskId: args.taskId, noteId: n.id };
  })));

  server.registerTool("set_note", {
    title: "Edit a note",
    description:
      "Edit an existing note by id: replace its text (re-renders structure: " +
      "blank lines split paragraphs, '- ' lines become a bullet list), title, " +
      "tags, or pinned state. Replacing text drops any rich formatting the " +
      "note had.",
    inputSchema: {
      noteId: z.string(),
      text: z.string().min(1).optional(),
      title: z.string().nullable().optional().describe("null clears the title"),
      tags: z.array(z.string()).max(12).optional(),
      pinned: z.boolean().optional(),
    },
  }, async (args) => json(await mutate((s) => {
    const n = setNoteOp(s, args);
    return { noteId: n.id, updatedAt: n.updatedAt };
  })));

  server.registerTool("delete_note", {
    title: "Delete a note",
    description: "Delete a note by id. It moves to aro.day's Deleted notes, restorable for 30 days.",
    inputSchema: { noteId: z.string() },
  }, async (args) => json(await mutate((s) => {
    const n = deleteNoteOp(s, args.noteId);
    return { deleted: n.id };
  })));
}
