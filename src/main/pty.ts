import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { getDb, getWorkDir } from './db'
import { CONFIG_FILE } from './configLog'
import { generateAndAppendProgress } from './progressSummary'

// Revert CLAUDE.md to its git-tracked state (if tracked), then append context.
// Prevents overwriting project rules that live in the committed CLAUDE.md.
function writeContextToClaude(claudePath: string, contextContent: string): void {
  const dir = path.dirname(claudePath)
  // Restore the committed version if the file is tracked
  try {
    execSync('git checkout HEAD -- CLAUDE.md', { cwd: dir, stdio: 'ignore' })
  } catch {
    // Not tracked — wipe any leftover content so we start clean
    try { fs.writeFileSync(claudePath, '', 'utf-8') } catch {}
  }
  const existing = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, 'utf-8') : ''
  const separator = existing.trimEnd().length > 0 ? '\n\n---\n\n' : ''
  fs.writeFileSync(claudePath, existing.trimEnd() + separator + contextContent, 'utf-8')
}

interface PtySession {
  process: pty.IPty
  ticketId: string
  cwd: string
  timeSessionId?: string
  gitStartSha?: string | null
  sessionStartedAt: number
  // Renderer is currently rendering this session. When false, we discard
  // output into a small ring buffer instead of sending IPC messages.
  attached: boolean
  // Recent output replayed on re-attach (bounded — see RING_MAX).
  ringBuffer: string[]
  ringBufferLen: number
  // Cleanup hooks invoked by killTerminal / cap-eviction so the onExit
  // handler doesn't double-process.
  cleanup?: () => void
}

// Hard cap. Each pty hosts a Claude subprocess which can balloon to multi-GB
// over a long conversation. Past versions left orphan sessions on every tab
// switch, which got us to 40GB. One active session at a time is enforced —
// switching to a different ticket and starting Claude there evicts the
// previous session (its progress summary still runs on exit).
function getMaxConcurrentSessions(): number {
  try {
    const row = getDb().prepare("SELECT value FROM app_config WHERE key = 'max_terminal_sessions'").get() as { value: string } | undefined
    const v = parseInt(row?.value ?? '1', 10)
    return Number.isFinite(v) && v >= 1 && v <= 5 ? v : 1
  } catch { return 1 }
}

// Bounded replay buffer used while a session is detached (renderer not
// rendering it). 16KB is plenty to recover the bottom of a screen on
// re-attach without retaining a whole conversation.
const RING_MAX = 16 * 1024

const sessions = new Map<string, PtySession>()

export function getSessionCwd(sessionId: string): string | null {
  return sessions.get(sessionId)?.cwd ?? null
}

export function getSessionTicketId(sessionId: string): string | null {
  return sessions.get(sessionId)?.ticketId ?? null
}

function getStoredClaudeSessionId(ticketId: string): string | null {
  try {
    const db = getDb()
    const row = db.prepare('SELECT session_id FROM ticket_claude_sessions WHERE ticket_id = ?').get(ticketId) as any
    return row?.session_id ?? null
  } catch {
    return null
  }
}

function storeClaudeSessionId(ticketId: string, sessionId: string): void {
  try {
    const db = getDb()
    db.prepare(`
      INSERT INTO ticket_claude_sessions (ticket_id, session_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(ticket_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at
    `).run(ticketId, sessionId, Date.now())
  } catch {}
}

// Claude stores sessions as ~/.claude/projects/<encoded-path>/<uuid>.jsonl
// Encoding: replace / with - and strip leading /
function detectLatestClaudeSession(cwd: string): string | null {
  try {
    const home = process.env.HOME || os.homedir()
    const encoded = cwd.replace(/\//g, '-').replace(/^-/, '')
    const projectDir = path.join(home, '.claude', 'projects', encoded)
    if (!fs.existsSync(projectDir)) return null

    const files = fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(projectDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length === 0) return null
    return files[0].name.replace('.jsonl', '')
  } catch {
    return null
  }
}

function sanitizeRepoName(name: string): string | null {
  if (/[^a-zA-Z0-9_\-.]/.test(name) || name.includes('..') || name.startsWith('/')) return null
  return name
}

function resolveCwd(ticketId: string, projectId: string | undefined, repoName: string | undefined): string {
  const home = process.env.HOME || os.homedir()
  const workDir = getWorkDir()
  if (repoName) {
    const safe = sanitizeRepoName(repoName)
    if (!safe) return home
    const repoPath = path.join(workDir, safe)
    return fs.existsSync(repoPath) ? repoPath : home
  }
  try {
    const db = getDb()
    // Look up by project, then fall back to ticket id (ponytail: same table,
    // ticket-scoped rows for issues without a project).
    const lookup = db.prepare('SELECT repo_name FROM project_repos WHERE linear_project_id = ? ORDER BY created_at ASC LIMIT 1')
    const row = (projectId ? lookup.get(projectId) as any : null) ?? lookup.get(ticketId) as any
    if (row?.repo_name) {
      const repoPath = path.join(workDir, row.repo_name)
      if (fs.existsSync(repoPath)) return repoPath
    }
  } catch {}
  const tmp = path.join(os.tmpdir(), `ticket-${ticketId}`)
  fs.mkdirSync(tmp, { recursive: true })
  return tmp
}

// Evict the oldest session if we'd exceed the cap. Used before spawning a
// new pty so we don't pile up Claude subprocesses across tabs.
function evictOldestIfAtCap(win: BrowserWindow): void {
  const maxSessions = getMaxConcurrentSessions()
  while (sessions.size >= maxSessions) {
    const oldestId = sessions.keys().next().value
    if (!oldestId) break
    console.log(`[pty] Concurrent cap hit (${sessions.size}/${maxSessions}) — evicting oldest session ${oldestId}`)
    const old = sessions.get(oldestId)
    try { old?.process.kill() } catch {}
    // Best-effort notify renderer; onExit will fire and do the rest.
    if (!win.isDestroyed()) {
      win.webContents.send('terminal:anyExit', { sessionId: oldestId, code: -1, evicted: true })
    }
    // onExit will sessions.delete; do it here too in case kill is silent.
    sessions.delete(oldestId)
  }
}

export async function createTerminal(
  sessionId: string,
  ticketId: string,
  projectId: string | undefined,
  repoName: string | undefined,
  contextContent: string,
  cols: number,
  rows: number,
  win: BrowserWindow
): Promise<void> {
  evictOldestIfAtCap(win)

  const home = process.env.HOME || os.homedir()
  const cwd = resolveCwd(ticketId, projectId, repoName)

  // Revert CLAUDE.md to committed state then append ticket context
  writeContextToClaude(path.join(cwd, 'CLAUDE.md'), contextContent)

  const storedSessionId = getStoredClaudeSessionId(ticketId)

  const shell = process.env.SHELL || '/bin/zsh'
  const proc = pty.spawn(shell, ['-l'], {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 30,
    cwd,
    env: { ...process.env as Record<string, string>, TERM: 'xterm-color', HOME: home }
  })

  // Capture git baseline so we can summarise what changed at exit
  let gitStartSha: string | null = null
  try {
    gitStartSha = execSync('git rev-parse HEAD', { cwd, timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim()
  } catch {}

  const sessionStartedAt = Date.now()
  const session: PtySession = {
    process: proc,
    ticketId,
    cwd,
    gitStartSha,
    sessionStartedAt,
    // Renderer will subscribe and call terminal:attach immediately. Default
    // true so we don't drop the first few bytes (shell prompt, etc).
    attached: true,
    ringBuffer: [],
    ringBufferLen: 0,
  }
  sessions.set(sessionId, session)

  // Start a time session for this terminal
  try {
    const db = getDb()
    const tsId = randomUUID()
    db.prepare('INSERT INTO time_sessions (id, ticket_id, started_at) VALUES (?, ?, ?)').run(tsId, ticketId, sessionStartedAt)
    session.timeSessionId = tsId
  } catch {}

  // Batched IPC. We buffer pty output for up to 16ms (or 64KB) and send as
  // one message. Sending every byte individually caused IPC queue + cons-
  // string growth that pushed the app to 40GB RAM.
  //
  // Array push + join on flush avoids V8 cons-string chains that the old
  // `dataBuffer += data` pattern can produce on hot output.
  const chunks: string[] = []
  let chunksLen = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const MAX_BUFFER = 65536

  const flushBuffer = () => {
    flushTimer = null
    if (chunksLen === 0) return
    const out = chunks.join('')
    chunks.length = 0
    chunksLen = 0
    if (win.isDestroyed()) return
    if (session.attached) {
      win.webContents.send(`terminal:data:${sessionId}`, out)
    } else {
      // Detached — drop into ring buffer for replay on re-attach.
      session.ringBuffer.push(out)
      session.ringBufferLen += out.length
      while (session.ringBufferLen > RING_MAX && session.ringBuffer.length > 1) {
        const dropped = session.ringBuffer.shift()!
        session.ringBufferLen -= dropped.length
      }
      // Single huge chunk over the cap — truncate.
      if (session.ringBufferLen > RING_MAX && session.ringBuffer.length === 1) {
        const only = session.ringBuffer[0]
        session.ringBuffer[0] = only.slice(only.length - RING_MAX)
        session.ringBufferLen = session.ringBuffer[0].length
      }
    }
  }

  proc.onData((data) => {
    chunks.push(data)
    chunksLen += data.length
    if (chunksLen >= MAX_BUFFER) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      flushBuffer()
    } else if (!flushTimer) {
      flushTimer = setTimeout(flushBuffer, 16)
    }
  })

  const launchTimer = setTimeout(() => {
    if (sessions.has(sessionId)) {
      const cmd = storedSessionId ? `claude --resume ${storedSessionId}\r` : `claude\r`
      proc.write(cmd)
    }
  }, 600)

  const detectTimer = setTimeout(() => {
    if (!storedSessionId) {
      const detected = detectLatestClaudeSession(cwd)
      if (detected) storeClaudeSessionId(ticketId, detected)
    }
  }, 4000)

  session.cleanup = () => {
    clearTimeout(launchTimer)
    clearTimeout(detectTimer)
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    // Drop any remaining buffered data — we're tearing down.
    chunks.length = 0
    chunksLen = 0
    session.ringBuffer.length = 0
    session.ringBufferLen = 0
  }

  proc.onExit(({ exitCode }) => {
    const endedAt = Date.now()
    session.cleanup?.()

    try {
      if (session.timeSessionId) {
        const db = getDb()
        db.prepare('UPDATE time_sessions SET ended_at = ? WHERE id = ?').run(endedAt, session.timeSessionId)
      }
    } catch {}

    sessions.delete(sessionId)
    if (!win.isDestroyed()) {
      win.webContents.send(`terminal:exit:${sessionId}`, exitCode)
      // Generic broadcast so any tab holding a stale terminalSessionId can clear it.
      win.webContents.send('terminal:anyExit', { sessionId, code: exitCode, evicted: false })
    }

    console.log(`[progress] Starting progress generation for ${ticketId}`)
    generateAndAppendProgress({
      ticketId,
      cwd: session.cwd,
      gitStartSha: session.gitStartSha ?? null,
      sessionStartedAt: session.sessionStartedAt,
      sessionEndedAt: endedAt,
    })
      .then((result) => {
        if (result && !win.isDestroyed()) {
          win.webContents.send('progress:updated', { ticketId, ...result })
        }
      })
      .catch((err) => console.error('[progress] Progress summary failed:', err))
  })
}

export function writeToTerminal(sessionId: string, data: string): void {
  const session = sessions.get(sessionId)
  if (session) session.process.write(data)
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId)
  if (session) session.process.resize(cols, rows)
}

export function killTerminal(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    try { session.process.kill() } catch {}
    // onExit will clean up; we don't sessions.delete here to avoid a race
    // where the exit handler sees no session and skips bookkeeping.
  }
}

export function killAllTerminals(): void {
  for (const [, session] of sessions.entries()) {
    try { session.process.kill() } catch {}
  }
  sessions.clear()
}

// Renderer signalling: pause IPC while the panel is unmounted (e.g. tab
// switched away) so we don't serialize and queue megabytes of pty output
// the user can't see. Output goes into a tiny ring buffer instead and is
// replayed on re-attach.
export function attachTerminal(sessionId: string, win: BrowserWindow): void {
  const session = sessions.get(sessionId)
  if (!session) return
  session.attached = true
  if (session.ringBufferLen > 0 && !win.isDestroyed()) {
    const replay = session.ringBuffer.join('')
    session.ringBuffer.length = 0
    session.ringBufferLen = 0
    win.webContents.send(`terminal:data:${sessionId}`, replay)
  }
}

export function detachTerminal(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  session.attached = false
}

// ============================================================
// Context building — pulls everything from SQLite + Linear cache
// ============================================================

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return '< 1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function relativeDate(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function getGitInfo(repoPath: string): { branch: string | null; isDirty: boolean; aheadBy: number; behindBy: number } {
  const { execSync } = require('child_process')
  try {
    const branch = execSync('git branch --show-current', { cwd: repoPath, timeout: 2000 }).toString().trim()
    const status = execSync('git status --porcelain', { cwd: repoPath, timeout: 2000 }).toString().trim()
    const isDirty = status.length > 0
    let aheadBy = 0, behindBy = 0
    try { aheadBy = parseInt(execSync('git rev-list --count @{u}..HEAD', { cwd: repoPath, timeout: 2000 }).toString().trim()) || 0 } catch {}
    try { behindBy = parseInt(execSync('git rev-list --count HEAD..@{u}', { cwd: repoPath, timeout: 2000 }).toString().trim()) || 0 } catch {}
    return { branch, isDirty, aheadBy, behindBy }
  } catch {
    return { branch: null, isDirty: false, aheadBy: 0, behindBy: 0 }
  }
}

/**
 * Build the full CLAUDE.md content for a ticket.
 * Pulls from: SQLite (notes, checklists, skills, progress, branches, eli5, status_changes, time_sessions, project_details_cache, project_repos, project_skills, global_skills) + global-context.md
 */
export async function buildContextContent(
  ticketId: string,
  issue: any,
  cwd?: string
): Promise<string> {
  const db = getDb()
  const lines: string[] = []

  const projectId = issue?.project?.id as string | undefined
  const home = process.env.HOME || os.homedir()

  // Look up all the per-ticket / per-project data
  let notes: any, checklist: any, ticketSkills: any[] = [], projectSkills: any[] = [], globalSkills: any[] = []
  let progress: any, branchRow: any, eli5: any, statusHistory: any[] = [], timeSessions: any[] = []
  let projectDetails: any = null
  let projectRepos: any[] = []

  try { notes = db.prepare('SELECT content FROM notes WHERE ticket_id = ?').get(ticketId) } catch {}
  try {
    const cl = db.prepare('SELECT items FROM checklists WHERE ticket_id = ?').get(ticketId) as any
    if (cl) checklist = JSON.parse(cl.items)
  } catch {}
  try { ticketSkills = db.prepare('SELECT name, command FROM skills WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId) as any[] } catch {}
  try {
    // project_skills table may not exist yet on first migration — guard
    if (projectId) projectSkills = db.prepare('SELECT name, command FROM project_skills WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as any[]
  } catch {}
  try { globalSkills = db.prepare('SELECT name, command FROM global_skills ORDER BY created_at ASC').all() as any[] } catch {}
  try { progress = db.prepare('SELECT percent, log FROM progress WHERE ticket_id = ?').get(ticketId) } catch {}
  try { branchRow = db.prepare('SELECT branch_name FROM ticket_branches WHERE ticket_id = ?').get(ticketId) } catch {}
  try { eli5 = db.prepare('SELECT content FROM eli5_cache WHERE ticket_id = ?').get(ticketId) } catch {}
  try { statusHistory = db.prepare('SELECT from_state, to_state, changed_at FROM status_changes WHERE ticket_id = ? ORDER BY changed_at DESC LIMIT 5').all(ticketId) as any[] } catch {}
  try { timeSessions = db.prepare('SELECT started_at, ended_at FROM time_sessions WHERE ticket_id = ?').all(ticketId) as any[] } catch {}
  try {
    if (projectId) {
      const row = db.prepare('SELECT data FROM project_details_cache WHERE id = ?').get(projectId) as any
      if (row) projectDetails = JSON.parse(row.data)
    }
  } catch {}
  try {
    if (projectId) {
      projectRepos = db.prepare('SELECT repo_name FROM project_repos WHERE linear_project_id = ? ORDER BY created_at ASC').all(projectId) as any[]
    }
  } catch {}

  // Compute totals
  const totalTimeMs = timeSessions.reduce((sum, s) => {
    const end = s.ended_at ?? Date.now()
    return sum + (end - s.started_at)
  }, 0)

  // === HEADER ===
  lines.push(`# ${issue.identifier}: ${issue.title}`)
  lines.push('')

  // === Identity strip ===
  const metaParts: string[] = []
  metaParts.push(`**Status:** ${issue.state?.name || 'Unknown'}`)
  metaParts.push(`**Priority:** ${issue.priorityLabel || 'No Priority'}`)
  if (issue.assignee?.name) metaParts.push(`**Assignee:** ${issue.assignee.name}`)
  lines.push(metaParts.join(' | '))

  const metaParts2: string[] = []
  if (issue.labels?.length > 0) metaParts2.push(`**Labels:** ${issue.labels.map((l: any) => l.name).join(', ')}`)
  if (issue.url) metaParts2.push(`**URL:** ${issue.url}`)
  if (metaParts2.length > 0) lines.push(metaParts2.join(' | '))

  const branch = branchRow?.branch_name
  const metaParts3: string[] = []
  if (branch) metaParts3.push(`**Branch:** \`${branch}\``)
  if (totalTimeMs > 0) metaParts3.push(`**Time Spent:** ${formatDuration(totalTimeMs)}`)
  if (progress) metaParts3.push(`**Progress:** ${progress.percent}%`)
  if (metaParts3.length > 0) lines.push(metaParts3.join(' | '))

  // Git status, if we have a cwd that's a real repo
  if (cwd) {
    const gitInfo = getGitInfo(cwd)
    if (gitInfo.branch) {
      const gitParts: string[] = [`**Git Branch:** \`${gitInfo.branch}\``]
      if (gitInfo.isDirty) gitParts.push('dirty')
      if (gitInfo.aheadBy > 0) gitParts.push(`${gitInfo.aheadBy} ahead`)
      if (gitInfo.behindBy > 0) gitParts.push(`${gitInfo.behindBy} behind`)
      lines.push(gitParts.join(' • '))
    }
  }

  lines.push('')

  // === Description ===
  if (issue.description) {
    lines.push('## Description')
    lines.push(issue.description)
    lines.push('')
  }

  // === ELI5 ===
  if (eli5?.content) {
    lines.push('## ELI5 (Plain English)')
    lines.push(eli5.content)
    lines.push('')
  }

  // === Project context ===
  if (issue.project) {
    lines.push(`## Project: ${issue.project.name}`)
    if (projectDetails?.description) lines.push(projectDetails.description)
    else if (issue.project.description) lines.push(issue.project.description)
    lines.push('')

    if (projectDetails) {
      const projMeta: string[] = []
      if (projectDetails.lead?.name) projMeta.push(`**Lead:** ${projectDetails.lead.name}`)
      if (projectDetails.members?.length > 0) {
        projMeta.push(`**Team:** ${projectDetails.members.map((m: any) => m.name).join(', ')}`)
      }
      if (projectDetails.state) projMeta.push(`**State:** ${projectDetails.state}`)
      if (projectDetails.targetDate) projMeta.push(`**Target:** ${projectDetails.targetDate}`)
      if (projMeta.length > 0) {
        lines.push(projMeta.join(' | '))
        lines.push('')
      }
      if (projectDetails.content) {
        lines.push('### Project Description')
        lines.push(projectDetails.content)
        lines.push('')
      }
      if (projectDetails.issueStateCounts && Object.keys(projectDetails.issueStateCounts).length > 0) {
        const counts = Object.entries(projectDetails.issueStateCounts).map(([k, v]) => `${v} ${k}`).join(' / ')
        lines.push(`**Issue Breakdown:** ${counts} (${projectDetails.totalIssues} total)`)
        lines.push('')
      }
      if (projectDetails.milestones?.length > 0) {
        lines.push('### Milestones')
        for (const m of projectDetails.milestones) {
          const due = m.targetDate ? ` (due ${m.targetDate})` : ''
          lines.push(`- **${m.name}**${due}`)
          if (m.description) lines.push(`  ${m.description.replace(/\n/g, '\n  ')}`)
        }
        lines.push('')
      }
    }

    if (projectRepos.length > 0) {
      lines.push(`**Repos:** ${projectRepos.map((r: any) => `${getWorkDir()}/${r.repo_name}`).join(', ')}`)
      lines.push('')
    }
  }

  // === Parent ticket ===
  if (issue.parent) {
    lines.push('## Parent Ticket')
    lines.push(`${issue.parent.identifier}: ${issue.parent.title}`)
    lines.push('')
  }

  // === Checklist ===
  if (checklist?.length > 0) {
    lines.push('## Checklist')
    for (const item of checklist) {
      const mark = item.done ? '[x]' : '[ ]'
      lines.push(`- ${mark} ${item.text}`)
    }
    lines.push('')
  }

  // === Global Guidelines (markdown docs — always-on knowledge) ===
  if (globalSkills.length > 0) {
    lines.push('## Global Guidelines')
    for (const g of globalSkills) {
      lines.push(`### ${g.name}`)
      lines.push(g.command)
      lines.push('')
    }
  }

  // === Project Playbook (markdown docs — knowledge for this project) ===
  if (projectSkills.length > 0) {
    lines.push('## Project Playbook')
    for (const g of projectSkills) {
      lines.push(`### ${g.name}`)
      lines.push(g.command)
      lines.push('')
    }
  }

  // === Ticket Commands (runnable shortcuts) ===
  if (ticketSkills.length > 0) {
    lines.push('## Ticket Commands')
    lines.push('Commands the developer has saved as shortcuts for this ticket:')
    for (const s of ticketSkills) lines.push(`- **${s.name}:** \`${s.command}\``)
    lines.push('')
  }

  // === Status history ===
  if (statusHistory.length > 0) {
    lines.push('## Status History (Recent)')
    for (const sc of statusHistory) {
      const from = sc.from_state ? `${sc.from_state} → ` : ''
      lines.push(`- ${from}${sc.to_state} (${relativeDate(sc.changed_at)})`)
    }
    lines.push('')
  }

  // === User notes ===
  if (notes?.content && notes.content.trim()) {
    lines.push('## My Notes')
    lines.push(notes.content.trim())
    lines.push('')
  }

  // === Progress log ===
  if (progress?.log && progress.log.trim()) {
    lines.push('## Progress Log')
    lines.push(progress.log.trim())
    lines.push('')
  }

  // === Global configuration ===
  try {
    const globalConfig = fs.readFileSync(CONFIG_FILE, 'utf-8')
    lines.push('## Global Workspace Configuration')
    lines.push(globalConfig)
    lines.push('')
  } catch {}

  // === Standing instructions ===
  lines.push('---')
  lines.push('You are Claude Code, assisting the developer with this Linear ticket. The working directory is set to the project repo. Refer to the metadata, checklist, and available commands above to plan your work. Use the listed skills/commands when appropriate. Mark checklist items off as you complete them by suggesting `# checklist: done <item text>` in your responses.')
  lines.push('')

  void home // unused but kept for potential expansion

  return lines.join('\n')
}
