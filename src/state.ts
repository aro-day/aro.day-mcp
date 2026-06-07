// Minimal mirror of the aro.day state shape the connector reads/writes.
// This is a SUBSET — only the fields the connector touches. The canonical
// schema lives in the app repo (src/types/window-state.d.ts); keep the
// field names + the `updatedAt` LWW contract in lockstep with it.

export interface TaskNote {
  id: string;
  html: string;
  title?: string | null;
  color?: string | null;
  source?: "user" | "ai" | null; // "ai" → written by a connected agent
  createdAt: string;
  updatedAt: string;
}

// One step of a task's "Steps" checklist (one-level subtasks). Mirror of
// the app's Subtask (todo repo → src/types/window-state.d.ts). One level
// only — a step never carries its own steps.
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  doneAt?: string | null;
  order: number;
}

export interface Task {
  id: string;
  title: string;
  groupId: string;
  status: "queued" | "in-progress" | "done";
  priority?: 0 | 1 | 2 | 3;
  order?: number;
  scheduledAt?: string | null;
  dueAt?: string | null;
  estimationMinutes?: number | null;
  blocked?: boolean;
  blockReason?: string | null;
  tags?: string[];
  noteList?: TaskNote[];
  subtasks?: Subtask[]; // one-level "Steps" checklist (optional; app guards it)
  notesHtml?: string | null;
  createdAt?: string;
  updatedAt?: string; // REQUIRED for LWW — stamped on every mutation
  completedAt?: string | null;
  archived?: boolean;
  creatorSub?: string | null; // provenance — "ai" writes set this where known
}

export interface Group {
  id: string;
  name: string;
  order?: number;
  collapsed?: boolean;
  color?: string | null;
  kind?: "habit" | null;
  updatedAt?: string;
}

export interface Session {
  id: string;
  taskId?: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  updatedAt?: string;
}

// AI-execution job (TodoState.aiJobs). The autonomous-execution feature was
// removed, but the `aiJobs` collection still ships in the app schema (v41,
// frozen migration) and syncs via Drive — so we keep this type to preserve it
// on read-merge-write round-trips rather than silently stripping a synced
// collection. Do NOT delete; keep in lockstep with src/types/window-state.d.ts.
export interface AiJob {
  id: string;
  taskId: string;
  status: "requested" | "claimed" | "running" | "done" | "failed";
  repo?: string | null;
  instructions?: string | null;
  runnerId?: string | null;
  requestedAt?: string;
  claimedAt?: string | null;
  finishedAt?: string | null;
  result?: "success" | "error" | null;
  prLink?: string | null;
  updatedAt: string; // LWW key
}

export interface TodoState {
  schemaVersion: number;
  tasks: Task[];
  groups: Group[];
  sessions: Session[];
  trash: unknown[];
  people: unknown[];
  tombstones: unknown[];
  externalEvents: unknown[];
  aiJobs?: AiJob[];
  settings: Record<string, unknown>;
  meta: { lastModifiedBy: string; lastModifiedAt: string; [k: string]: unknown };
  [k: string]: unknown;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// Same id shape as the app (src/lib/ids.ts): `<prefix>_<base36 time><rand>`.
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// The project a new task lands in when the caller gives no projectId.
// Skips habit-kind groups: Habits is order 0 in the app, but it's a
// closed/locked project (the app blocks moving tasks out of it), so a
// plain MCP-created task dropped there would be trapped. Fall back to the
// first group only if every group is a habit group.
export function defaultProjectId(state: Pick<TodoState, "groups">): string | undefined {
  const groups = state.groups ?? [];
  return (groups.find((g) => g.kind !== "habit") ?? groups[0])?.id;
}

// Stamp updatedAt (the LWW key) on an entity. Returns the same object.
export function stampUpdated<T extends { updatedAt?: string }>(entity: T): T {
  entity.updatedAt = nowIso();
  return entity;
}

// Mark the whole blob as modified by this connector — drives settings/meta
// LWW and is the human-visible "who changed this last" signal.
export function stampMeta(state: TodoState, by = "aroday-mcp"): void {
  state.meta = { ...state.meta, lastModifiedBy: by, lastModifiedAt: nowIso() };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Render a plain-text note into the small, safe HTML subset the app's note
// view displays. Escapes ALL user text, then adds structure: a blank line
// starts a new <p>; lines beginning "- ", "* ", or "• " become a <ul><li>
// list; single newlines inside a block become <br>. Only <p>/<br>/<ul>/<li>
// are emitted — the tags the app already renders — so a multi-line note
// shows structure instead of the old single-paragraph wall. buildNote and
// set_note both route through this so connector notes render like the app's.
export function renderNoteHtml(text: string): string {
  const BULLET = /^[ \t]*[-*•][ \t]+/; // "- ", "* ", or "• " (markdown-ish)
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const out = blocks.map((block) => {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length > 0 && lines.every((l) => BULLET.test(l))) {
      return `<ul>${lines.map((l) => `<li>${escapeHtml(l.replace(BULLET, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${lines.map((l) => escapeHtml(l)).join("<br>")}</p>`;
  }).join("");
  return out || "<p></p>";
}

// --- entity builders ------------------------------------------------------
// The connector writes back the SAME schemaVersion it read (drive.ts), and
// the app's migration is version-gated (migrateStateInPlace only runs when
// the blob is BEHIND) — so the app never re-initializes fields on a
// connector-created entity. These builders therefore set every field the
// app's canonical schema (todo repo → src/types/window-state.d.ts) marks
// REQUIRED, so a freshly-created entity is valid the instant it lands.
// Optional fields are left absent on purpose — the app reads them guarded
// (rule 01). Keep the required set in lockstep with window-state.d.ts;
// builders.test.ts asserts it and trips when the app promotes a field.

export function buildTask(input: {
  title: string;
  groupId: string;
  order: number;
  priority?: 0 | 1 | 2 | 3;
  dueAt?: string | null;
  scheduledAt?: string | null;
  estimationMinutes?: number | null;
  tags?: string[];
}): Task {
  const t: Task = {
    id: newId("t"),
    title: input.title,
    groupId: input.groupId,
    status: "queued",
    order: input.order,
    priority: input.priority ?? 2,
    dueAt: input.dueAt ?? null,
    scheduledAt: input.scheduledAt ?? null,
    estimationMinutes: input.estimationMinutes ?? null,
    tags: input.tags ?? [],
    createdAt: nowIso(),
    creatorSub: null,
  };
  return stampUpdated(t);
}

// A step. Like noteList, subtasks is left absent on a fresh task and
// initialized on the first add (the app backfills [] on read, rule 01).
export function buildSubtask(title: string, order: number): Subtask {
  return { id: newId("st"), title, done: false, createdAt: nowIso(), order };
}

export function buildGroup(input: { name: string; order: number }): Group {
  const g: Group = {
    id: newId("grp"),
    name: input.name,
    order: input.order,
    collapsed: false,
  };
  return stampUpdated(g);
}

export function buildNote(input: {
  text: string;
  title?: string | null;
  source?: "user" | "ai";
}): TaskNote {
  const now = nowIso();
  return {
    id: newId("n"),
    html: renderNoteHtml(input.text),
    title: input.title ?? null,
    source: input.source ?? "ai",
    createdAt: now,
    updatedAt: now,
  };
}
