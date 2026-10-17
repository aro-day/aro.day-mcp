// Store layer: load the Drive state, and apply mutations with a
// read-mutate-write that stamps the newest updatedAt + meta. Because the
// connector always stamps a fresh updatedAt, its change wins entity-level
// LWW against the app/other devices — the same merge contract the app
// uses (src/state/sync-merge.ts). The only loss window is a concurrent
// write landing between this read and write (sub-second, single-user);
// good enough for v1. A full read-merge-write can be added later.

import { loadState, saveState } from "./drive.js";
import { isHabitGroup, stampMeta, type TodoState, type Task, type Group } from "./state.js";
import { hoistTaskNotes } from "./notes.js";

export async function getState(): Promise<TodoState> {
  const state = await loadState();
  if (!state) {
    throw new Error(
      "No aro.day data found in your Drive yet. Open aro.day once (signed in, Drive connected) " +
      "to create it, then try again.",
    );
  }
  // Guarantee notes[] and fold any legacy task.noteList into it — the same
  // normalization the app runs on every load (migrations-additive.ts), so
  // every tool reads and writes one shape whatever the blob's schemaVersion.
  hoistTaskNotes(state);
  return state;
}

// Apply `fn` to a freshly-loaded state, stamp meta, persist, return the
// fn's result. `fn` MUST stamp updatedAt on any entity it mutates/creates
// (use stampUpdated from state.ts) so LWW resolves in our favour.
export async function mutate<T>(fn: (state: TodoState) => T): Promise<T> {
  const state = await getState();
  const result = fn(state);
  stampMeta(state);
  await saveState(state);
  return result;
}

export function taskById(state: TodoState, id: string): Task | undefined {
  return state.tasks.find((t) => t.id === id);
}

export function groupById(state: TodoState, id: string): Group | undefined {
  return state.groups.find((g) => g.id === id);
}

// Refuses old habit card rows (tasks in the Habits project): since app v45
// habits live in habits[] and those rows are hidden, then deleted at v46, so
// editing one would write a shape the app throws away.
export function requireTask(state: TodoState, id: string): Task {
  const t = taskById(state, id);
  if (!t) throw new Error(`No task with id "${id}".`);
  if (isHabitGroup(groupById(state, t.groupId) ?? { id: t.groupId })) {
    throw new Error(`"${id}" is a habit card from the old habits format, not a task. Use the habit tools (list_habits, log_habit).`);
  }
  return t;
}

export function requireGroup(state: TodoState, id: string): Group {
  const g = groupById(state, id);
  if (!g) throw new Error(`No project with id "${id}".`);
  return g;
}
