// Note templates — the app's built-ins plus the user's own templates
// (TodoState.noteTemplates), instantiated into a new note. Pure; no network.
//
// MIRRORS (todo repo, keep in lockstep):
//   - built-in ids, glyphs, homes, block layout → src/data/note-templates.ts
//   - English copy (names, titles, headings)    → src/i18n/locales/en.ts `noteTemplates`
//   - block → HTML rendering                    → src/lib/note-templates.ts (blockHtml)
//   - {{var}} filling                           → src/lib/note-template-fill.ts
//   - fill context (project / task names)       → src/features/notes-view/template-actions.ts
// Built-in copy is English only: the app localizes it through i18n keys the
// connector does not ship (follow-up in the PR notes).

import type { NoteHome, NoteTemplate, TodoState } from "./state.js";

export type NoteTemplateHome = "project" | "loose" | "context";

interface TemplateBlock {
  kind: "h2" | "p" | "bullets" | "checklist";
  text?: string; // h2 heading (the app stores an i18n key; this is its en value)
  count?: number; // empty rows for bullets / checklist (default 1)
}

interface BuiltinNoteTemplate {
  id: string;
  glyph: string;
  name: string;
  titlePattern: string | null; // null = the note starts untitled
  defaultHome: NoteTemplateHome;
  blocks: TemplateBlock[];
}

export const BLANK_TEMPLATE_ID = "blank";

const h2 = (text: string): TemplateBlock => ({ kind: "h2", text });
const P: TemplateBlock = { kind: "p" };
const BULLETS: TemplateBlock = { kind: "bullets" };
const CHECK: TemplateBlock = { kind: "checklist" };

export const BUILTIN_NOTE_TEMPLATES: readonly BuiltinNoteTemplate[] = [
  { id: BLANK_TEMPLATE_ID, glyph: "□", name: "Blank", titlePattern: null, defaultHome: "context", blocks: [] },
  {
    id: "meeting", glyph: "⧉", name: "Meeting", titlePattern: "{{date}} · Meeting", defaultHome: "context",
    blocks: [h2("Attendees"), P, h2("Agenda"), BULLETS, h2("Notes"), P, h2("Action items"), CHECK],
  },
  {
    id: "decision", glyph: "⚖", name: "Decision", titlePattern: "{{date}} · Decision", defaultHome: "context",
    blocks: [h2("Context"), P, h2("Options"), BULLETS, h2("Decision"), P, h2("Why"), P, h2("Revisit on"), P],
  },
  {
    id: "brief", glyph: "◎", name: "Project brief", titlePattern: "{{project}} brief", defaultHome: "project",
    blocks: [h2("Goal"), P, h2("Done means"), BULLETS, h2("Out of scope"), BULLETS, h2("Risks"), BULLETS, h2("Milestones"), CHECK],
  },
  {
    id: "daily", glyph: "☀", name: "Daily log", titlePattern: "{{weekday}} {{date}}", defaultHome: "loose",
    blocks: [h2("Today's focus"), CHECK, h2("Done"), BULLETS, h2("Blocked"), BULLETS, h2("Tomorrow"), BULLETS],
  },
  {
    id: "weekly", glyph: "▥", name: "Weekly review", titlePattern: "Week {{week}}", defaultHome: "loose",
    blocks: [h2("Wins"), BULLETS, h2("Slipped"), BULLETS, h2("Projects at risk"), BULLETS, h2("Next week's top 3"), { kind: "checklist", count: 3 }],
  },
  {
    id: "retro", glyph: "⇄", name: "Retro", titlePattern: "{{project}} retro", defaultHome: "project",
    blocks: [h2("Went well"), BULLETS, h2("Went badly"), BULLETS, h2("Change next time"), BULLETS, h2("Follow-ups"), CHECK],
  },
  {
    id: "research", glyph: "⌕", name: "Research", titlePattern: "Research: {{cursor}}", defaultHome: "context",
    blocks: [h2("Question"), P, h2("Sources"), BULLETS, h2("Findings"), P, h2("Open questions"), BULLETS],
  },
];

export const BUILTIN_TEMPLATE_IDS: readonly string[] = BUILTIN_NOTE_TEMPLATES.map((x) => x.id);

/** One template, built-in or the user's, in a single instantiable shape. */
export interface TemplateView {
  id: string;
  builtin: boolean;
  glyph: string;
  name: string;
  titlePattern: string | null;
  html: string;
  defaultHome: NoteTemplateHome;
}

const escapeAttrHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Empty rows in the exact saved shape the app's editor (TipTap TaskItem /
// ListItem) emits — the app's renderer draws the checkbox from data-checked.
const EMPTY_BULLET = "<li><p></p></li>";
const EMPTY_CHECK = "<li data-type=\"taskItem\" data-checked=\"false\"><p></p></li>";

function blockHtml(b: TemplateBlock): string {
  const rows = Math.max(1, b.count ?? 1);
  switch (b.kind) {
    case "h2": return `<h2>${escapeAttrHtml(b.text ?? "")}</h2>`;
    case "p": return "<p></p>";
    case "bullets": return `<ul>${EMPTY_BULLET.repeat(rows)}</ul>`;
    case "checklist": return `<ul data-type="taskList">${EMPTY_CHECK.repeat(rows)}</ul>`;
  }
}

function builtinView(tpl: BuiltinNoteTemplate): TemplateView {
  return {
    id: tpl.id, builtin: true, glyph: tpl.glyph, name: tpl.name,
    titlePattern: tpl.titlePattern,
    html: tpl.blocks.map(blockHtml).join(""),
    defaultHome: tpl.defaultHome,
  };
}

function customView(tpl: NoteTemplate): TemplateView {
  return {
    id: tpl.id, builtin: false, glyph: tpl.glyph, name: tpl.name,
    titlePattern: tpl.titlePattern, html: tpl.html, defaultHome: tpl.defaultHome,
  };
}

/** Built-ins in their fixed order, then the user's templates. */
export function allTemplates(s: TodoState): TemplateView[] {
  return [...BUILTIN_NOTE_TEMPLATES.map(builtinView), ...(s.noteTemplates ?? []).map(customView)];
}

export function templateById(s: TodoState, id: string): TemplateView | null {
  const builtin = BUILTIN_NOTE_TEMPLATES.find((b) => b.id === id);
  if (builtin) return builtinView(builtin);
  const own = (s.noteTemplates ?? []).find((x) => x.id === id);
  return own ? customView(own) : null;
}

// --- {{var}} filling (port of the app's note-template-fill.ts) -------------

export interface TemplateFillContext {
  now: Date;
  locale: string;
  project?: string;
  task?: string;
}

// Arabic renders Eastern Arabic-Indic digits only with the -EG region (app rule 02 §9).
const intlLocale = (loc: string): string => (loc === "ar" ? "ar-EG" : loc || "en");

/** ISO-8601 week number (weeks start Monday; week 1 holds the year's first Thursday). */
export function isoWeek(d: Date): number {
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = day.getUTCDay() || 7; // Sunday → 7 so Monday is day 1
  day.setUTCDate(day.getUTCDate() + 4 - dow); // the Thursday of this ISO week decides the year
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

function safeFormat(loc: string, opts: Intl.DateTimeFormatOptions, d: Date): string {
  try { return new Intl.DateTimeFormat(intlLocale(loc), opts).format(d); }
  catch { return new Intl.DateTimeFormat("en", opts).format(d); }
}

function safeNumber(loc: string, n: number): string {
  try { return new Intl.NumberFormat(intlLocale(loc), { useGrouping: false }).format(n); }
  catch { return String(n); }
}

const VAR_RX = /\{\{\s*(\w+)\s*\}\}/g;

/** Fill {{date}} {{time}} {{weekday}} {{week}} {{project}} {{task}}; drop
 *  {{cursor}}; leave unknown {{x}} literal so a typo stays visible. */
export function fillTemplate(text: string, ctx: TemplateFillContext): string {
  if (!text || !text.includes("{{")) return text;
  const { now, locale } = ctx;
  const values: Record<string, () => string> = {
    date: () => safeFormat(locale, { year: "numeric", month: "short", day: "numeric" }, now),
    time: () => safeFormat(locale, { hour: "2-digit", minute: "2-digit" }, now),
    weekday: () => safeFormat(locale, { weekday: "long" }, now),
    week: () => safeNumber(locale, isoWeek(now)),
    project: () => ctx.project ?? "",
    task: () => ctx.task ?? "",
    cursor: () => "",
  };
  return text
    .replace(VAR_RX, (whole, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name]!() : whole))
    .trim();
}

/** Project / task names for {{project}} / {{task}}, from the note's home.
 *  Locale is "en" because the built-in headings above are English. */
export function fillContextFor(s: TodoState, home: NoteHome | null, now = new Date()): TemplateFillContext {
  const ctx: TemplateFillContext = { now, locale: "en" };
  if (home?.kind === "project") ctx.project = (s.groups ?? []).find((g) => g.id === home.id)?.name;
  if (home?.kind === "task") {
    const task = (s.tasks ?? []).find((x) => x.id === home.id);
    ctx.task = task?.title;
    ctx.project = (s.groups ?? []).find((g) => g.id === task?.groupId)?.name;
  }
  return ctx;
}

/** Fill the template's variables once, for a new note. */
export function instantiateTemplate(tpl: TemplateView, ctx: TemplateFillContext): { title: string | null; html: string } {
  const pattern = tpl.titlePattern ?? "";
  // "{{project}} brief" outside a project would read " brief" — use the name.
  const needsProject = /\{\{\s*project\s*\}\}/.test(pattern) && !ctx.project;
  const title = needsProject ? tpl.name : fillTemplate(pattern, ctx);
  return { title: title || null, html: fillTemplate(tpl.html, ctx) };
}
