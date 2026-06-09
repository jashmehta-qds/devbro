# devbro

A desktop productivity tool for developers. Connect your issue tracker, run Claude Code against your tickets, and track progress — all in one place.

![Electron](https://img.shields.io/badge/Electron-30-47848F?logo=electron) ![React](https://img.shields.io/badge/React-18-61DAFB?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)

---

## Features

- **Issue tracker integration** — Linear, Jira, and Asana supported. Connect once via Settings, switch anytime.
- **Integrated terminal** — opens Claude Code (`claude`) in the context of a specific ticket. Writes a `CLAUDE.md` with full ticket context: description, checklist, notes, progress, skills, team info, and git status.
- **Session resume** — reopening a ticket's terminal resumes the last Claude session (`--resume`).
- **Progress tracking** — after each session, Claude analyzes the git diff and appends a summary to the activity log with a realistic completion percentage.
- **ELI5** — explains any ticket in plain English using Claude (Haiku model).
- **Daily standup** — generates a standup draft from today's terminal sessions and status changes.
- **Project view** — milestones, team, issue counts, and linked local repos per project.
- **Analytics dashboard** — project deadlines sorted by nearest, today's coding time, weekly chart, in-progress tickets.
- **Skills system** — global guidelines, per-project playbooks, and per-ticket runnable commands all get injected into CLAUDE.md.
- **Collapsible sidebar** — `⌘B` to toggle between full sidebar and icon rail.
- **Tabs** — up to 8 issue tabs, project tabs, settings/dashboard tabs. `⌘1–8` to focus, `⌘W` to close, `⌘⇧[/]` to cycle.

---

## Requirements

- macOS (Windows/Linux untested)
- [Node.js](https://nodejs.org) 18+
- [Claude Code CLI](https://claude.ai/code) installed and authenticated (`claude` in your PATH)

---

## Setup

```bash
git clone <repo>
cd dev-dashboard
npm install
```

Create a `.env` file (optional — you can also configure keys in the app's Settings):

```env
# Linear (optional if configuring via Settings UI)
LINEAR_API_KEY=lin_api_...
LINEAR_TEAM_ID=your-team-id
```

Start the app:

```bash
npm run dev
```

---

## Connecting your issue tracker

Open **Settings** (sidebar footer or `⌘,`) → **Connections**.

### Linear
1. Go to [linear.app](https://linear.app) → Settings → API → Personal API keys
2. Create a key and paste it in devbro
3. Team ID is optional — leave blank to load all assigned issues
4. Click **Test & Connect**

### Jira
1. Go to [id.atlassian.com](https://id.atlassian.com) → Security → API tokens → Create token
2. Fill in: API Token, your Atlassian email, and your base URL (e.g. `https://yourco.atlassian.net`)
3. Project Key is optional (e.g. `ENG`) — leave blank to load all assigned issues
4. Click **Test & Connect**

### Asana
1. Go to [app.asana.com](https://app.asana.com) → My Profile → Apps → Personal Access Tokens
2. Create a token
3. Find your Workspace GID from the Asana URL or via `GET /workspaces`
4. Click **Test & Connect**

---

## Linking local repos

Open any project tab (`>>` next to a project in the sidebar) → scroll to **Local Repos** → select a folder from `~/Work/` and click Add.

The linked repo is used as the working directory when opening a terminal for a ticket in that project.

---

## How Claude sessions work

When you open a terminal for a ticket:

1. devbro writes a `CLAUDE.md` to the repo root with full context: ticket description, ELI5, checklist, notes, progress log, project info, team, milestones, global guidelines, project playbook, ticket commands, and git status.
2. Claude Code starts (`claude`) and automatically picks up `CLAUDE.md`.
3. On subsequent opens, devbro runs `claude --resume <session-id>` to continue the previous conversation.
4. When the terminal closes, Claude analyzes the git diff and appends a progress summary to the activity log.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘B` | Toggle sidebar collapse |
| `⌘K` | Command palette |
| `⌘T` | Open terminal for active ticket |
| `⌘W` | Close active tab |
| `⌘1–8` | Focus tab N |
| `⌘⇧]` / `⌘⇧[` | Next / previous tab |

---

## Build

```bash
npm run build   # compile only
npm run dist    # compile + package as .dmg
```

---

## Tech stack

| Layer | Tech |
|-------|------|
| Shell | Electron 30 |
| UI | React 18 + Tailwind CSS v3 |
| State | Zustand |
| Terminal | node-pty + xterm.js |
| Database | better-sqlite3 (SQLite) |
| Issue trackers | @linear/sdk, Jira REST API v3, Asana REST API v1 |
| AI | Claude Code CLI (progress, ELI5, standup) |

---

## Data & privacy

All data is stored locally in an SQLite database at `~/Library/Application Support/devbro/devbro.db`. Nothing is sent to any server except direct API calls to your configured issue tracker and the Claude Code CLI (which runs locally).
