# @aro.day/mcp

Open-source [MCP](https://modelcontextprotocol.io) server for
[aro.day](https://aro.day) — let an AI client (Claude Desktop, Claude
Code, Codex, or any MCP client) **read and update your tasks**.

**Your task data never touches aro.day's servers.** The connector reads
and writes tasks in *your own* Google Drive `appDataFolder` directly. The
aro.day Worker is only used to (1) redeem a one-time pairing code and (2)
mint short-lived, Pro-gated Google Drive access tokens. Your Google
refresh token never reaches this client — it stays encrypted on the
server. This is why the connector is open source: so you can verify it.

> Status: **v0.1** — read/write tasks, projects, notes, and habits.

## Install

```sh
npm install -g @aro.day/mcp     # or: npx -y @aro.day/mcp …
```

## Connect (one-time)

```sh
aroday-mcp connect
```

This opens your browser; approve the connection (you're already signed in
to aro.day) and you're done — no code to copy. The session token is stored
at `~/.config/aroday/session.json` (0600). AI integration is a **Pro
feature**.

## Use it from your AI client

Add the server to your client's MCP config. Example (Claude Desktop
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "aroday": { "command": "npx", "args": ["-y", "@aro.day/mcp"] }
  }
}
```

Then ask your client: *"what's on my plate today?"*, *"add a task to
outline the thesis intro due Friday"*, *"take a first pass at the RFC and
write it back as a note"*, *"log 3 glasses of water."*

## Tools

| Tool | What it does |
|---|---|
| `whoami` | connected account + project/task/habit counts |
| `list_projects` | all projects (habits are not a project — see `list_habits`) |
| `list_tasks` | tasks, filterable (project, status, overdue, scheduled-today, tag) |
| `get_task` | one task in full (incl. its notes + steps) |
| `search_tasks` | title substring search |
| `get_today_plan` | scheduled-today + overdue |
| `create_task` | create a task |
| `update_task` | patch title/priority/due/scheduled/estimate/tags |
| `complete_task` | mark done |
| `list_notes` | notes with a short preview, filterable (task, project, loose, text query) |
| `get_note` | one note in full |
| `list_note_templates` | built-in and your own note templates, with their sections |
| `create_note` | create a note on a task, on a project, or loose (marked AI-authored) |
| `create_note_from_template` | create a note from a template (meeting, decision, brief, daily, weekly, retro, research, or one of yours) |
| `append_note` | write a note back to a task (same as `create_note` with a task) |
| `set_note` | edit a note by id: text (re-renders structure), title, tags, pinned |
| `delete_note` | delete a note by id (restorable from aro.day's Deleted notes for 30 days) |
| `add_steps` | break a task into one or more steps (a one-level checklist) |
| `set_step_done` | check / uncheck a step (does not auto-complete the task) |
| `delete_step` | remove a step from a task |
| `create_project` | create a project |
| `list_habits` | habits with today's status: due, value vs target, done, skipped, week/month progress, current streak |
| `get_habit` | one habit in full with its recent day entries |
| `create_habit` | create a habit (check, count, timer, or limit; daily, set weekdays, N per week/month, or every N days) |
| `update_habit` | patch a habit's name, goal, unit, schedule, time, reminders, look |
| `log_habit` | record a day (default today): set or add to the amount, skip, note, or clear |
| `archive_habit` | archive a habit, or bring it back |
| `find_task_for_session` | rank existing tasks that match a session (repo/branch/hint) so you can log to the right one |

These are **deterministic** capabilities — the *intelligence* is your
AI client's; it decomposes, drafts, and decides, then expresses the
result through these tools.

## Teach your agent to log sessions

The tools are available, but your agent won't log work on its own unless
you nudge it. Paste this line into your `CLAUDE.md`, `AGENTS.md`, or Cursor
rules (kept in lockstep with the in-app snippet in Settings → Integrations):

> When you finish a meaningful chunk of work, call aro.day's
> `find_task_for_session` (pass repo, branch, and a short hint). If a task
> matches, confirm with me, then `append_note` a short summary. If nothing
> matches, ask before `create_task`.

`find_task_for_session` returns ranked candidate tasks plus
`needsConfirmation` (mirrors your "Ask before linking or creating" setting,
default on) — so the agent suggests the right task instead of guessing.

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `ARODAY_BASE_URL` | `https://aro.day` | point at a dev Worker |
| `ARODAY_CONFIG_DIR` | `~/.config/aroday` | where the session is stored |

## Limitations (v0.1)

- **Pro / Drive sync required** — free accounts have no server-reachable
  data to operate on.
- **No end-to-end encryption yet** — if you enabled encryption in
  aro.day, the connector can't read the blob (it errors clearly).
- **Last-write-wins** — the connector reads fresh, mutates, and writes;
  a concurrent edit from another device in the sub-second write window
  can be lost. Fine for single-user use; full conflict-merge is planned.
- **Habits need aro.day's new habits format** — if your data predates it,
  the habit tools ask you to open aro.day once so it upgrades your habits.
  "Today" is your computer's local date.
- **Built-in note templates are English** — headings and dates come out in
  English whatever your aro.day language is. Your own templates are used
  as-is.

## License

MIT — see [LICENSE](./LICENSE).
