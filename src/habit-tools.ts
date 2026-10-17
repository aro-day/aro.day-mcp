// MCP habit tools — read/write the top-level habits + habitLogs collections
// (app v45+). Thin adapters over habit-ops.ts; registered from server.ts.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getState, mutate } from "./store.js";
import { nowIso } from "./state.js";
import {
  archiveHabitOp, createHabitOp, getHabitOp, HABIT_COLOR_KEYS, listHabitsOp, logHabitOp, todayKey, updateHabitOp,
} from "./habit-ops.js";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const json = (v: unknown) => ok(JSON.stringify(v, null, 2));

const cadence = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }),
  z.object({ kind: z.literal("days"), weekdays: z.array(z.number().int().min(1).max(7)).min(1).describe("ISO weekdays, 1 = Monday … 7 = Sunday") }),
  z.object({ kind: z.literal("perWeek"), times: z.number().int().min(1).max(7) }),
  z.object({ kind: z.literal("perMonth"), times: z.number().int().min(1).max(28) }),
  z.object({ kind: z.literal("everyN"), days: z.number().int().min(1).max(365).describe("Every N days from the start date") }),
]).describe("How often: daily, on given weekdays, N times per week/month, or every N days");

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "24-hour HH:MM");

const definition = {
  type: z.enum(["check", "count", "timer", "limit"]).optional()
    .describe("check = done / not done; count = reach target units; timer = reach target minutes; limit = stay at or under target"),
  target: z.number().int().min(0).optional().describe("Goal per day (count/timer, at least 1) or the ceiling (limit, 0 = none at all). Ignored for check"),
  unit: z.string().max(24).nullable().optional().describe("Unit for count / limit habits, e.g. glasses, cups"),
  cadence: cadence.optional(),
  timeOfDay: z.enum(["morning", "afternoon", "evening", "any"]).optional(),
  at: clock.nullable().optional().describe("HH:MM — the habit shows on the calendar at this time"),
  reminders: z.array(clock).max(6).optional().describe("Reminder times, HH:MM each"),
  glyph: z.string().min(1).max(8).optional(),
  color: z.enum(HABIT_COLOR_KEYS).optional(),
};

export function registerHabitTools(server: McpServer): void {
  // --- reads ---
  server.registerTool("list_habits", {
    title: "List habits",
    description:
      "List habits with today's status: due or not, value vs target, done, skipped, period " +
      "progress (perWeek/perMonth) and current streak, plus today's done/due totals.",
    inputSchema: { includeArchived: z.boolean().optional() },
  }, async (args) => json(listHabitsOp(await getState(), args, todayKey())));

  server.registerTool("get_habit", {
    title: "Get habit",
    description: "Get one habit in full with its day entries for the last `days` days (default 14) and today's status.",
    inputSchema: { habitId: z.string(), days: z.number().int().min(1).max(366).optional() },
  }, async (args) => json(getHabitOp(await getState(), args.habitId, args.days ?? 14, todayKey())));

  // --- writes (each stamps updatedAt; habits and day entries merge per record) ---
  server.registerTool("create_habit", {
    title: "Create habit",
    description:
      "Create a habit starting today. Defaults: type check, daily, any time of day, next unused " +
      "colour and glyph. Names must be unique.",
    inputSchema: { name: z.string().min(1).max(80), ...definition },
  }, async (args) => json(await mutate((s) => {
    const h = createHabitOp(s, args, nowIso(), todayKey());
    return { created: h.id, name: h.name, type: h.type, target: h.target, cadence: h.cadence };
  })));

  server.registerTool("update_habit", {
    title: "Update habit",
    description: "Patch a habit: name, type, target, unit, cadence, time of day, at, reminders, glyph, colour.",
    inputSchema: { habitId: z.string(), name: z.string().min(1).max(80).optional(), ...definition },
  }, async (args) => json(await mutate((s) => {
    const { habitId, ...patch } = args;
    const h = updateHabitOp(s, habitId, patch, nowIso());
    return { updated: h.id, updatedAt: h.updatedAt };
  })));

  server.registerTool("log_habit", {
    title: "Log a habit day",
    description:
      "Record a habit for a day (default today, local time). value sets the day's amount " +
      "(check: 1 = done, 0 = not done; timer: minutes); add adds to it (may be negative); " +
      "skip marks the day skipped (true) or not (false) — a skipped day neither counts nor " +
      "breaks a streak; note sets the day's note (empty clears it); clear resets the day. " +
      "Combine skip/note with value or add.",
    inputSchema: {
      habitId: z.string(),
      date: z.string().optional().describe("YYYY-MM-DD, not in the future. Defaults to today"),
      value: z.number().min(0).optional(),
      add: z.number().optional(),
      skip: z.boolean().optional(),
      note: z.string().max(500).optional(),
      clear: z.boolean().optional().describe("true resets the day to blank (undo a wrong log)"),
    },
  }, async (args) => json(await mutate((s) => {
    const today = todayKey();
    return logHabitOp(s, { ...args, date: args.date ?? today }, nowIso(), today);
  })));

  server.registerTool("archive_habit", {
    title: "Archive habit",
    description: "Archive a habit (hidden, history kept), or bring it back with archived: false.",
    inputSchema: { habitId: z.string(), archived: z.boolean().optional().describe("Default true") },
  }, async (args) => json(await mutate((s) => {
    const h = archiveHabitOp(s, args.habitId, args.archived ?? true, nowIso());
    return { habitId: h.id, archived: !!h.archivedAt };
  })));
}
