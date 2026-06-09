import { execSync } from 'child_process'
import Anthropic from '@anthropic-ai/sdk'
import { getDb } from './db'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  return new Anthropic({ apiKey })
}

function runClaudeSkill(prompt: string, model: string = 'haiku'): string | null {
  try {
    const tmpDir = os.tmpdir()
    const tmpFile = path.join(tmpDir, `progress-prompt-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, prompt, 'utf-8')

    // Strip ANTHROPIC_API_KEY so claude uses its own login session, not an external key
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY

    const shell = process.env.SHELL || '/bin/zsh'
    const result = execSync(`${shell} -l -c 'claude --model ${model}' < "${tmpFile}"`, {
      timeout: 60000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      killSignal: 'SIGKILL',
    })

    try { fs.unlinkSync(tmpFile) } catch {}

    return result.trim()
  } catch (err) {
    console.error(`[progress] Claude skill error (model=${model}):`, err)
    return null
  }
}

function safeExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

function formatTs(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface SummaryArgs {
  ticketId: string
  cwd: string
  gitStartSha: string | null
  sessionStartedAt: number
  sessionEndedAt: number
}

/**
 * After a Claude session ends, generate a 1-2 sentence progress summary
 * using git activity + previous notes + ticket context, then append a
 * structured entry to progress.log and update progress.percent.
 *
 * Safe to call without an Anthropic key — falls back to a minimal heuristic.
 */
export async function generateAndAppendProgress(args: SummaryArgs): Promise<{ summary: string; newPercent: number } | null> {
  const { ticketId, cwd, gitStartSha, sessionStartedAt, sessionEndedAt } = args
  const db = getDb()

  // Gather git activity during the session
  let commitLog = ''
  let diffStat = ''
  let filesChanged: string[] = []
  console.log(`[progress] gitStartSha=${gitStartSha}, cwd=${cwd}`)
  if (gitStartSha) {
    commitLog = safeExec(`git log ${gitStartSha}..HEAD --oneline --no-decorate 2>/dev/null`, cwd)
    diffStat = safeExec(`git diff ${gitStartSha}..HEAD --stat 2>/dev/null`, cwd)
    console.log(`[progress] commitLog length: ${commitLog.length}, diffStat length: ${diffStat.length}`)
  }
  // Uncommitted changes too
  const uncommitted = safeExec('git diff --stat 2>/dev/null', cwd) + '\n' + safeExec('git diff --stat --staged 2>/dev/null', cwd)
  console.log(`[progress] uncommitted changes length: ${uncommitted.trim().length}`)
  if (uncommitted.trim()) {
    diffStat = (diffStat + '\n--- uncommitted ---\n' + uncommitted).trim()
  }
  const filesRaw = safeExec(`git diff ${gitStartSha || 'HEAD'}..HEAD --name-only 2>/dev/null`, cwd)
  if (filesRaw) filesChanged = filesRaw.split('\n').filter(Boolean)
  console.log(`[progress] filesChanged: ${filesChanged.length}`)

  // Existing progress + ticket context
  const prev = db.prepare('SELECT percent, log FROM progress WHERE ticket_id = ?').get(ticketId) as any
  const prevPercent = prev?.percent ?? 0
  const prevLog = prev?.log ?? ''

  const issueRow = db.prepare('SELECT data FROM issues_cache WHERE id = ?').get(ticketId) as any
  let issueTitle = ''
  let issueDescription = ''
  let issueIdentifier = ''
  if (issueRow) {
    try {
      const d = JSON.parse(issueRow.data)
      issueTitle = d.title ?? ''
      issueDescription = d.description ?? ''
      issueIdentifier = d.identifier ?? ''
    } catch {}
  }

  // Minutes spent in this session
  const durationMs = sessionEndedAt - sessionStartedAt
  const durationMin = Math.max(1, Math.round(durationMs / 60000))

  // If nothing changed AND session was very short, skip generating an entry
  const hadActivity = commitLog.trim().length > 0 || uncommitted.trim().length > 0
  console.log(`[progress] hadActivity=${hadActivity}, durationMin=${durationMin}, commitLog.length=${commitLog.trim().length}`)
  if (!hadActivity && durationMin < 2) {
    console.log(`[progress] Skipping: no activity and session < 2 min`)
    return null
  }

  const anthropic = getAnthropicClient()
  let summary: string
  let newPercent: number

  // Try Claude CLI (via skill) first, then fall back to API if available
  if (!anthropic) {
    const skillPrompt = `You are analyzing a developer's coding session to summarize progress.

Ticket: ${issueIdentifier} — ${issueTitle}
Description: ${issueDescription.slice(0, 800)}
Previous progress: ${prevPercent}%
Session duration: ${durationMin} minutes

Commits:
${commitLog || '(no commits)'}

Files changed (${filesChanged.length}):
${filesChanged.slice(0, 20).join('\n') || '(none)'}

Diff stat:
${diffStat.slice(0, 2000) || '(no diff)'}

Respond with ONLY valid JSON (no markdown, no explanation):
{"summary": "<4-6 sentences: what was built/changed, files/functions touched, what works now, what's next>", "newPercent": <0-100>}

Be REALISTIC with percentage. Major feature done = big jump (20-40pts). Just exploring = small jump (2-5pts). Never go below ${prevPercent}%.`

    const skillOutput = runClaudeSkill(skillPrompt)
    if (skillOutput) {
      try {
        const parsed = JSON.parse(skillOutput)
        summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : 'Session completed.'
        newPercent = Math.max(prevPercent, Math.min(100, parseInt(String(parsed.newPercent)) || prevPercent))
        console.log(`[progress] Claude skill result: ${summary} (${newPercent}%)`)
      } catch {
        summary = `Worked for ~${durationMin}m${commitLog ? `; made ${commitLog.split('\n').length} commit(s)` : ''}.`
        newPercent = Math.min(100, prevPercent + (hadActivity ? 5 : 0))
      }
    } else {
      summary = `Worked for ~${durationMin}m${commitLog ? `; made ${commitLog.split('\n').length} commit(s)` : ''}.`
      newPercent = Math.min(100, prevPercent + (hadActivity ? 5 : 0))
    }
  } else if (anthropic) {
    const prompt = `You are summarizing what a developer accomplished in a coding session, for a progress log.

Ticket: ${issueIdentifier} — ${issueTitle}
Ticket Description (truncated):
${issueDescription.slice(0, 800)}

Previous progress log (most recent first):
${prevLog || '(none yet)'}

Current ticket completion: ${prevPercent}%

Session duration: ${durationMin} minutes

Commits made this session:
${commitLog || '(no commits)'}

Files changed (${filesChanged.length}):
${filesChanged.slice(0, 20).join('\n') || '(none)'}

Diff stat:
${diffStat.slice(0, 2000) || '(no diff)'}

Write a detailed progress note in EXACTLY this JSON format (no markdown fences, just the JSON):
{"summary": "<4-6 sentences: what was built/changed, which files/functions were touched, what works now, what's next>", "newPercent": <integer 0-100>}

Guidelines:
- Be concrete: name what was implemented, fixed, or investigated. Reference file/function names where relevant.
- Reference continuity with previous entries — don't repeat what was already done.
- Be REALISTIC with the percentage. If commits show a major feature completed, jump significantly (20-40 points). If just exploring, stay close to current.
- Scale: just started=5-15%, half done=40-60%, feature complete but untested=70-80%, tested and working=85-95%, fully done=100%.
- Never go down from current ${prevPercent}%.`

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      // Find JSON in the response (be lenient with surrounding markdown)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : 'Session completed.'
        newPercent = Math.max(prevPercent, Math.min(100, parseInt(String(parsed.newPercent)) || prevPercent))
      } else {
        summary = 'Session completed.'
        newPercent = Math.min(100, prevPercent + (hadActivity ? 5 : 0))
      }
    } catch (err) {
      console.error('Progress summary AI call failed:', err)
      summary = `Worked for ~${durationMin}m${commitLog ? `; made ${commitLog.split('\n').length} commit(s)` : ''}.`
      newPercent = Math.min(100, prevPercent + (hadActivity ? 5 : 0))
    }
  } else {
    // No AI — use heuristic
    const commitCount = commitLog ? commitLog.split('\n').filter(Boolean).length : 0
    summary = `Worked for ~${durationMin}m${commitCount > 0 ? `; made ${commitCount} commit(s)` : ''}${filesChanged.length > 0 ? ` across ${filesChanged.length} file(s)` : ''}.`
    newPercent = Math.min(100, prevPercent + (hadActivity ? 5 : 0))
  }

  // Build the log entry: newest at top, one line per entry
  const entry = `[${formatTs(sessionEndedAt)}] (${prevPercent}% → ${newPercent}%) ${summary}`
  const newLog = prevLog ? `${entry}\n${prevLog}` : entry

  // Persist
  const now = Date.now()
  const existing = db.prepare('SELECT id FROM progress WHERE ticket_id = ?').get(ticketId) as any
  if (existing) {
    db.prepare('UPDATE progress SET percent = ?, log = ?, updated_at = ? WHERE ticket_id = ?').run(newPercent, newLog, now, ticketId)
  } else {
    const { randomUUID } = require('crypto')
    db.prepare('INSERT INTO progress (id, ticket_id, percent, log, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(), ticketId, newPercent, newLog, now
    )
  }

  return { summary, newPercent }
}
