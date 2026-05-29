// Deterministic session→task matching. Given a coding/work session's repo,
// branch, and a short hint, rank the user's existing tasks by lexical token
// overlap so the connected agent can suggest "log to this task?" instead of
// blindly creating a new one. Pure + deterministic — the JUDGEMENT (which
// candidate, or none) stays with the agent; this only ranks.

import type { Task } from "./state.js";

export interface SessionQuery {
  repo?: string | null;
  branch?: string | null;
  hint?: string | null;
}

export interface RankedTask {
  id: string;
  title: string;
  score: number;
}

// Tokens that carry no signal for matching a task — branch/commit noise and
// ubiquitous verbs. Kept small + obvious so a future agent can extend it.
const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "and", "for", "in", "on", "with", "my",
  "fix", "feat", "chore", "wip", "add", "update", "branch", "main", "master",
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// A repo like "MotazAbuElnasr/todo.sh" matches best on its basename
// ("todo.sh" → todo), not the owner — split on "/" and keep the last part.
function repoTokens(repo: string): string[] {
  const base = repo.split("/").pop() ?? repo;
  return tokenize(base);
}

export function rankTasksForSession(
  tasks: readonly Task[],
  query: SessionQuery,
  limit = 5,
): RankedTask[] {
  const q = new Set<string>();
  if (query.repo) for (const t of repoTokens(query.repo)) q.add(t);
  if (query.branch) for (const t of tokenize(query.branch)) q.add(t);
  if (query.hint) for (const t of tokenize(query.hint)) q.add(t);
  if (q.size === 0) return [];

  const ranked: RankedTask[] = [];
  for (const task of tasks) {
    if (task.archived || task.status === "done") continue;
    const taskTokens = new Set<string>(tokenize(task.title));
    for (const tag of task.tags ?? []) for (const t of tokenize(tag)) taskTokens.add(t);
    let score = 0;
    for (const token of q) if (taskTokens.has(token)) score++;
    if (score > 0) ranked.push({ id: task.id, title: task.title, score });
  }
  // Highest overlap first; ties keep input order (stable sort) so the result
  // is deterministic for a given state.
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}
