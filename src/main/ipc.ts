import { ipcMain, BrowserWindow } from 'electron'
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
  getSessionCwd
} from './pty'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { writeGlobalConfigFile } from './configLog'
import Anthropic from '@anthropic-ai/sdk'

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  return new Anthropic({ apiKey })
}

export function registerIpcHandlers(win: BrowserWindow): void {
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
    const fsM = await import('fs')
    const pathM = await import('path')
    const osM = await import('os')
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
    const home = process.env.HOME || osM.default.homedir()
    let cwd = home
    if (projectId) {
      try {
        const row = db.prepare('SELECT repo_name FROM project_repos WHERE linear_project_id = ? ORDER BY created_at ASC LIMIT 1').get(projectId) as any
        if (row?.repo_name) {
          const p = pathM.default.join(getWorkDir(), row.repo_name)
          if (fsM.default.existsSync(p)) cwd = p
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
      const tmpDir = osM.default.tmpdir()
      const tmpFile = pathM.default.join(tmpDir, `progress-manual-${Date.now()}.txt`)
      fsM.default.writeFileSync(tmpFile, prompt, 'utf-8')

      const claudeEnv = { ...process.env }
      delete claudeEnv.ANTHROPIC_API_KEY
      const shell = process.env.SHELL || '/bin/zsh'

      const output = execSync(`${shell} -l -c 'claude --model haiku' < "${tmpFile}"`, {
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: claudeEnv,
      }).trim()

      try { fsM.default.unlinkSync(tmpFile) } catch {}

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

    win.webContents.send('progress:updated', { ticketId, summary, newPercent })
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

  ipcMain.handle('eli5:generate', async (_event, ticketId: string, title: string, description: string) => {
    const { execSync } = await import('child_process')
    const fs = await import('fs')
    const path = await import('path')
    const os = await import('os')

    const prompt = `Explain this engineering ticket in simple terms (ELI5 - Explain Like I'm 5):\n\nTitle: ${title}\n\nDescription: ${description || 'No description provided'}\n\nKeep it under 150 words, friendly and clear.`

    let content = ''
    try {
      const tmpDir = os.default.tmpdir()
      const tmpFile = path.default.join(tmpDir, `eli5-${Date.now()}.txt`)
      fs.default.writeFileSync(tmpFile, prompt, 'utf-8')

      const claudeEnv = { ...process.env }
      delete claudeEnv.ANTHROPIC_API_KEY
      const shell = process.env.SHELL || '/bin/zsh'
      content = execSync(`${shell} -l -c 'claude --model haiku' < "${tmpFile}"`, {
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: claudeEnv,
      }).trim()

      try { fs.default.unlinkSync(tmpFile) } catch {}
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
      await createTerminal(sessionId, ticketId, projectId, repoName, contextContent, cols, rows, win)
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
    attachTerminal(sessionId, win)
  })

  ipcMain.handle('terminal:detach', async (_event, sessionId: string) => {
    if (typeof sessionId !== 'string') return
    detachTerminal(sessionId)
  })

  // ============================================================
  // Analytics handlers
  // ============================================================
  ipcMain.handle('analytics:getDashboard', async () => {
    const db = getDb()

    // Today midnight
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const todayMidnight = now.getTime()

    // Today sessions
    const todaySessionRows = db.prepare(`
      SELECT ts.ticket_id, ts.started_at, ts.ended_at, ic.data
      FROM time_sessions ts
      LEFT JOIN issues_cache ic ON ic.id = ts.ticket_id
      WHERE ts.started_at >= ?
      ORDER BY ts.started_at ASC
    `).all(todayMidnight) as any[]

    const todayTicketMap = new Map<string, { ticketId: string; title: string; durationMs: number; startedAt: number }>()
    for (const row of todaySessionRows) {
      const durationMs = (row.ended_at ?? Date.now()) - row.started_at
      let title = row.ticket_id
      try {
        const parsed = JSON.parse(row.data)
        title = parsed.title || row.ticket_id
      } catch {}
      const existing = todayTicketMap.get(row.ticket_id)
      if (existing) {
        existing.durationMs += durationMs
      } else {
        todayTicketMap.set(row.ticket_id, { ticketId: row.ticket_id, title, durationMs, startedAt: row.started_at })
      }
    }
    const todaySessions = Array.from(todayTicketMap.values())
    const todayTotalMs = todaySessions.reduce((sum, s) => sum + s.durationMs, 0)

    // Week: last 7 days
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000
    const weekRows = db.prepare(`
      SELECT ticket_id, started_at, ended_at
      FROM time_sessions
      WHERE started_at >= ?
      ORDER BY started_at ASC
    `).all(weekStart) as any[]

    const byDayMap = new Map<string, { totalMs: number; tickets: Set<string> }>()
    for (const row of weekRows) {
      const date = new Date(row.started_at).toISOString().slice(0, 10)
      const durationMs = (row.ended_at ?? Date.now()) - row.started_at
      const existing = byDayMap.get(date)
      if (existing) {
        existing.totalMs += durationMs
        existing.tickets.add(row.ticket_id)
      } else {
        byDayMap.set(date, { totalMs: durationMs, tickets: new Set([row.ticket_id]) })
      }
    }
    const byDay = Array.from(byDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { totalMs, tickets }]) => ({ date, totalMs, ticketCount: tickets.size }))
    const weekTotalMs = byDay.reduce((sum, d) => sum + d.totalMs, 0)

    // In progress tickets
    const inProgressRows = db.prepare(`
      SELECT p.ticket_id, p.percent, ic.data
      FROM progress p
      LEFT JOIN issues_cache ic ON ic.id = p.ticket_id
      WHERE p.percent > 0 AND p.percent < 100
    `).all() as any[]

    const inProgress = inProgressRows.map((row) => {
      let title = row.ticket_id
      try {
        const parsed = JSON.parse(row.data)
        title = parsed.title || row.ticket_id
      } catch {}
      return { ticketId: row.ticket_id, title, percent: row.percent }
    })

    // Recent status changes
    const statusRows = db.prepare(`
      SELECT sc.ticket_id, sc.from_state, sc.to_state, sc.changed_at, ic.data
      FROM status_changes sc
      LEFT JOIN issues_cache ic ON ic.id = sc.ticket_id
      ORDER BY sc.changed_at DESC
      LIMIT 20
    `).all() as any[]

    const recentStatusChanges = statusRows.map((row) => {
      let title = row.ticket_id
      try {
        const parsed = JSON.parse(row.data)
        title = parsed.title || row.ticket_id
      } catch {}
      return { ticketId: row.ticket_id, title, fromState: row.from_state, toState: row.to_state, changedAt: row.changed_at }
    })

    // Project deadlines — from projects_cache (has targetDate after recent fetch) + project_details_cache
    const projectDeadlines: any[] = []
    const seenProjectIds = new Set<string>()

    // Try project_details_cache first (richer data)
    const detailRows = db.prepare('SELECT id, data FROM project_details_cache').all() as any[]
    for (const row of detailRows) {
      try {
        const p = JSON.parse(row.data)
        if (p.targetDate && !seenProjectIds.has(row.id)) {
          seenProjectIds.add(row.id)
          projectDeadlines.push({
            id: row.id,
            name: p.name || row.id,
            targetDate: p.targetDate,
            progress: typeof p.progress === 'number' ? Math.round(p.progress * 100) : 0,
            state: p.state || null,
            color: p.color || null,
          })
        }
      } catch {}
    }

    // Then projects_cache for any projects not already covered
    const projectCacheRows = db.prepare('SELECT id, data FROM projects_cache').all() as any[]
    for (const row of projectCacheRows) {
      try {
        const p = JSON.parse(row.data)
        if (p.targetDate && !seenProjectIds.has(row.id)) {
          seenProjectIds.add(row.id)
          projectDeadlines.push({
            id: row.id,
            name: p.name || row.id,
            targetDate: p.targetDate,
            progress: typeof p.progress === 'number' ? Math.round(p.progress * 100) : 0,
            state: p.state || null,
            color: p.color || null,
          })
        }
      } catch {}
    }

    // Sort by nearest deadline
    projectDeadlines.sort((a, b) => a.targetDate.localeCompare(b.targetDate))

    return {
      today: { sessions: todaySessions, totalMs: todayTotalMs, ticketCount: todayTicketMap.size },
      week: { byDay, totalMs: weekTotalMs },
      inProgress,
      recentStatusChanges,
      projectDeadlines,
    }
  })

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
    const { execSync } = await import('child_process')
    const fs = await import('fs')
    const path = await import('path')
    const os = await import('os')

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

    // Try Claude CLI with Haiku model
    let standup = activityContext
    let usedAI = false
    try {
      const tmpDir = os.default.tmpdir()
      const tmpFile = path.default.join(tmpDir, `standup-${Date.now()}.txt`)
      fs.default.writeFileSync(tmpFile, prompt, 'utf-8')

      const claudeEnv = { ...process.env }
      delete claudeEnv.ANTHROPIC_API_KEY
      const shell = process.env.SHELL || '/bin/zsh'
      const result = execSync(`${shell} -l -c 'claude --model haiku' < "${tmpFile}"`, {
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: claudeEnv,
      })

      try { fs.default.unlinkSync(tmpFile) } catch {}

      standup = result.trim()
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
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), content, 'utf-8')
    return { ok: true, path: path.join(cwd, 'CLAUDE.md') }
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

  // ============================================================
  // Open tabs polling (Phase 3 — live Linear awareness)
  // ============================================================
  let openTabIds: Set<string> = new Set()
  // Guard: only register tabs:setOpen once across hot-reloads / multi-window
  if (!ipcMain.eventNames().includes('tabs:setOpen')) {
    ipcMain.handle('tabs:setOpen', async (_event, tabIds: string[]) => {
      openTabIds = new Set(tabIds)
    })
  }

  let pollingActive = false
  const pollInterval = setInterval(async () => {
    if (openTabIds.size === 0 || pollingActive) return
    pollingActive = true
    try {
      for (const id of openTabIds) {
        try {
          const fresh = await getActiveConnector().fetchIssue(id)
          if (!win.isDestroyed()) win.webContents.send('linear:issueUpdated', fresh)
        } catch {
          // ignore per-issue errors
        }
      }
    } finally {
      pollingActive = false
    }
  }, 90_000)

  // Clean up when window closes
  win.on('closed', () => {
    clearInterval(pollInterval)
    openTabIds.clear()
  })
}
