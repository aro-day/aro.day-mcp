# aroday-mcp

Open-source [MCP](https://modelcontextprotocol.io) server for
[aro.day](https://aro.day) — let an AI client (Claude Desktop, Claude
Code, Codex, or any MCP client) **read and update your tasks**.

**Your task data never touches aro.day's servers.** The connector reads
and writes tasks in *your own* Google Drive `appDataFolder` directly. The
aro.day Worker is only used to (1) redeem a one-time pairing code and (2)
mint short-lived, Pro-gated Google Drive access tokens. Your Google
refresh token never reaches this client — it stays encrypted on the
server. This is why the connector is open source: so you can verify it.

> Status: **v0.1** — read/write tasks, projects, and notes.

## Install

```sh
npm install -g aroday-mcp     # or: npx aroday-mcp …
```

## Connect (one-time)

```sh
aroday-mcp connect
```

This opens your browser; approve the connection (you're already signed in
to aro.day) and you're done — no code to copy. The session token is stored
at `~/.config/aroday/session.json` (0600). AI integration is a **Pro
feature**.

No browser on this machine (SSH / headless)? Use the code fallback: in
aro.day open **Settings → AI integration**, then `aroday-mcp login --code <CODE>`.

## Use it from your AI client

Add the server to your client's MCP config. Example (Claude Desktop
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "aroday": { "command": "aroday-mcp" }
  }
}
```

Then ask your client: *"what's on my plate today?"*, *"add a task to
outline the thesis intro due Friday"*, *"take a first pass at the RFC and
write it back as a note."*

## Tools

| Tool | What it does |
|---|---|
| `whoami` | connected account + project/task counts |
| `list_projects` | all projects |
| `list_tasks` | tasks, filterable (project, status, overdue, scheduled-today, tag) |
| `get_task` | one task in full (incl. notes) |
| `search_tasks` | title substring search |
| `get_today_plan` | scheduled-today + overdue |
| `create_task` | create a task |
| `update_task` | patch title/priority/due/scheduled/estimate/tags |
| `complete_task` | mark done |
| `append_note` | write a note back to a task (marked AI-authored) |
| `create_project` | create a project |
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

## License

MIT — see [LICENSE](./LICENSE).
