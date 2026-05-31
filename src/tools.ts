// MCP tool surface — deterministic read/write over the user's tasks.
// "App intelligence": these are pure capabilities; the *reasoning* is the
// connected agent's job (docs/mcp/technical-design.md §2). No LLM here.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getState, mutate, requireTask, requireGroup } from "./store.js";
import { nowIso, stampUpdated, buildTask, buildGroup, buildNote, type Task } from "./state.js";
import { rankTasksForSession } from "./session-match.js";
import { readSession } from "./auth.js";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const json = (v: unknown) => ok(JSON.stringify(v, null, 2));

function startOfTodayMs(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}
function endOfTodayMs(): number {
  return startOfTodayMs() + 24 * 60 * 60_000;
}

function taskSummary(t: Task, groupName: string) {
  return {
    id: t.id, title: t.title, project: groupName, status: t.status,
    priority: t.priority ?? null, dueAt: t.dueAt ?? null, scheduledAt: t.scheduledAt ?? null,
    estimationMinutes: t.estimationMinutes ?? null, blocked: !!t.blocked, tags: t.tags ?? [],
  };
}

export function registerTools(server: McpServer): void {
  // --- identity ---
  server.registerTool("whoami", {
    title: "Who am I",
    description: "Show the connected aro.day account and a count of projects/tasks.",
    inputSchema: {},
  }, async () => {
    const s = await getState();
    const sess = readSession();
    return json({
      clientId: sess?.clientId ?? null,
      projects: s.groups.length,
      tasks: s.tasks.length,
      lastModifiedBy: s.meta?.lastModifiedBy ?? null,
    });
  });

  // --- reads ---
  server.registerTool("list_projects", {
    title: "List projects",
    description: "List all projects (groups) with their ids.",
    inputSchema: {},
  }, async () => {
    const s = await getState();
    return json(s.groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind ?? null })));
  });

  server.registerTool("list_tasks", {
    title: "List tasks",
    description: "List tasks, optionally filtered. Use to find ids before updating.",
    inputSchema: {
      projectId: z.string().optional().describe("Only tasks in this project id"),
      status: z.enum(["queued", "in-progress", "done"]).optional(),
      overdue: z.boolean().optional().describe("Only tasks with a due date in the past"),
      scheduledToday: z.boolean().optional(),
      tag: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
  }, async (args) => {
    const s = await getState();
    const names = new Map(s.groups.map((g) => [g.id, g.name]));
    const now = Date.now();
    let tasks = s.tasks.filter((t) => !t.archived);
    if (args.projectId) tasks = tasks.filter((t) => t.groupId === args.projectId);
    if (args.status) tasks = tasks.filter((t) => t.status === args.status);
    if (args.tag) tasks = tasks.filter((t) => (t.tags ?? []).includes(args.tag!));
    if (args.overdue) tasks = tasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now && t.status !== "done");
    if (args.scheduledToday) {
      const lo = startOfTodayMs(), hi = endOfTodayMs();
      tasks = tasks.filter((t) => t.scheduledAt && new Date(t.scheduledAt).getTime() >= lo && new Date(t.scheduledAt).getTime() < hi);
    }
    return json(tasks.slice(0, args.limit ?? 200).map((t) => taskSummary(t, names.get(t.groupId) ?? "?")));
  });

  server.registerTool("get_task", {
    title: "Get task",
    description: "Get one task in full, including its notes.",
    inputSchema: { id: z.string() },
  }, async (args) => {
    const s = await getState();
    return json(requireTask(s, args.id));
  });

  server.registerTool("search_tasks", {
    title: "Search tasks",
    description: "Case-insensitive substring search over task titles.",
    inputSchema: { query: z.string().min(1) },
  }, async (args) => {
    const s = await getState();
    const names = new Map(s.groups.map((g) => [g.id, g.name]));
    const q = args.query.toLowerCase();
    return json(s.tasks.filter((t) => !t.archived && t.title.toLowerCase().includes(q))
      .map((t) => taskSummary(t, names.get(t.groupId) ?? "?")));
  });

  server.registerTool("get_today_plan", {
    title: "Today's plan",
    description: "Tasks scheduled for today plus anything overdue.",
    inputSchema: {},
  }, async () => {
    const s = await getState();
    const names = new Map(s.groups.map((g) => [g.id, g.name]));
    const lo = startOfTodayMs(), hi = endOfTodayMs(), now = Date.now();
    const scheduledToday = s.tasks.filter((t) => !t.archived && t.scheduledAt &&
      new Date(t.scheduledAt).getTime() >= lo && new Date(t.scheduledAt).getTime() < hi);
    const overdue = s.tasks.filter((t) => !t.archived && t.status !== "done" && t.dueAt &&
      new Date(t.dueAt).getTime() < now);
    return json({
      scheduledToday: scheduledToday.map((t) => taskSummary(t, names.get(t.groupId) ?? "?")),
      overdue: overdue.map((t) => taskSummary(t, names.get(t.groupId) ?? "?")),
    });
  });

  // --- writes (read-mutate-write; each stamps a fresh updatedAt for LWW) ---
  server.registerTool("create_task", {
    title: "Create task",
    description: "Create a task. projectId is optional — defaults to the first project.",
    inputSchema: {
      title: z.string().min(1),
      projectId: z.string().optional(),
      notes: z.string().optional().describe("Plain-text note added to the task"),
      priority: z.number().int().min(0).max(3).optional(),
      dueAt: z.string().optional().describe("ISO timestamp"),
      scheduledAt: z.string().optional().describe("ISO timestamp"),
      estimationMinutes: z.number().int().positive().optional(),
      tags: z.array(z.string()).max(12).optional(),
    },
  }, async (args) => json(await mutate((s) => {
    const groupId = args.projectId ?? s.groups[0]?.id;
    if (!groupId) throw new Error("No project exists. Create one first with create_project.");
    requireGroup(s, groupId);
    const t = buildTask({
      title: args.title, groupId, order: s.tasks.length,
      priority: args.priority as Task["priority"],
      dueAt: args.dueAt, scheduledAt: args.scheduledAt,
      estimationMinutes: args.estimationMinutes, tags: args.tags,
    });
    if (args.notes) t.noteList = [buildNote({ text: args.notes, source: "ai" })];
    s.tasks.push(t);
    return { created: t.id, title: t.title };
  })));

  server.registerTool("update_task", {
    title: "Update task",
    description: "Patch fields on a task (title, priority, due/scheduled, estimate, tags).",
    inputSchema: {
      id: z.string(),
      title: z.string().min(1).optional(),
      priority: z.number().int().min(0).max(3).optional(),
      dueAt: z.string().nullable().optional(),
      scheduledAt: z.string().nullable().optional(),
      estimationMinutes: z.number().int().positive().nullable().optional(),
      tags: z.array(z.string()).max(12).optional(),
    },
  }, async (args) => json(await mutate((s) => {
    const t = requireTask(s, args.id);
    if (args.title !== undefined) t.title = args.title;
    if (args.priority !== undefined) t.priority = args.priority as Task["priority"];
    if (args.dueAt !== undefined) t.dueAt = args.dueAt;
    if (args.scheduledAt !== undefined) t.scheduledAt = args.scheduledAt;
    if (args.estimationMinutes !== undefined) t.estimationMinutes = args.estimationMinutes;
    if (args.tags !== undefined) t.tags = args.tags;
    stampUpdated(t);
    return { updated: t.id };
  })));

  server.registerTool("complete_task", {
    title: "Complete task",
    description: "Mark a task done.",
    inputSchema: { id: z.string() },
  }, async (args) => json(await mutate((s) => {
    const t = requireTask(s, args.id);
    t.status = "done"; t.completedAt = nowIso(); stampUpdated(t);
    return { completed: t.id };
  })));

  server.registerTool("append_note", {
    title: "Append note",
    description: "Add a note to a task. Use to write back what an AI did (a first pass, a result).",
    inputSchema: {
      taskId: z.string(),
      text: z.string().min(1),
      title: z.string().optional(),
    },
  }, async (args) => json(await mutate((s) => {
    const t = requireTask(s, args.taskId);
    const note = buildNote({ text: args.text, title: args.title, source: "ai" });
    t.noteList = [...(t.noteList ?? []), note];
    stampUpdated(t);
    return { taskId: t.id, noteId: note.id };
  })));

  server.registerTool("create_project", {
    title: "Create project",
    description: "Create a new project (group).",
    inputSchema: { name: z.string().min(1) },
  }, async (args) => json(await mutate((s) => {
    if (s.groups.some((g) => g.name.toLowerCase() === args.name.toLowerCase())) {
      throw new Error(`A project named "${args.name}" already exists.`);
    }
    const g = buildGroup({ name: args.name, order: s.groups.length });
    s.groups.push(g);
    return { created: g.id, name: g.name };
  })));

  // --- session → task matching (coding-session capture) ----------------
  // Suggest which existing task a work session belongs to, so the agent can
  // confirm "log to this?" instead of blindly creating a new task. The
  // ranking is deterministic (session-match.ts); the JUDGEMENT stays with
  // the agent. `needsConfirmation` reflects the user's captureConfirm
  // setting (default true) — when true, the agent should confirm in chat
  // before linking or creating.
  server.registerTool("find_task_for_session", {
    title: "Find a task for this session",
    description:
      "Find existing tasks that likely match a coding/work session, by repo, " +
      "branch, and a short hint. Returns ranked candidates. If one matches, " +
      "confirm with the user (when needsConfirmation), then append_note to it; " +
      "if none fit, create_task instead.",
    inputSchema: {
      repo: z.string().optional().describe("Repo the session is in, e.g. owner/name"),
      branch: z.string().optional(),
      hint: z.string().optional().describe("A few words about what the session did"),
    },
  }, async (args) => {
    const s = await getState();
    const names = new Map(s.groups.map((g) => [g.id, g.name]));
    const byId = new Map(s.tasks.map((t) => [t.id, t]));
    const ranked = rankTasksForSession(s.tasks, { repo: args.repo, branch: args.branch, hint: args.hint });
    // Default to confirming (ask before acting) unless the user explicitly
    // turned it off in Settings → Integrations.
    const mcp = (s.settings as { mcp?: { captureConfirm?: boolean } } | undefined)?.mcp;
    const needsConfirmation = mcp?.captureConfirm !== false;
    return json({
      candidates: ranked.map((r) => ({
        id: r.id, title: r.title,
        project: names.get(byId.get(r.id)?.groupId ?? "") ?? "?",
        score: r.score,
      })),
      needsConfirmation,
    });
  });
}
