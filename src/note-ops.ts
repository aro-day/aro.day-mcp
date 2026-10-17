// What each note tool does to the state, as pure functions over TodoState —
// note-tools.ts wraps them in getState()/mutate(); note-ops.test.ts drives
// them on fixture states. Every write goes to TodoState.notes (v44+), never
// task.noteList (see notes.ts for the sync contract).

import { buildNote, renderNoteHtml, type Note, type Task, type TodoState } from "./state.js";
import {
  addNote, liveNotes, noteSummary, notesForTask, patchNote, requireLiveNote, resolveHome, softDeleteNote, stripHtml,
} from "./notes.js";
import { allTemplates, fillContextFor, instantiateTemplate, templateById } from "./note-templates.js";

export interface NoteWhere {
  taskId?: string;
  projectId?: string;
}

/** A task with its live notes inlined (legacy noteList left out — it is
 *  always empty after the load-time hoist). */
export function taskWithNotes(s: TodoState, task: Task) {
  const { noteList: _legacy, ...rest } = task;
  return { ...rest, notes: notesForTask(s, task.id) };
}

export function createNoteOp(
  s: TodoState,
  input: NoteWhere & { text: string; title?: string; tags?: string[] },
): Note {
  const home = resolveHome(s, input);
  return addNote(s, buildNote({ home, text: input.text, title: input.title, tags: input.tags, source: "ai" }));
}

export function createNoteFromTemplateOp(
  s: TodoState,
  input: NoteWhere & { templateId: string; title?: string },
  now = new Date(),
): Note {
  const tpl = templateById(s, input.templateId);
  if (!tpl) {
    const ids = allTemplates(s).map((t) => t.id).join(", ");
    throw new Error(`No note template "${input.templateId}". Available: ${ids}.`);
  }
  const home = resolveHome(s, input);
  const filled = instantiateTemplate(tpl, fillContextFor(s, home, now));
  return addNote(s, buildNote({
    home, html: filled.html, title: input.title ?? filled.title, templateId: tpl.id, source: "ai",
  }));
}

export function listTemplatesOp(s: TodoState) {
  return allTemplates(s).map((t) => ({
    id: t.id, name: t.name, glyph: t.glyph, builtin: t.builtin,
    titlePattern: t.titlePattern, defaultHome: t.defaultHome,
    sections: [...t.html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => stripHtml(m[1])).filter(Boolean),
  }));
}

export interface ListNotesInput extends NoteWhere {
  loose?: boolean;
  query?: string;
  limit?: number;
}

const DEFAULT_LIST_LIMIT = 100;

/** Live notes, filtered by home and/or text; pinned first, newest first. */
export function listNotesOp(s: TodoState, input: ListNotesInput) {
  let notes = liveNotes(s);
  if (input.taskId) notes = notes.filter((n) => n.home?.kind === "task" && n.home.id === input.taskId);
  if (input.projectId) notes = notes.filter((n) => n.home?.kind === "project" && n.home.id === input.projectId);
  if (input.loose) notes = notes.filter((n) => !n.home);
  if (input.query) {
    const q = input.query.toLowerCase();
    notes = notes.filter((n) => (n.title ?? "").toLowerCase().includes(q) || stripHtml(n.html).toLowerCase().includes(q));
  }
  notes.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  return notes.slice(0, input.limit ?? DEFAULT_LIST_LIMIT).map(noteSummary);
}

export function getNoteOp(s: TodoState, id: string): Note {
  return requireLiveNote(s, id);
}

export function setNoteOp(
  s: TodoState,
  input: { noteId: string; text?: string; title?: string | null; tags?: string[]; pinned?: boolean },
): Note {
  const patch: Partial<Pick<Note, "html" | "title" | "tags" | "pinned">> = {};
  if (input.text !== undefined) patch.html = renderNoteHtml(input.text);
  if (input.title !== undefined) patch.title = input.title;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.pinned !== undefined) patch.pinned = input.pinned;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to change — pass text, title, tags, or pinned.");
  return patchNote(s, input.noteId, patch);
}

export function deleteNoteOp(s: TodoState, noteId: string): Note {
  return softDeleteNote(s, noteId);
}
