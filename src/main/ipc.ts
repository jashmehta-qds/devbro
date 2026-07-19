import { ipcMain, BrowserWindow, Notification } from 'electron'
import { randomUUID as uuidv4 } from 'crypto'
import { getDb } from './db'
import { getActiveConnector, createConnector, maskConfig, invalidateConnectorCache } from './connectors/index'
import { getWorkDir } from './db'
import {
  createTerminal,
  writeToTerminal,
  resizeTerminal,
  killTerminal,
  attachTerminal,
  detachTerminal,
  buildContextContent,
  getSessionCwd,
  reinjectContext,
  setPendingContextOverride
} from './pty'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { writeGlobalConfigFile } from './configLog'
import { runClaudeStreaming } from './claudeCli'
import * as analytics from './analytics'
import * as github from './github'
import { getLinearClient } from './linear'
import * as skills from './skills'

let handlersRegistered = false
let currentWin: BrowserWindow | null = null
let pollIntervalId: ReturnType<typeof setInterval> | null = null

// Notification state management
let cachedViewerId: string | null = null
let lastKnownIssues: Map<string, any> = new Map()
let deadlineNotified: Set<string> = new Set()

export function registerIpcHandlers(win: BrowserWindow): void {
  currentWin = win
  if (handlersRegistered) return
  handlersRegistered = true
  // ============================================================
  // Connector management handlers
  // ============================================================
  ipcMain.handle('connector:getAll', async () => {
    const db = getDb()
    const rows = db.prepare('SELECT id, enabled, config FROM connectors').all() as any[]
    return rows.map(r => ({ id: r.id, enabled: !!r.enabled, config: maskConfig(JSON.parse(r.config || '{}')) }))
  })

  ipcMain.handle('connector:getActive', async () => {
    const db = getDb()
    const row = db.prepare('SELECT id, config FROM connectors WHERE enabled = 1 LIMIT 1').get() as any
    if (!row) return { id: 'linear', config: {} }
    return { id: row.id, config: maskConfig(JSON.parse(row.config || '{}')) }
  })

  ipcMain.handle('connector:setActive', async (_event, type: string, config: Record<string, string>) => {
    const db = getDb()
    db.prepare('UPDATE connectors SET enabled = 0').run()
    db.prepare('INSERT OR REPLACE INTO connectors (id, enabled, config) VALUES (?, 1, ?)').run(type, JSON.stringify(config))
    invalidateConnectorCache()
  })

  ipcMain.handle('connector:test', async (_event, type: string, config: Record<string, string>) => {
    try {
      const connector = createConnector(type, config)
      return connector.testConnection()
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Unknown error' }
    }
  })

  // ============================================================
  // Issue tracker handlers (routes through active connector)
  // ============================================================
  ipcMain.handle('linear:getProjects', async () => {
    return getActiveConnector().fetchProjects()
  })

  ipcMain.handle('linear:getIssues', async (_event, projectId: string) => {
    if (typeof projectId !== 'string') throw new Error('Invalid projectId')
    return getActiveConnector().fetchIssues(projectId)
  })

  ipcMain.handle('linear:getIssue', async (_event, issueId: string) => {
    if (typeof issueId !== 'string') throw new Error('Invalid issueId')
    return getActiveConnector().fetchIssue(issueId)
  })

  ipcMain.handle('linear:getIssueStates', async (_event, issueId: string) => {
    if (typeof issueId !== 'string') throw new Error('Invalid issueId')
    return getActiveConnector().fetchIssueStates(issueId)
  })

  ipcMain.handle('linear:getCycles', async () => {
    const connector = getActiveConnector()
    if (!connector.fetchCycles) return []
    return connector.fetchCycles()
  })

  ipcMain.handle('linear:updateStatus', async (_event, issueId: string, stateId: string, fromStateName: string, toStateName: string) => {
    if (typeof issueId !== 'string' || typeof stateId !== 'string') throw new Error('Invalid args')
    await getActiveConnector().updateIssueState(issueId, stateId)
    const db = getDb()
    db.prepare('INSERT INTO status_changes (id, ticket_id, from_state, to_state, changed_at) VALUES (?, ?, ?, ?, ?)').run(
      uuidv4(), issueId, fromStateName || null, toStateName, Date.now()
    )
  })

  // ============================================================
  // Cache handlers
  // ============================================================
  ipcMain.handle('cache:getProjects', async () => {
    const db = getDb()
    const rows = db.prepare('SELECT data FROM projects_cache').all() as { data: string }[]
    return rows.map((r) => JSON.parse(r.data))
  })

  ipcMain.handle('cache:saveProjects', async (_event, projects: any[]) => {
    const db = getDb()
    const now = Date.now()
    const upsert = db.prepare(`
      INSERT INTO projects_cache (id, data, cached_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at
    `)
    const insertMany = db.transaction((items: any[]) => {
      for (const p of items) {
        upsert.run(p.id, JSON.stringify(p), now)
      }
    })
    insertMany(projects)
  })

  ipcMain.handle('cache:getIssues', async (_event, projectId: string) => {
    const db = getDb()
    const rows = db.prepare('SELECT data FROM issues_cache WHERE project_id = ?').all(projectId) as { data: string }[]
    return rows.map((r) => JSON.parse(r.data))
  })

  ipcMain.handle('cache:saveIssues', async (_event, projectId: string, issues: any[]) => {
    const db = getDb()
    const now = Date.now()
    const upsert = db.prepare(`
      INSERT INTO issues_cache (id, project_id, data, cached_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, data = excluded.data, cached_at = excluded.cached_at
    `)
    const insertMany = db.transaction((items: any[]) => {
      for (const issue of items) {
        upsert.run(issue.id, projectId, JSON.stringify(issue), now)
      }
    })
    insertMany(issues)
  })

  // ============================================================
  // Notes handlers
  // ============================================================
  ipcMain.handle('notes:get', async (_event, ticketId: string) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM notes WHERE ticket_id = ?').get(ticketId)
    return row || null
  })

  ipcMain.handle('notes:save', async (_event, ticketId: string, content: string) => {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM notes WHERE ticket_id = ?').get(ticketId) as any
    const now = Date.now()

    if (existing) {
      db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE ticket_id = ?').run(
        content,
        now,
        ticketId
      )
      return db.prepare('SELECT * FROM notes WHERE ticket_id = ?').get(ticketId)
    } else {
      const id = uuidv4()
      db.prepare('INSERT INTO notes (id, ticket_id, content, updated_at) VALUES (?, ?, ?, ?)').run(
        id,
        ticketId,
        content,
        now
      )
      return db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
    }
  })

  // ============================================================
  // Checklist handlers
  // ============================================================
  ipcMain.handle('checklist:get', async (_event, ticketId: string) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM checklists WHERE ticket_id = ?').get(ticketId) as any
    if (!row) return null
    return {
      ...row,
      items: JSON.parse(row.items)
    }
  })

  ipcMain.handle('checklist:save', async (_event, ticketId: string, items: any[]) => {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM checklists WHERE ticket_id = ?').get(ticketId) as any
    const now = Date.now()
    const itemsJson = JSON.stringify(items)

    if (existing) {
      db.prepare('UPDATE checklists SET items = ?, updated_at = ? WHERE ticket_id = ?').run(
        itemsJson,
        now,
        ticketId
      )
    } else {
      const id = uuidv4()
      db.prepare(
        'INSERT INTO checklists (id, ticket_id, items, updated_at) VALUES (?, ?, ?, ?)'
      ).run(id, ticketId, itemsJson, now)
    }

    const row = db.prepare('SELECT * FROM checklists WHERE ticket_id = ?').get(ticketId) as any
    return { ...row, items: JSON.parse(row.items) }
  })

  // ============================================================
  // Skills handlers
  // ============================================================
  ipcMain.handle('skills:list', async (_event, ticketId: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM skills WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId)
  })

  ipcMain.handle('skills:add', async (_event, ticketId: string, name: string, command: string) => {
    const db = getDb()
    const id = uuidv4()
    const now = Date.now()
    db.prepare('INSERT INTO skills (id, ticket_id, name, command, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      ticketId,
      name,
      command,
      now
    )
    return db.prepare('SELECT * FROM skills WHERE id = ?').get(id)
  })

  ipcMain.handle('skills:delete', async (_event, skillId: string) => {
    const db = getDb()
    db.prepare('DELETE FROM skills WHERE id = ?').run(skillId)
  })

  // ============================================================
  // Progress handlers
  // ============================================================
  ipcMain.handle('progress:get', async (_event, ticketId: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM progress WHERE ticket_id = ?').get(ticketId) || null
  })

  ipcMain.handle('progress:generateManual', async (_event, ticketId: string) => {
    const { execSync } = await import('child_process')
    const db = getDb()

    // Get ticket + project info
    const issueRow = db.prepare('SELECT data FROM issues_cache WHERE id = ?').get(ticketId) as any
    let projectId: string | undefined
    let issueTitle = ''
    let issueIdentifier = ''
    let issueDescription = ''
    if (issueRow) {
      try {
        const d = JSON.parse(issueRow.data)
        projectId = d.project?.id
        issueTitle = d.title ?? ''
        issueIdentifier = d.identifier ?? ''
        issueDescription = d.description ?? ''
      } catch {}
    }

    // Resolve cwd
    const home = process.env.HOME || os.homedir()
    let cwd = home
    if (projectId) {
      try {
        const row = db.prepare('SELECT repo_name FROM project_repos WHERE linear_project_id = ? ORDER BY created_at ASC LIMIT 1').get(projectId) as any
        if (row?.repo_name) {
          const p = path.join(getWorkDir(), row.repo_name)
          if (fs.existsSync(p)) cwd = p
        }
      } catch {}
    }

    // Gather git activity
    const safeExec = (cmd: string) => {
      try { return execSync(cmd, { cwd, timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim() } catch { return '' }
    }
    const commitLog = safeExec('git log --since="1 week ago" --oneline --no-decorate')
    const diffStat = safeExec('git diff HEAD --stat')
    const uncommitted = safeExec('git diff --stat') + '\n' + safeExec('git diff --staged --stat')
    const filesChanged = safeExec('git diff HEAD --name-only').split('\n').filter(Boolean)

    const prev = db.prepare('SELECT percent, log FROM progress WHERE ticket_id = ?').get(ticketId) as any
    const prevPercent = prev?.percent ?? 0
    const prevLog = prev?.log ?? ''

    const prompt = `You are writing a detailed progress log entry for a developer's ticket.

Ticket: ${issueIdentifier} — ${issueTitle}
Description: ${issueDescription.slice(0, 500)}
Current progress: ${prevPercent}%

Previous log (most recent first):
${prevLog.split('\n').slice(0, 5).join('\n') || '(none)'}

Recent commits:
${commitLog || '(none)'}

Files changed (${filesChanged.length}):
${filesChanged.slice(0, 20).join('\n') || '(none)'}

Diff stat:
${(diffStat + '\n' + uncommitted).slice(0, 2000) || '(none)'}

Write a detailed progress note in EXACTLY this JSON format (no markdown fences, just JSON):
{"summary": "<4-6 sentences: what was built/changed, which files/functions were touched, what works now, what's next>", "newPercent": <0-100>}

Rules for newPercent:
- Be REALISTIC. If the diff shows a complete major feature was implemented, jump significantly (e.g. 20-40 points).
- If just started: 5-15%. If half done: 40-60%. If feature complete but untested: 70-80%. If tested and working: 85-95%. Only use 100% if truly done.
- Never decrease. Current is ${prevPercent}% — only go up if real work happened.
- If commits show multiple features completed, reflect that in the percentage jump.`

    let summary: string
    let newPercent: number

    try {
      const callId = uuidv4()
      const result = await runClaudeStreaming({ prompt, callId, win: currentWin, cwd })
      if (!result.ok) throw new Error('Claude CLI returned non-zero exit code')
      const output = result.output
      const jsonMatch = output.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : 'Progress updated.'
        newPercent = Math.max(prevPercent, Math.min(100, parseInt(String(parsed.newPercent)) || prevPercent))
      } else {
        summary = output.slice(0, 200)
        newPercent = prevPercent
      }
    } catch (err) {
      console.error('[progress] Manual generate failed:', err)
      throw err
    }

    // Save to DB
    const pad = (n: number) => String(n).padStart(2, '0')
    const d = new Date()
    const ts = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    const entry = `[${ts}] (${prevPercent}% → ${newPercent}%) ${summary}`
    const newLog = prevLog ? `${entry}\n${prevLog}` : entry
    const now = Date.now()

    if (prev) {
      db.prepare('UPDATE progress SET percent = ?, log = ?, updated_at = ? WHERE ticket_id = ?').run(newPercent, newLog, now, ticketId)
    } else {
      const { randomUUID } = require('crypto')
      db.prepare('INSERT INTO progress (id, ticket_id, percent, log, updated_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), ticketId, newPercent, newLog, now)
    }

    if (currentWin && !currentWin.isDestroyed()) currentWin.webContents.send('progress:updated', { ticketId, summary, newPercent })
    return { summary, newPercent }
  })

  ipcMain.handle('progress:update', async (_event, ticketId: string, percent: number, log?: string) => {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM progress WHERE ticket_id = ?').get(ticketId) as any
    const now = Date.now()

    if (existing) {
      db.prepare('UPDATE progress SET percent = ?, log = ?, updated_at = ? WHERE ticket_id = ?').run(
        percent,
        log ?? existing.log,
        now,
        ticketId
      )
    } else {
      const id = uuidv4()
      db.prepare(
        'INSERT INTO progress (id, ticket_id, percent, log, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, ticketId, percent, log ?? '', now)
    }

    return db.prepare('SELECT * FROM progress WHERE ticket_id = ?').get(ticketId)
  })

  // ============================================================
  // Project config handlers
  // ============================================================
  ipcMain.handle('projectConfig:getAll', async () => {
    const db = getDb()
    return db.prepare('SELECT * FROM project_configs ORDER BY linear_project_name').all()
  })

  ipcMain.handle(
    'projectConfig:save',
    async (
      _event,
      linearProjectId: string,
      linearProjectName: string,
      githubRepo: string,
      defaultBranch: string,
      localRepo: string
    ) => {
      const db = getDb()
      const now = Date.now()
      db.prepare(`
        INSERT INTO project_configs (linear_project_id, linear_project_name, github_repo, default_branch, local_repo, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(linear_project_id) DO UPDATE SET
          linear_project_name = excluded.linear_project_name,
          github_repo = excluded.github_repo,
          default_branch = excluded.default_branch,
          local_repo = excluded.local_repo,
          updated_at = excluded.updated_at
      `).run(linearProjectId, linearProjectName, githubRepo, defaultBranch, localRepo ?? '', now)
      writeGlobalConfigFile(db)
      return db.prepare('SELECT * FROM project_configs WHERE linear_project_id = ?').get(linearProjectId)
    }
  )

  // ============================================================
  // App config handlers
  // ============================================================
  ipcMain.handle('appConfig:get', async (_event, key: string) => {
    const db = getDb()
    const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as any
    return row?.value ?? null
  })

  ipcMain.handle('appConfig:set', async (_event, key: string, value: string) => {
    const db = getDb()
    db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(key, value)
  })

  ipcMain.handle('workDir:get', async () => getWorkDir())

  // Repos handler — scans work directory for folders
  // ============================================================
  ipcMain.handle('repos:list', async () => {
    const workDir = getWorkDir()
    try {
      const entries = fs.readdirSync(workDir, { withFileTypes: true }) as any[]
      return entries
        .filter((e: any) => e.isDirectory())
        .map((e: any) => e.name)
        .sort()
    } catch {
      return []
    }
  })

  ipcMain.handle('projectConfig:delete', async (_event, linearProjectId: string) => {
    const db = getDb()
    db.prepare('DELETE FROM project_configs WHERE linear_project_id = ?').run(linearProjectId)
    writeGlobalConfigFile(db)
  })

  // ============================================================
  // Project repos handlers (multiple repos per project)
  // ============================================================
  ipcMain.handle('projectRepos:list', async (_event, linearProjectId: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM project_repos WHERE linear_project_id = ? ORDER BY created_at ASC').all(linearProjectId)
  })

  ipcMain.handle('projectRepos:add', async (_event, linearProjectId: string, repoName: string) => {
    const db = getDb()
    const existing = db.prepare('SELECT id FROM project_repos WHERE linear_project_id = ? AND repo_name = ?').get(linearProjectId, repoName)
    if (existing) return existing
    const id = uuidv4()
    db.prepare('INSERT INTO project_repos (id, linear_project_id, repo_name, created_at) VALUES (?, ?, ?, ?)').run(id, linearProjectId, repoName, Date.now())
    writeGlobalConfigFile(db)
    return db.prepare('SELECT * FROM project_repos WHERE id = ?').get(id)
  })

  ipcMain.handle('projectRepos:remove', async (_event, repoId: string) => {
    const db = getDb()
    db.prepare('DELETE FROM project_repos WHERE id = ?').run(repoId)
    writeGlobalConfigFile(db)
  })

  ipcMain.handle('projectRepos:getForProject', async (_event, linearProjectId: string) => {
    const db = getDb()
    return db.prepare('SELECT repo_name FROM project_repos WHERE linear_project_id = ? ORDER BY created_at ASC').all(linearProjectId).map((r: any) => r.repo_name)
  })

  // ============================================================
  // Ticket branch handlers
  // ============================================================
  ipcMain.handle('ticketBranch:get', async (_event, ticketId: string) => {
    const db = getDb()
    const row = db.prepare('SELECT branch_name FROM ticket_branches WHERE ticket_id = ?').get(ticketId) as any
    return row ? row.branch_name : null
  })

  ipcMain.handle('ticketBranch:save', async (_event, ticketId: string, branchName: string) => {
    const db = getDb()
    const now = Date.now()
    db.prepare(`
      INSERT INTO ticket_branches (ticket_id, branch_name, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(ticket_id) DO UPDATE SET
        branch_name = excluded.branch_name,
        updated_at = excluded.updated_at
    `).run(ticketId, branchName, now)
    writeGlobalConfigFile(db)
  })

  // ============================================================
  // ELI5 handlers
  // ============================================================
  ipcMain.handle('eli5:get', async (_event, ticketId: string) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM eli5_cache WHERE ticket_id = ?').get(ticketId) as any
    return row ? row.content : null
  })

  ipcMain.handle('checklist:generate', async (_event, ticketId: string, title: string, description: string) => {
    const prompt = `You are helping a developer break down an engineering ticket into a short actionable checklist.\n\nTitle: ${title}\n\nDescription: ${description || 'No description provided'}\n\nOutput ONLY a plain list of 3-8 checklist items, one per line, each starting with "- ". No preamble, no headings, no numbering. Keep each item short (max ~80 chars) and imperative (e.g. "- Add unit tests for X").`
    const callId = uuidv4()
    try {
      const result = await runClaudeStreaming({ prompt, callId, win: currentWin })
      if (!result.ok) return null
      const items = result.output
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.startsWith('- '))
        .map((l: string) => l.slice(2).trim())
        .filter((l: string) => l.length > 0 && l.length < 200)
      if (items.length === 0) return null
      return items
    } catch (err) {
      console.error('[checklist:generate] failed:', err)
      return null
    }
  })

  ipcMain.handle('eli5:generate', async (_event, ticketId: string, title: string, description: string) => {
    const prompt = `Explain this engineering ticket in simple terms (ELI5 - Explain Like I'm 5):\n\nTitle: ${title}\n\nDescription: ${description || 'No description provided'}\n\nKeep it under 150 words, friendly and clear.`

    const callId = uuidv4()
    let content = ''
    try {
      const result = await runClaudeStreaming({ prompt, callId, win: currentWin })
      if (!result.ok) return null
      content = result.output
      console.log('[eli5] Generated via Claude CLI (haiku)')
    } catch (err) {
      console.error('[eli5] Claude CLI failed:', err)
      return null
    }

    const db = getDb()
    db.prepare(
      'INSERT OR REPLACE INTO eli5_cache (ticket_id, content, created_at) VALUES (?, ?, ?)'
    ).run(ticketId, content, Date.now())

    return content
  })

  const collectDiffs = (repoPaths: string[]): string => {
    const { execSync } = require('child_process')
    const os = require('os')
    const parts: string[] = []
    for (const rp of repoPaths) {
      const expanded = rp.replace(/^~/, os.homedir())
      try {
        const out = execSync('git diff HEAD --', { cwd: expanded, timeout: 10000, maxBuffer: 2 * 1024 * 1024 }).toString()
        if (out.trim()) parts.push(`# repo: ${rp.split('/').pop()}\n${out}`)
      } catch { /* skip repo on error */ }
    }
    return parts.join('\n\n')
  }

  ipcMain.handle('eli5:explainDiff', async (_event, ticketId: string, issue: any, repoPaths: string | string[]) => {
    const paths = Array.isArray(repoPaths) ? repoPaths : [repoPaths]
    const diff = collectDiffs(paths) || '(Could not fetch diff)'
    const prompt = `Explain the following code changes in plain English (what was modified and why). Keep it concise (under 200 words).\n\nDiff:\n\`\`\`\n${diff}\n\`\`\``

    const callId = uuidv4()
    try {
      const result = await runClaudeStreaming({ prompt, callId, win: currentWin })
      if (!result.ok) return null
      return result.output
    } catch (err) {
      console.error('[eli5:explainDiff] Claude CLI failed:', err)
      return null
    }
  })

  ipcMain.handle('eli5:risks', async (_event, ticketId: string, issue: any, repoPaths?: string | string[]) => {
    const description = issue?.description || ''
    const paths = repoPaths ? (Array.isArray(repoPaths) ? repoPaths : [repoPaths]) : []
    const diff = paths.length > 0 ? collectDiffs(paths) : ''

    const diffSection = diff ? `\n\nCode changes:\n\`\`\`\n${diff}\n\`\`\`` : ''
    const prompt = `You are a senior engineer reviewing this work. Identify potential risks, edge cases, or concerns that should be considered. Keep it concise (under 200 words).\n\nDescription:\n${description || '(no description)'}${diffSection}`

    const callId = uuidv4()
    try {
      const result = await runClaudeStreaming({ prompt, callId, win: currentWin })
      if (!result.ok) return null
      return result.output
    } catch (err) {
      console.error('[eli5:risks] Claude CLI failed:', err)
      return null
    }
  })

  ipcMain.handle('eli5:draftPr', async (_event, ticketId: string, issue: any, repoPaths?: string | string[]) => {
    const description = issue?.description || ''
    const title = issue?.title || ''
    const paths = repoPaths ? (Array.isArray(repoPaths) ? repoPaths : [repoPaths]) : []
    const diff = paths.length > 0 ? collectDiffs(paths) : ''

    const diffSection = diff ? `\n\nCode changes:\n\`\`\`\n${diff.slice(0, 6000)}\n\`\`\`` : ''
    const prompt = `Draft a professional GitHub PR description for this work. Include:
- A Summary section (2-3 sentences explaining what was done)
- A Test plan checklist (3-5 items describing how to test)

Ticket: ${title}
Description: ${description}${diffSection}`

    const callId = uuidv4()
    try {
      const result = await runClaudeStreaming({ prompt, callId, win: currentWin })
      if (!result.ok) return null
      return result.output
    } catch (err) {
      console.error('[eli5:draftPr] Claude CLI failed:', err)
      return null
    }
  })

  // ============================================================
  // Terminal handlers
  // ============================================================
  ipcMain.handle(
    'terminal:create',
    async (_event, ticketId: string, issueData: any, cols: number, rows: number, repoName?: string) => {
      const sessionId = uuidv4()
      const projectId = issueData?.project?.id as string | undefined
      // Resolve cwd first so context can include git status from the real repo
      const workDir = getWorkDir()
      let previewCwd: string | undefined
      if (repoName) {
        const p = path.join(workDir, repoName)
        if (fs.existsSync(p)) previewCwd = p
      } else if (projectId) {
        const db = getDb()
        const row = db.prepare('SELECT repo_name FROM project_repos WHERE linear_project_id = ? ORDER BY created_at ASC LIMIT 1').get(projectId) as any
        if (row?.repo_name) {
          const p = path.join(workDir, row.repo_name)
          if (fs.existsSync(p)) previewCwd = p
        }
      }
      const contextContent = await buildContextContent(ticketId, issueData, previewCwd)
      await createTerminal(sessionId, ticketId, projectId, repoName, contextContent, cols, rows, currentWin)
      return sessionId
    }
  )

  ipcMain.handle('terminal:write', async (_event, sessionId: string, data: string) => {
    writeToTerminal(sessionId, data)
  })

  ipcMain.handle('terminal:resize', async (_event, sessionId: string, cols: number, rows: number) => {
    resizeTerminal(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:kill', async (_event, sessionId: string) => {
    killTerminal(sessionId)
  })

  ipcMain.handle('terminal:attach', async (_event, sessionId: string) => {
    if (typeof sessionId !== 'string') return
    attachTerminal(sessionId, currentWin)
  })

  ipcMain.handle('terminal:detach', async (_event, sessionId: string) => {
    if (typeof sessionId !== 'string') return
    detachTerminal(sessionId)
  })

  // ============================================================
  // Analytics handlers
  // ============================================================
  // ============================================================
  // Analytics: new insight handlers
  // ============================================================

  ipcMain.handle('analytics:getVelocity', async (_event, weeks = 8) => analytics.getVelocity(weeks))
  ipcMain.handle('analytics:getFocus', async () => analytics.getFocus())
  ipcMain.handle('analytics:getAging', async (_event, dayThreshold = 3) => analytics.getAging(dayThreshold))
  ipcMain.handle('analytics:getStreak', async () => analytics.getStreak())
  ipcMain.handle('analytics:exportCsv', async (_event, from?: number, to?: number) => analytics.exportCsv(from, to))
  ipcMain.handle('analytics:getDashboard', async () => analytics.getDashboard())

  // ============================================================
  // Project details handlers
  // ============================================================
  ipcMain.handle('project:getDetails', async (_event, projectId: string) => {
    const db = getDb()
    const cached = db.prepare('SELECT data, cached_at FROM project_details_cache WHERE id = ?').get(projectId) as any
    // Use cache if < 10 minutes old
    if (cached && Date.now() - cached.cached_at < 10 * 60 * 1000) {
      return JSON.parse(cached.data)
    }
    const details = await getActiveConnector().fetchProjectDetails(projectId)
    db.prepare('INSERT OR REPLACE INTO project_details_cache (id, data, cached_at) VALUES (?, ?, ?)').run(projectId, JSON.stringify(details), Date.now())
    writeGlobalConfigFile(db)
    return details
  })

  ipcMain.handle('project:refreshDetails', async (_event, projectId: string) => {
    const db = getDb()
    const details = await getActiveConnector().fetchProjectDetails(projectId)
    db.prepare('INSERT OR REPLACE INTO project_details_cache (id, data, cached_at) VALUES (?, ?, ?)').run(projectId, JSON.stringify(details), Date.now())
    writeGlobalConfigFile(db)
    return details
  })

  // ============================================================
  // Git handlers
  // ============================================================
  ipcMain.handle('git:getDiff', async (_event, repoPath: string, fromSha?: string, toSha?: string) => {
    const { execSync } = require('child_process')
    const expandedPath = repoPath.replace(/^~/, require('os').homedir())
    try {
      const cmd = fromSha
        ? `git diff ${fromSha}..${toSha ?? 'HEAD'}`
        : 'git diff HEAD --'
      return execSync(cmd, { cwd: expandedPath, timeout: 10000, maxBuffer: 2 * 1024 * 1024 }).toString()
    } catch {
      return ''
    }
  })

  // ============================================================
  // Activity handlers
  // ============================================================
  ipcMain.handle('activity:getForTicket', async (_event, ticketId: string) => {
    const db = getDb()
    const events: Array<{ id: string; type: string; at: number; data: any }> = []

    try {
      const sessions = db.prepare(
        'SELECT id, started_at, ended_at, git_start_sha, exit_code, summary FROM time_sessions WHERE ticket_id = ? ORDER BY started_at DESC'
      ).all(ticketId) as any[]
      for (const s of sessions) {
        events.push({
          id: `session-${s.id}`,
          type: 'session',
          at: s.started_at,
          data: {
            started_at: s.started_at,
            ended_at: s.ended_at,
            gitStartSha: s.git_start_sha ?? null,
            exitCode: s.exit_code ?? null,
            summary: s.summary ?? null,
          }
        })
      }
    } catch {}

    try {
      const statusChanges = db.prepare(
        'SELECT id, from_state, to_state, changed_at FROM status_changes WHERE ticket_id = ? ORDER BY changed_at DESC'
      ).all(ticketId) as any[]
      for (const sc of statusChanges) {
        events.push({
          id: `status-${sc.id}`,
          type: 'status',
          at: sc.changed_at,
          data: { from_state: sc.from_state, to_state: sc.to_state }
        })
      }
    } catch {}

    try {
      const progress = db.prepare(
        'SELECT id, percent, log, updated_at FROM progress WHERE ticket_id = ?'
      ).all(ticketId) as any[]
      for (const p of progress) {
        events.push({
          id: `progress-${p.id}`,
          type: 'progress',
          at: p.updated_at,
          data: { percent: p.percent, log: p.log }
        })
      }
    } catch {}

    events.sort((a, b) => b.at - a.at)
    return events
  })

  ipcMain.handle('git:getBranchInfo', async (_event, repoPath: string) => {
    const { execSync } = require('child_process')
    const expandedPath = repoPath.replace(/^~/, require('os').homedir())
    try {
      const branch = execSync('git branch --show-current', { cwd: expandedPath, timeout: 3000 }).toString().trim()
      const status = execSync('git status --porcelain', { cwd: expandedPath, timeout: 3000 }).toString().trim()
      const isDirty = status.length > 0
      let aheadBy = 0, behindBy = 0
      try { aheadBy = parseInt(execSync('git rev-list --count @{u}..HEAD', { cwd: expandedPath, timeout: 3000 }).toString().trim()) || 0 } catch {}
      try { behindBy = parseInt(execSync('git rev-list --count HEAD..@{u}', { cwd: expandedPath, timeout: 3000 }).toString().trim()) || 0 } catch {}
      return { branch, isDirty, aheadBy, behindBy }
    } catch {
      return { branch: null, isDirty: false, aheadBy: 0, behindBy: 0 }
    }
  })

  // ============================================================
  // Standup handler
  // ============================================================
  ipcMain.handle('standup:generate', async () => {
    const db = getDb()

    // Get today midnight epoch
    const todayMidnight = new Date()
    todayMidnight.setHours(0, 0, 0, 0)
    const todayMs = todayMidnight.getTime()

    // Time sessions today — join with issues_cache for titles
    const sessions = db.prepare(`
      SELECT ts.ticket_id, ts.started_at, ts.ended_at,
             ic.data as issue_data
      FROM time_sessions ts
      LEFT JOIN issues_cache ic ON ic.id = ts.ticket_id
      WHERE ts.started_at >= ?
      ORDER BY ts.started_at ASC
    `).all(todayMs) as any[]

    // Status changes today
    const statusChanges = db.prepare(`
      SELECT sc.ticket_id, sc.from_state, sc.to_state, sc.changed_at,
             ic.data as issue_data
      FROM status_changes sc
      LEFT JOIN issues_cache ic ON ic.id = sc.ticket_id
      WHERE sc.changed_at >= ?
      ORDER BY sc.changed_at ASC
    `).all(todayMs) as any[]

    // Progress updates (all in-progress tickets)
    const progress = db.prepare(`
      SELECT p.ticket_id, p.percent,
             ic.data as issue_data
      FROM progress p
      LEFT JOIN issues_cache ic ON ic.id = p.ticket_id
      WHERE p.percent > 0
      ORDER BY p.updated_at DESC
      LIMIT 20
    `).all() as any[]

    // Build context string for Claude
    const formatDuration = (ms: number) => {
      const m = Math.floor(ms / 60000)
      if (m < 60) return `${m}m`
      return `${Math.floor(m / 60)}h ${m % 60}m`
    }

    const getTitle = (row: any) => {
      try {
        const d = JSON.parse(row.issue_data || '{}')
        return `${d.identifier || row.ticket_id}: ${d.title || 'Unknown'}`
      } catch { return row.ticket_id }
    }

    const lines: string[] = ['# Today\'s Activity\n']

    if (sessions.length > 0) {
      lines.push('## Terminal Sessions')
      // Group by ticket_id and sum durations
      const byTicket: Record<string, { title: string; totalMs: number }> = {}
      for (const s of sessions) {
        const duration = (s.ended_at ?? Date.now()) - s.started_at
        const title = getTitle(s)
        if (!byTicket[s.ticket_id]) byTicket[s.ticket_id] = { title, totalMs: 0 }
        byTicket[s.ticket_id].totalMs += duration
      }
      for (const [, v] of Object.entries(byTicket)) {
        lines.push(`- ${v.title} (${formatDuration(v.totalMs)})`)
      }
      lines.push('')
    }

    if (statusChanges.length > 0) {
      lines.push('## Status Changes')
      for (const sc of statusChanges) {
        lines.push(`- ${getTitle(sc)}: ${sc.from_state || '?'} → ${sc.to_state}`)
      }
      lines.push('')
    }

    if (progress.length > 0) {
      lines.push('## Current Progress')
      for (const p of progress) {
        lines.push(`- ${getTitle(p)}: ${p.percent}% complete`)
      }
      lines.push('')
    }

    const activityContext = lines.join('\n')
    const hasActivity = sessions.length > 0 || statusChanges.length > 0 || progress.length > 0

    const prompt = hasActivity
      ? `You are a helpful engineering assistant. Based on the developer's activity data below, write a concise daily standup update in this exact format:

**Yesterday / Today:**
- [bullet points of what was worked on, grouped logically, 2-5 bullets]

**Up Next:**
- [1-3 bullets of likely next tasks based on in-progress work]

**Blockers:**
- None (or list any if apparent from context)

Keep it brief and professional. Use ticket identifiers (like ENG-123) where available. Here's the activity:

${activityContext}`
      : `Write a brief standup template with placeholder text since there's no recorded activity today yet. Use this format:

**Yesterday / Today:**
- [No activity recorded today yet]

**Up Next:**
- Continue working on assigned tickets

**Blockers:**
- None`

    let standup = activityContext
    let usedAI = false
    try {
      const callId = uuidv4()
      const result = await runClaudeStreaming({ prompt, callId, win: currentWin })
      if (!result.ok) throw new Error('Claude CLI returned non-zero exit code')
      standup = result.output
      usedAI = true
      console.log('[standup] Generated via Claude CLI (haiku)')
    } catch (err) {
      console.error('[standup] Claude CLI failed, using formatted activity:', err)
      standup = `**Yesterday / Today:**\n${activityContext}\n\n**Blockers:**\n- None`
      usedAI = false
    }

    return { standup, raw: activityContext, usedAI }
  })

  // ============================================================
  // Context preview + refresh-for-session
  // ============================================================
  ipcMain.handle('context:preview', async (_event, ticketId: string, issueData: any, repoName?: string) => {
    const workDir = getWorkDir()
    const projectId = issueData?.project?.id as string | undefined
    let previewCwd: string | undefined
    if (repoName) {
      const p = path.join(workDir, repoName)
      if (fs.existsSync(p)) previewCwd = p
    } else if (projectId) {
      const db = getDb()
      const row = db.prepare('SELECT repo_name FROM project_repos WHERE linear_project_id = ? ORDER BY created_at ASC LIMIT 1').get(projectId) as any
      if (row?.repo_name) {
        const p = path.join(workDir, row.repo_name)
        if (fs.existsSync(p)) previewCwd = p
      }
    }
    return buildContextContent(ticketId, issueData, previewCwd)
  })

  ipcMain.handle('context:refreshForSession', async (_event, sessionId: string, ticketId: string, issueData: any) => {
    const cwd = getSessionCwd(sessionId)
    if (!cwd) return { ok: false, error: 'Session not found' }
    const content = await buildContextContent(ticketId, issueData, cwd)
    const injected = reinjectContext(sessionId, content)
    return { ok: injected, error: injected ? undefined : 'reinject failed' }
  })

  // ponytail: repo stays untouched. Edited context is stashed and consumed by
  // the next createTerminal() call for this ticket via setPendingContextOverride.
  ipcMain.handle('context:writeForSession', async (_event, ticketId: string, _issueData: any, editedText: string) => {
    setPendingContextOverride(ticketId, editedText)
    return { ok: true }
  })

  // ============================================================
  // Project Skills (shared across tickets in a project)
  // ============================================================
  ipcMain.handle('projectSkills:list', async (_event, projectId: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM project_skills WHERE project_id = ? ORDER BY created_at ASC').all(projectId)
  })

  ipcMain.handle('projectSkills:add', async (_event, projectId: string, name: string, command: string) => {
    const db = getDb()
    const id = uuidv4()
    db.prepare('INSERT INTO project_skills (id, project_id, name, command, created_at) VALUES (?, ?, ?, ?, ?)').run(id, projectId, name, command, Date.now())
    return db.prepare('SELECT * FROM project_skills WHERE id = ?').get(id)
  })

  ipcMain.handle('projectSkills:delete', async (_event, skillId: string) => {
    const db = getDb()
    db.prepare('DELETE FROM project_skills WHERE id = ?').run(skillId)
  })

  ipcMain.handle('projectSkills:update', async (_event, skillId: string, name: string, command: string) => {
    const db = getDb()
    db.prepare('UPDATE project_skills SET name = ?, command = ? WHERE id = ?').run(name, command, skillId)
    return db.prepare('SELECT * FROM project_skills WHERE id = ?').get(skillId)
  })

  // ============================================================
  // Global Skills (available in every ticket)
  // ============================================================
  ipcMain.handle('globalSkills:list', async () => {
    const db = getDb()
    return db.prepare('SELECT * FROM global_skills ORDER BY created_at ASC').all()
  })

  ipcMain.handle('globalSkills:add', async (_event, name: string, command: string) => {
    const db = getDb()
    const id = uuidv4()
    db.prepare('INSERT INTO global_skills (id, name, command, created_at) VALUES (?, ?, ?, ?)').run(id, name, command, Date.now())
    return db.prepare('SELECT * FROM global_skills WHERE id = ?').get(id)
  })

  ipcMain.handle('globalSkills:delete', async (_event, skillId: string) => {
    const db = getDb()
    db.prepare('DELETE FROM global_skills WHERE id = ?').run(skillId)
  })

  ipcMain.handle('globalSkills:update', async (_event, skillId: string, name: string, command: string) => {
    const db = getDb()
    db.prepare('UPDATE global_skills SET name = ?, command = ? WHERE id = ?').run(name, command, skillId)
    return db.prepare('SELECT * FROM global_skills WHERE id = ?').get(skillId)
  })

  // ============================================================
  // Skill links (global/project/ticket → installed-skill slugs)
  // ============================================================
  const SLUG_LINK_RE = /^[A-Za-z0-9._-]+$/

  ipcMain.handle('skillLinks:listForTicket', async (_e, ticketId: string, projectId: string | null) => {
    const db = getDb()
    const global = (db.prepare('SELECT slug FROM global_skill_links').all() as any[]).map(r => r.slug)
    const project = projectId
      ? (db.prepare('SELECT slug FROM project_skill_links WHERE project_id = ?').all(projectId) as any[]).map(r => r.slug)
      : []
    const ticket = ticketId
      ? (db.prepare('SELECT slug FROM ticket_skill_links WHERE ticket_id = ?').all(ticketId) as any[]).map(r => r.slug)
      : []
    return { global, project, ticket }
  })

  ipcMain.handle('skillLinks:setSingle', async (
    _e,
    slug: string,
    scope: 'global' | 'project' | 'ticket',
    on: boolean,
    ctx: { projectId?: string; ticketId?: string }
  ) => {
    if (typeof slug !== 'string' || !SLUG_LINK_RE.test(slug)) return { ok: false, error: 'invalid slug' }
    const db = getDb()
    const now = Date.now()
    if (scope === 'global') {
      if (on) db.prepare('INSERT OR IGNORE INTO global_skill_links (slug, linked_at) VALUES (?, ?)').run(slug, now)
      else db.prepare('DELETE FROM global_skill_links WHERE slug = ?').run(slug)
    } else if (scope === 'project') {
      if (!ctx?.projectId) return { ok: false, error: 'projectId required' }
      if (on) db.prepare('INSERT OR IGNORE INTO project_skill_links (project_id, slug, linked_at) VALUES (?, ?, ?)').run(ctx.projectId, slug, now)
      else db.prepare('DELETE FROM project_skill_links WHERE project_id = ? AND slug = ?').run(ctx.projectId, slug)
    } else if (scope === 'ticket') {
      if (!ctx?.ticketId) return { ok: false, error: 'ticketId required' }
      if (on) db.prepare('INSERT OR IGNORE INTO ticket_skill_links (ticket_id, slug, linked_at) VALUES (?, ?, ?)').run(ctx.ticketId, slug, now)
      else db.prepare('DELETE FROM ticket_skill_links WHERE ticket_id = ? AND slug = ?').run(ctx.ticketId, slug)
    } else {
      return { ok: false, error: 'invalid scope' }
    }
    return { ok: true }
  })

  ipcMain.handle('skillLinks:toggleBatch', async (
    _e,
    slugs: string[],
    scope: 'global' | 'project' | 'ticket',
    ctx: { projectId?: string; ticketId?: string }
  ) => {
    if (!Array.isArray(slugs) || slugs.length === 0) return { attached: [], detached: [] }
    for (const s of slugs) {
      if (typeof s !== 'string' || !SLUG_LINK_RE.test(s)) return { attached: [], detached: [], error: 'invalid slug' }
    }
    if (scope === 'project' && !ctx?.projectId) return { attached: [], detached: [], error: 'projectId required' }
    if (scope === 'ticket' && !ctx?.ticketId) return { attached: [], detached: [], error: 'ticketId required' }

    const db = getDb()
    const now = Date.now()
    const placeholders = slugs.map(() => '?').join(',')

    let existing: string[] = []
    if (scope === 'global') {
      existing = (db.prepare(`SELECT slug FROM global_skill_links WHERE slug IN (${placeholders})`).all(...slugs) as any[]).map(r => r.slug)
    } else if (scope === 'project') {
      existing = (db.prepare(`SELECT slug FROM project_skill_links WHERE project_id = ? AND slug IN (${placeholders})`).all(ctx.projectId, ...slugs) as any[]).map(r => r.slug)
    } else {
      existing = (db.prepare(`SELECT slug FROM ticket_skill_links WHERE ticket_id = ? AND slug IN (${placeholders})`).all(ctx.ticketId, ...slugs) as any[]).map(r => r.slug)
    }

    const allPresent = existing.length === slugs.length
    let attached: string[] = []
    let detached: string[] = []

    const runTx = db.transaction(() => {
      if (allPresent) {
        if (scope === 'global') {
          db.prepare(`DELETE FROM global_skill_links WHERE slug IN (${placeholders})`).run(...slugs)
        } else if (scope === 'project') {
          db.prepare(`DELETE FROM project_skill_links WHERE project_id = ? AND slug IN (${placeholders})`).run(ctx.projectId, ...slugs)
        } else {
          db.prepare(`DELETE FROM ticket_skill_links WHERE ticket_id = ? AND slug IN (${placeholders})`).run(ctx.ticketId, ...slugs)
        }
        detached = [...slugs]
      } else {
        const existingSet = new Set(existing)
        const missing = slugs.filter(s => !existingSet.has(s))
        if (scope === 'global') {
          const stmt = db.prepare('INSERT OR IGNORE INTO global_skill_links (slug, linked_at) VALUES (?, ?)')
          for (const s of missing) stmt.run(s, now)
        } else if (scope === 'project') {
          const stmt = db.prepare('INSERT OR IGNORE INTO project_skill_links (project_id, slug, linked_at) VALUES (?, ?, ?)')
          for (const s of missing) stmt.run(ctx.projectId, s, now)
        } else {
          const stmt = db.prepare('INSERT OR IGNORE INTO ticket_skill_links (ticket_id, slug, linked_at) VALUES (?, ?, ?)')
          for (const s of missing) stmt.run(ctx.ticketId, s, now)
        }
        attached = missing
      }
    })
    runTx()
    return { attached, detached }
  })

  // ============================================================
  // Repo skills (file-based: <repo>/.devbro/skills.md)
  // ============================================================
  ipcMain.handle('skills:readRepo', async (_event, repoPath: string) => {
    const expandedPath = repoPath.replace(/^~/, os.homedir())
    const filePath = path.join(expandedPath, '.devbro', 'skills.md')
    let text: string
    try {
      text = fs.readFileSync(filePath, 'utf-8')
    } catch {
      return []
    }
    const blocks = text.split(/^---$/m)
    const results: Array<{ name: string; description?: string; command: string }> = []
    for (const block of blocks) {
      try {
        const nameMatch = block.match(/^#\s+(.+)$/m)
        if (!nameMatch) continue
        const name = nameMatch[1].trim()
        const descMatch = block.match(/^>\s+(.+)$/m)
        const description = descMatch ? descMatch[1].trim() : undefined
        const cmdMatch = block.match(/^`(.+)`$/m)
        if (!cmdMatch) continue
        const command = cmdMatch[1].trim()
        results.push({ name, description, command })
      } catch {
        // skip malformed block
      }
    }
    return results
  })

  ipcMain.handle('skills:writeRepo', async (_event, repoPath: string, skills: Array<{ name: string; description?: string; command: string }>) => {
    const expandedPath = repoPath.replace(/^~/, os.homedir())
    const dir = path.join(expandedPath, '.devbro')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'skills.md')
    const lines: string[] = []
    for (let i = 0; i < skills.length; i++) {
      const s = skills[i]
      lines.push(`# ${s.name}`)
      if (s.description) lines.push(`> ${s.description}`)
      lines.push(`\`${s.command}\``)
      if (i < skills.length - 1) lines.push('', '---', '')
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8')
  })

  // ============================================================
  // shell:openPath — open a file in the OS default app
  // ============================================================
  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    const { shell } = await import('electron')
    const expanded = filePath.replace(/^~/, os.homedir())
    return shell.openPath(expanded)
  })

  // ============================================================
  // Tab persistence (SQLite)
  // ============================================================
  ipcMain.handle('tabs:load', async () => {
    const db = getDb()
    const rows = db.prepare('SELECT id, issue_data, tab_order, pinned FROM open_tabs ORDER BY pinned DESC, tab_order ASC').all() as any[]
    return rows.map((r: any) => ({
      id: r.id,
      issueData: JSON.parse(r.issue_data),
      tabOrder: r.tab_order,
      pinned: !!r.pinned
    }))
  })

  ipcMain.handle('tabs:save', async (_event, tabs: Array<{ id: string; issueData: any; pinned?: boolean }>) => {
    const db = getDb()
    const now = Date.now()
    db.transaction(() => {
      db.exec('DELETE FROM open_tabs')
      for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i]
        db.prepare('INSERT INTO open_tabs (id, issue_data, tab_order, pinned, saved_at) VALUES (?, ?, ?, ?, ?)').run(
          t.id,
          JSON.stringify(t.issueData),
          i,
          t.pinned ? 1 : 0,
          now
        )
      }
    })()
  })

  // ============================================================
  // Open tabs polling (Phase 3 — live Linear awareness)
  // ============================================================
  // ponytail: notifications only fire for open-tab issues; expand to all-tracked if users want assignment alerts on non-open tickets
  let openTabIds: Set<string> = new Set()
  // Guard: only register tabs:setOpen once across hot-reloads / multi-window
  if (!ipcMain.eventNames().includes('tabs:setOpen')) {
    ipcMain.handle('tabs:setOpen', async (_event, tabIds: string[]) => {
      openTabIds = new Set(tabIds)
    })
  }

  let pollingActive = false
  let isFirstFetch = true
  if (pollIntervalId === null) {
    pollIntervalId = setInterval(async () => {
      if (openTabIds.size === 0 || pollingActive) return
      pollingActive = true
      try {
        for (const id of openTabIds) {
          try {
            const fresh = await getActiveConnector().fetchIssue(id)
            if (currentWin && !currentWin.isDestroyed()) currentWin.webContents.send('linear:issueUpdated', fresh)

            // Emit native notifications for meaningful changes (after baseline)
            if (!isFirstFetch) {
              const notificationsEnabled = (() => {
                try {
                  const db = getDb()
                  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get('notifications_enabled') as any
                  return row?.value !== 'false'
                } catch { return true }
              })()

              if (notificationsEnabled) {
                const cached = lastKnownIssues.get(id)

                // Assigned to me — assignee changed to viewer
                if (cached?.assignee?.id !== fresh.assignee?.id && fresh.assignee?.id) {
                  if (!cachedViewerId) {
                    try {
                      const viewer = await getLinearClient().viewer
                      cachedViewerId = viewer.id
                    } catch {}
                  }
                  if (fresh.assignee.id === cachedViewerId) {
                    new Notification({
                      title: 'Assigned to You',
                      body: `${fresh.identifier} — ${fresh.title}`,
                      silent: false,
                    }).show()
                  }
                }

                // Status changed
                if (cached && (cached.state?.id !== fresh.state?.id || cached.state?.name !== fresh.state?.name)) {
                  new Notification({
                    title: 'Status Updated',
                    body: `${fresh.identifier}: ${cached.state?.name} → ${fresh.state?.name}`,
                    silent: false,
                  }).show()
                }

                // Deadline < 48h
                if (fresh.dueDate) {
                  const now = Date.now()
                  const deadline = new Date(fresh.dueDate).getTime()
                  const hoursUntil = (deadline - now) / (1000 * 60 * 60)
                  const dedupeKey = `${id}:${fresh.dueDate}`

                  if (hoursUntil > 0 && hoursUntil < 48 && !deadlineNotified.has(dedupeKey)) {
                    const hours = Math.round(hoursUntil)
                    deadlineNotified.add(dedupeKey)
                    new Notification({
                      title: 'Deadline Soon',
                      body: `${fresh.identifier} due in ${hours}h`,
                      silent: false,
                    }).show()
                  }
                }
              }

              lastKnownIssues.set(id, fresh)
            }
          } catch {
            // ignore per-issue errors
          }
        }

        // After first poll, use subsequent fetches for notifications
        if (isFirstFetch) {
          isFirstFetch = false
        }
      } finally {
        pollingActive = false
      }
    }, 90_000)
  }

  win.on('closed', () => {
    openTabIds.clear()
  })

  // ============================================================
  // GitHub handlers
  // ============================================================
  ipcMain.handle('github:testAuth', async () => {
    return github.testAuth()
  })

  ipcMain.handle('github:getPrForBranch', async (_event, repoPath: string, branch: string) => {
    const workDir = getWorkDir()
    const fullPath = repoPath.startsWith('~')
      ? repoPath.replace(/^~/, os.homedir())
      : path.join(workDir, repoPath)
    const remote = github.getRepoFromRemote(fullPath)
    if (!remote) return null
    const pr = await github.findPrForBranch(remote.owner, remote.name, branch)
    if (!pr) return null
    const checks = await github.getPrChecks(remote.owner, remote.name, pr.headSha)
    return { ...pr, checks }
  })

  ipcMain.handle('github:createPr', async (_event, repoPath: string, opts: { title: string; body: string; head: string; base: string }) => {
    const workDir = getWorkDir()
    const fullPath = repoPath.startsWith('~')
      ? repoPath.replace(/^~/, os.homedir())
      : path.join(workDir, repoPath)
    const remote = github.getRepoFromRemote(fullPath)
    if (!remote) throw new Error('Could not resolve GitHub remote')
    return github.createPr(remote.owner, remote.name, opts)
  })

  ipcMain.handle('github:createBranch', async (_event, repoPath: string, branchName: string, base: string = 'main') => {
    const { execSync } = require('child_process')
    const workDir = getWorkDir()
    const fullPath = repoPath.startsWith('~')
      ? repoPath.replace(/^~/, os.homedir())
      : path.join(workDir, repoPath)
    try {
      const safeExec = (cmd: string) => execSync(cmd, { cwd: fullPath, timeout: 10000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
      const current = safeExec('git branch --show-current')
      if (current !== base) safeExec(`git checkout ${base}`)
      safeExec(`git checkout -b ${branchName}`)
      return { ok: true, branch: branchName }
    } catch (err: any) {
      return { ok: false, error: err?.stderr?.toString() || err?.message || 'git error' }
    }
  })

  ipcMain.handle('github:draftPrBody', async (_event, repoPath: string, branch: string, base: string, ticketTitle: string, ticketDesc: string) => {
    const { execSync } = require('child_process')
    const workDir = getWorkDir()
    const fullPath = repoPath.startsWith('~')
      ? repoPath.replace(/^~/, os.homedir())
      : path.join(workDir, repoPath)
    let diffStat = ''
    try {
      diffStat = execSync(`git diff ${base}..${branch} --stat`, { cwd: fullPath, timeout: 10000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().slice(0, 3000)
    } catch {}
    const prompt = `Write a GitHub PR description in Markdown for this change.

Ticket: ${ticketTitle}
Description: ${(ticketDesc || '').slice(0, 600)}
Branch: ${branch} → ${base}

Diff stat:
${diffStat || '(no diff available)'}

Format:
## Summary
(2-4 bullet points of what changed)

## Test plan
- [ ] (checklist of things to verify)

Keep it concise and developer-focused.`
    const callId = uuidv4()
    const result = await runClaudeStreaming({ prompt, callId, win: currentWin, cwd: fullPath })
    return { ok: result.ok, body: result.output, callId }
  })

  // ============================================================
  // Installable Skills (git-cloned, ~/.devbro/skills/<slug>)
  // ============================================================
  ipcMain.handle('skillPkg:list', async () => skills.listSkills())
  ipcMain.handle('skillPkg:install', async (_event, url: string) => skills.installFromGit(url))
  ipcMain.handle('skillPkg:uninstall', async (_event, slug: string) => skills.uninstallSkill(slug))
  ipcMain.handle('skillPkg:update', async (_event, slug: string) => skills.updateSkill(slug))
  ipcMain.handle('skillPkg:apply', async (_event, slug: string, ctx: skills.TicketContext) => {
    return skills.applySkill(slug, ctx, currentWin)
  })
  ipcMain.handle('skillPkg:discover', async (_event, force?: boolean) => skills.fetchRegistry(!!force))
  ipcMain.handle('skillPkg:getRegistryUrl', async () => {
    const db = getDb()
    const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get('skills_registry_url') as any
    return row?.value ?? null
  })
  ipcMain.handle('skillPkg:setRegistryUrl', async (_event, url: string) => {
    const db = getDb()
    db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run('skills_registry_url', url)
    return { ok: true }
  })
  ipcMain.handle('skillPkg:openFolder', async (_event, slug: string) => skills.openSkillFolder(slug))
  ipcMain.handle('skillPkg:getBody', async (_event, slug: string) => skills.getSkillBody(slug))
  ipcMain.handle('skillPkg:appliedHistory', async (_event, ticketId?: string) => {
    const db = getDb()
    if (ticketId) {
      return db.prepare('SELECT * FROM skill_applications WHERE ticket_id = ? ORDER BY applied_at DESC LIMIT 50').all(ticketId)
    }
    return db.prepare('SELECT * FROM skill_applications ORDER BY applied_at DESC LIMIT 50').all()
  })
}
