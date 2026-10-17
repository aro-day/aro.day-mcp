// Notes collection (TodoState.notes, app schemaVersion 44+) — pure helpers.
// No network / store imports, so `bun test` loads it directly.
//
// Contract with the app (todo repo → src/lib/notes.ts + src/state/sync-merge.ts):
// notes merge per id on `updatedAt` (LWW) plus tombstones, so every write
// here stamps updatedAt, and delete is a SOFT delete (deletedAt) — the app's
// Notes view restores it and purges after 30 days. Never hard-remove a note
// here: a removal without a tombstone is resurrected by the next merge.

import { nowIso, type Note, type NoteHome, type TaskNote, type TodoState } from "./state.js";

type WithNoteList = { id: string; noteList?: TaskNote[] };

function tsMs(iso: string | null | undefined): number {
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

export function notesArr(s: TodoState): Note[] {
  if (!Array.isArray(s.notes)) s.notes = [];
  return s.notes;
}

/** Move every task.noteList / trash[].noteList entry into notes[] (home =
 *  that task) and empty the list. MIRROR of the app's hoistTaskNotes
 *  (src/lib/notes.ts), which its migrations-additive.ts runs on every load
 *  at any schemaVersion — so running it here on a pre-v44 blob is exactly
 *  what the app would do on its next load. Idempotent; skips tombstoned
 *  ids; a newer legacy copy of an existing note updates its body only. */
export function hoistTaskNotes(s: TodoState): boolean {
  const notes = notesArr(s);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const tombstoned = new Set(((s.tombstones ?? []) as Array<{ id?: string }>).map((t) => t?.id));
  let changed = false;
  const visit = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const t of list as WithNoteList[]) {
      if (!t || !Array.isArray(t.noteList) || t.noteList.length === 0) continue;
      for (const n of t.noteList) {
        if (!n?.id || tombstoned.has(n.id)) continue;
        const existing = byId.get(n.id);
        if (!existing) {
          const hoisted: Note = { ...n, home: { kind: "task", id: t.id } };
          notes.push(hoisted);
          byId.set(n.id, hoisted);
        } else if (tsMs(n.updatedAt) > tsMs(existing.updatedAt)) {
          existing.html = n.html;
          existing.title = n.title ?? existing.title ?? null;
          existing.updatedAt = n.updatedAt;
        }
      }
      t.noteList = [];
      changed = true;
    }
  };
  visit(s.tasks);
  visit(s.trash);
  return changed;
}

/** Visible notes: not soft-deleted, and not homed on a trashed/purged task
 *  (same rule as the app's liveNotes). */
export function liveNotes(s: TodoState): Note[] {
  const liveTaskIds = new Set((s.tasks ?? []).map((t) => t.id));
  return (s.notes ?? []).filter((n) =>
    !n.deletedAt && (n.home?.kind !== "task" || liveTaskIds.has(n.home.id)));
}

export function notesForTask(s: TodoState, taskId: string): Note[] {
  return liveNotes(s).filter((n) => n.home?.kind === "task" && n.home.id === taskId);
}

/** A live note by id, or a clear error (unknown id, or already deleted). */
export function requireLiveNote(s: TodoState, id: string): Note {
  const n = (s.notes ?? []).find((x) => x.id === id);
  if (!n) throw new Error(`No note with id "${id}".`);
  if (n.deletedAt) throw new Error(`Note "${id}" is deleted. Restore it in aro.day's Notes view first.`);
  return n;
}

/** Validate and build a note home from optional task/project ids.
 *  Neither = Loose (null). Both = error (a note has exactly one home). */
export function resolveHome(s: TodoState, where: { taskId?: string; projectId?: string }): NoteHome | null {
  if (where.taskId && where.projectId) throw new Error("Give taskId OR projectId, not both — a note has one home.");
  if (where.taskId) {
    if (!(s.tasks ?? []).some((t) => t.id === where.taskId)) throw new Error(`No task with id "${where.taskId}".`);
    return { kind: "task", id: where.taskId };
  }
  if (where.projectId) {
    if (!(s.groups ?? []).some((g) => g.id === where.projectId)) throw new Error(`No project with id "${where.projectId}".`);
    return { kind: "project", id: where.projectId };
  }
  return null;
}

export function addNote(s: TodoState, note: Note): Note {
  notesArr(s).push(note);
  return note;
}

/** Patch a live note's body/title/tags/pinned and bump updatedAt (LWW). */
export function patchNote(
  s: TodoState,
  id: string,
  patch: Partial<Pick<Note, "html" | "title" | "tags" | "pinned">>,
): Note {
  const n = requireLiveNote(s, id);
  Object.assign(n, patch);
  n.updatedAt = nowIso();
  return n;
}

/** Soft delete (the app's softDeleteNote): sets deletedAt + bumps updatedAt. */
export function softDeleteNote(s: TodoState, id: string): Note {
  const n = requireLiveNote(s, id);
  const now = nowIso();
  n.deletedAt = now;
  n.updatedAt = now;
  return n;
}

/** HTML → plain text, one line per block (simplified port of the app's
 *  stripHtml in src/lib/notes-query.ts) — for previews and search. */
export function stripHtml(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<\/(p|h[1-6]|li|div|pre|blockquote|td|th|tr|summary)>/gi, "\n")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<(?:[^>"]|"[^"]*")+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const PREVIEW_CHARS = 200; // enough for an agent to pick the right note without pulling every body

/** Compact listing shape — full html comes from get_note. */
export function noteSummary(n: Note) {
  const text = stripHtml(n.html);
  return {
    id: n.id,
    title: n.title ?? null,
    home: n.home ?? null,
    pinned: !!n.pinned,
    tags: n.tags ?? [],
    templateId: n.templateId ?? null,
    source: n.source ?? null,
    updatedAt: n.updatedAt,
    preview: text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text,
  };
}
