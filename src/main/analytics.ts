import type Database from 'better-sqlite3'
import { getDb } from './db'

// ============================================================
// Time helpers — ONE definition of "local day" for the whole app.
// Never use toISOString().slice(0,10): that's UTC, not the user's day.
// ============================================================

export function localDayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function localMidnight(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Monday 00:00 local of the week containing ts. */
export function localWeekStart(ts: number): number {
  const d = new Date(localMidnight(ts))
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d.getTime()
}

// ============================================================
// Active-time model (WakaTime-style)
//
// session_activity holds one row per minute in which the terminal saw
// real I/O. We merge heartbeat minutes into intervals: consecutive
// heartbeats ≤ IDLE_GAP_MS apart belong to the same active block; each
// block contributes (last - first + 1 minute). An idle-open terminal
// produces no heartbeats and therefore no time.
//
// Legacy fallback: sessions recorded before the heartbeat migration
// have no heartbeats at all. For those (ended sessions only) we fall
// back to the old span model so history doesn't vanish.
// ============================================================

const IDLE_GAP_MS = 5 * 60_000
const MINUTE_MS = 60_000
export const DEEP_WORK_MIN_MS = 25 * 60_000

export interface Interval {
  start: number
  end: number
  ticketId: string
}

/** Merge sorted heartbeat minutes (per ticket) into active intervals. */
function mergeMinutes(minutes: { ticket_id: string; minute_ts: number }[]): Interval[] {
  const byTicket = new Map<string, number[]>()
  for (const m of minutes) {
    let arr = byTicket.get(m.ticket_id)
    if (!arr) { arr = []; byTicket.set(m.ticket_id, arr) }
    arr.push(m.minute_ts)
  }
  const intervals: Interval[] = []
  for (const [ticketId, arr] of byTicket) {
    arr.sort((a, b) => a - b)
    let start = arr[0]
    let prev = arr[0]
    for (let i = 1; i <= arr.length; i++) {
      const cur = arr[i]
      if (cur === undefined || cur - prev > IDLE_GAP_MS) {
        intervals.push({ start, end: prev + MINUTE_MS, ticketId })
        if (cur !== undefined) start = cur
      }
      if (cur !== undefined) prev = cur
    }
  }
  return intervals.sort((a, b) => a.start - b.start)
}

/** Legacy sessions (pre-heartbeat) → span intervals. Ended sessions only. */
function legacyIntervals(db: Database.Database, sinceMs: number, untilMs: number): Interval[] {
  const rows = db.prepare(`
    SELECT ts.id, ts.ticket_id, ts.started_at, ts.ended_at
    FROM time_sessions ts
    WHERE ts.started_at < ? AND COALESCE(ts.ended_at, 0) > ?
      AND ts.ended_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM session_activity sa WHERE sa.session_id = ts.id)
  `).all(untilMs, sinceMs) as { id: string; ticket_id: string; started_at: number; ended_at: number }[]
  return rows.map(r => ({
    start: Math.max(r.started_at, sinceMs),
    end: Math.min(r.ended_at, untilMs),
    ticketId: r.ticket_id,
  })).filter(r => r.end > r.start)
}

/** All active intervals in [since, until), heartbeat-based + legacy fallback. */
export function getActiveIntervals(sinceMs: number, untilMs: number = Date.now()): Interval[] {
  const db = getDb()
  const minutes = db.prepare(
    'SELECT ticket_id, minute_ts FROM session_activity WHERE minute_ts >= ? AND minute_ts < ?'
  ).all(sinceMs, untilMs) as { ticket_id: string; minute_ts: number }[]
  const merged = mergeMinutes(minutes)
  return merged.concat(legacyIntervals(db, sinceMs, untilMs)).sort((a, b) => a.start - b.start)
}

/** Split an interval across local-day boundaries. */
export function splitByLocalDay(iv: Interval): Array<{ day: string; ms: number; ticketId: string }> {
  const parts: Array<{ day: string; ms: number; ticketId: string }> = []
  let cursor = iv.start
  while (cursor < iv.end) {
    const nextMidnight = localMidnight(cursor) + 24 * 3600_000
    const sliceEnd = Math.min(iv.end, nextMidnight)
    parts.push({ day: localDayKey(cursor), ms: sliceEnd - cursor, ticketId: iv.ticketId })
    cursor = sliceEnd
  }
  return parts
}

// ============================================================
// Completions — the tracker is the source of truth.
// Prefer issues_cache completedAt (Linear sets state.type='completed');
// supplement with locally observed status_changes using a broad
// done-name set. Dedup per ticket (latest wins).
// ============================================================

const DONE_NAMES = new Set(['done', 'completed', 'closed', 'resolved', 'shipped', 'merged', 'released'])

export function getCompletions(sinceMs: number): Array<{ ticketId: string; completedAt: number }> {
  const db = getDb()
  const byTicket = new Map<string, number>()

  const issueRows = db.prepare('SELECT id, data FROM issues_cache').all() as { id: string; data: string }[]
  for (const row of issueRows) {
    try {
      const p = JSON.parse(row.data)
      const stateType = p?.state?.type ?? ''
      const stateName = (p?.state?.name ?? '').toLowerCase()
      const isDone = stateType === 'completed' || DONE_NAMES.has(stateName)
      if (!isDone) continue
      const ts = p?.completedAt ? new Date(p.completedAt).getTime()
        : p?.updatedAt ? new Date(p.updatedAt).getTime() : NaN
      if (Number.isFinite(ts) && ts >= sinceMs) byTicket.set(row.id, ts)
    } catch {}
  }

  const scRows = db.prepare(
    'SELECT ticket_id, to_state, changed_at FROM status_changes WHERE changed_at >= ?'
  ).all(sinceMs) as { ticket_id: string; to_state: string; changed_at: number }[]
  for (const r of scRows) {
    if (!DONE_NAMES.has((r.to_state ?? '').toLowerCase())) continue
    const existing = byTicket.get(r.ticket_id)
    if (!existing || r.changed_at > existing) byTicket.set(r.ticket_id, r.changed_at)
  }

  return Array.from(byTicket.entries()).map(([ticketId, completedAt]) => ({ ticketId, completedAt }))
}

// ============================================================
// Public analytics queries (called from ipc.ts)
// ============================================================

export function getVelocity(weeks = 8): Array<{ weekStart: number; doneCount: number }> {
  const now = Date.now()
  const thisWeekStart = localWeekStart(now)
  const buckets = new Map<number, number>()
  for (let i = 0; i < weeks; i++) {
    const d = new Date(thisWeekStart)
    d.setDate(d.getDate() - i * 7)
    buckets.set(d.getTime(), 0)
  }
  const oldest = Math.min(...buckets.keys())
  for (const c of getCompletions(oldest)) {
    const key = localWeekStart(c.completedAt)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return Array.from(buckets.entries()).sort(([a], [b]) => a - b)
    .map(([weekStart, doneCount]) => ({ weekStart, doneCount }))
}

export function getFocus(): { terminalMinutes: number; deepWorkMinutes: number; deepBlocks: number; contextSwitches: number } {
  const since = Date.now() - 7 * 24 * 3600_000
  const intervals = getActiveIntervals(since)
  let activeMs = 0
  let deepMs = 0
  let deepBlocks = 0
  for (const iv of intervals) {
    const dur = iv.end - iv.start
    activeMs += dur
    if (dur >= DEEP_WORK_MIN_MS) { deepMs += dur; deepBlocks++ }
  }
  // Context switches: today, ordered intervals, count ticket changes
  const todayIvs = intervals.filter(iv => iv.end > localMidnight(Date.now()))
  let switches = 0
  for (let i = 1; i < todayIvs.length; i++) {
    if (todayIvs[i].ticketId !== todayIvs[i - 1].ticketId) switches++
  }
  return {
    terminalMinutes: Math.round(activeMs / MINUTE_MS),
    deepWorkMinutes: Math.round(deepMs / MINUTE_MS),
    deepBlocks,
    contextSwitches: switches,
  }
}

export function getAging(dayThreshold = 3): Array<{ ticketId: string; identifier: string; title: string; lastTouchedAt: number; daysStale: number; unknown: boolean }> {
  const db = getDb()
  const now = Date.now()
  const issueRows = db.prepare('SELECT id, data FROM issues_cache').all() as { id: string; data: string }[]
  const lastActivityStmt = db.prepare('SELECT MAX(minute_ts) as last FROM session_activity WHERE ticket_id = ?')
  const lastSessionStmt = db.prepare('SELECT MAX(started_at) as last FROM time_sessions WHERE ticket_id = ?')
  const results: Array<{ ticketId: string; identifier: string; title: string; lastTouchedAt: number; daysStale: number; unknown: boolean }> = []

  for (const row of issueRows) {
    let parsed: any
    try { parsed = JSON.parse(row.data) } catch { continue }
    const stateType: string = parsed?.state?.type ?? ''
    const stateName: string = (parsed?.state?.name ?? '').toLowerCase()
    if (!(stateType === 'started' || stateName.includes('progress'))) continue

    const candidates: number[] = []
    const a = (lastActivityStmt.get(row.id) as any)?.last
    const s = (lastSessionStmt.get(row.id) as any)?.last
    if (a) candidates.push(a)
    if (s) candidates.push(s)
    for (const key of ['updatedAt', 'updated_at', 'createdAt', 'created_at']) {
      if (parsed?.[key]) {
        const t = new Date(parsed[key]).getTime()
        if (Number.isFinite(t)) { candidates.push(t); break }
      }
    }

    const unknown = candidates.length === 0
    const lastTouchedAt = unknown ? 0 : Math.max(...candidates)
    const daysStale = unknown ? -1 : Math.floor((now - lastTouchedAt) / (24 * 3600_000))
    if (unknown || daysStale >= dayThreshold) {
      results.push({
        ticketId: row.id,
        identifier: parsed?.identifier ?? row.id,
        title: parsed?.title ?? row.id,
        lastTouchedAt,
        daysStale,
        unknown,
      })
    }
  }
  // Unknowns sort last; otherwise stalest first
  results.sort((a, b) => (a.unknown ? -1 : a.daysStale) < (b.unknown ? -1 : b.daysStale) ? 1 : -1)
  return results.slice(0, 10)
}

export function getStreak(): { currentStreak: number; longestStreak: number } {
  const db = getDb()
  const daySet = new Set<string>()
  const hb = db.prepare('SELECT DISTINCT minute_ts FROM session_activity').all() as { minute_ts: number }[]
  for (const r of hb) daySet.add(localDayKey(r.minute_ts))
  // Legacy sessions count too
  const legacy = db.prepare(`
    SELECT started_at FROM time_sessions ts
    WHERE NOT EXISTS (SELECT 1 FROM session_activity sa WHERE sa.session_id = ts.id)
  `).all() as { started_at: number }[]
  for (const r of legacy) daySet.add(localDayKey(r.started_at))

  let currentStreak = 0
  for (let i = 0; i < 365; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    if (daySet.has(localDayKey(d.getTime()))) currentStreak++
    else if (i > 0) break
  }

  const allDays = Array.from(daySet).sort()
  let longest = 0, cur = 0
  let prev: string | null = null
  for (const day of allDays) {
    if (prev) {
      const diff = Math.round((new Date(day + 'T00:00:00').getTime() - new Date(prev + 'T00:00:00').getTime()) / (24 * 3600_000))
      cur = diff === 1 ? cur + 1 : 1
    } else cur = 1
    if (cur > longest) longest = cur
    prev = day
  }
  return { currentStreak, longestStreak: longest }
}

function issueTitle(db: Database.Database, ticketId: string): { title: string; identifier: string } {
  try {
    const row = db.prepare('SELECT data FROM issues_cache WHERE id = ?').get(ticketId) as any
    if (row) {
      const p = JSON.parse(row.data)
      return { title: p.title || ticketId, identifier: p.identifier || ticketId }
    }
  } catch {}
  return { title: ticketId, identifier: ticketId }
}

export function getDashboard() {
  const db = getDb()
  const now = Date.now()
  const todayStart = localMidnight(now)
  const weekAgo = now - 7 * 24 * 3600_000
  const intervals = getActiveIntervals(Math.min(todayStart, weekAgo))

  // Per-day and per-ticket, midnight-split
  const byDayMap = new Map<string, { totalMs: number; tickets: Set<string> }>()
  const todayTicketMs = new Map<string, number>()
  for (const iv of intervals) {
    for (const part of splitByLocalDay(iv)) {
      const e = byDayMap.get(part.day)
      if (e) { e.totalMs += part.ms; e.tickets.add(part.ticketId) }
      else byDayMap.set(part.day, { totalMs: part.ms, tickets: new Set([part.ticketId]) })
      if (part.day === localDayKey(now)) {
        todayTicketMs.set(part.ticketId, (todayTicketMs.get(part.ticketId) ?? 0) + part.ms)
      }
    }
  }

  const todaySessions = Array.from(todayTicketMs.entries()).map(([ticketId, durationMs]) => ({
    ticketId,
    title: issueTitle(db, ticketId).title,
    durationMs,
    startedAt: todayStart,
  })).sort((a, b) => b.durationMs - a.durationMs)
  const todayTotalMs = todaySessions.reduce((s, x) => s + x.durationMs, 0)

  // Last 7 local days (always render 7 bars, zero-filled)
  const byDay: Array<{ date: string; totalMs: number; ticketCount: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = localDayKey(d.getTime())
    const e = byDayMap.get(key)
    byDay.push({ date: key, totalMs: e?.totalMs ?? 0, ticketCount: e?.tickets.size ?? 0 })
  }
  const weekTotalMs = byDay.reduce((s, d) => s + d.totalMs, 0)

  // In-progress tickets with progress %
  const inProgressRows = db.prepare(`
    SELECT p.ticket_id, p.percent FROM progress p WHERE p.percent > 0 AND p.percent < 100
  `).all() as any[]
  const inProgress = inProgressRows.map((row) => ({
    ticketId: row.ticket_id,
    title: issueTitle(db, row.ticket_id).title,
    percent: row.percent,
  }))

  const statusRows = db.prepare(`
    SELECT ticket_id, from_state, to_state, changed_at FROM status_changes
    ORDER BY changed_at DESC LIMIT 20
  `).all() as any[]
  const recentStatusChanges = statusRows.map((row) => ({
    ticketId: issueTitle(db, row.ticket_id).identifier,
    title: issueTitle(db, row.ticket_id).title,
    fromState: row.from_state,
    toState: row.to_state,
    changedAt: row.changed_at,
  }))

  // Project deadlines (unchanged mechanics)
  const projectDeadlines: any[] = []
  const seen = new Set<string>()
  for (const table of ['project_details_cache', 'projects_cache']) {
    const rows = db.prepare(`SELECT id, data FROM ${table}`).all() as any[]
    for (const row of rows) {
      try {
        const p = JSON.parse(row.data)
        if (p.targetDate && !seen.has(row.id)) {
          seen.add(row.id)
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
  }
  projectDeadlines.sort((a, b) => a.targetDate.localeCompare(b.targetDate))

  return {
    today: { sessions: todaySessions, totalMs: todayTotalMs, ticketCount: todayTicketMs.size },
    week: { byDay, totalMs: weekTotalMs },
    inProgress,
    recentStatusChanges,
    projectDeadlines,
  }
}

export function exportCsv(from?: number, to?: number): string {
  const db = getDb()
  const since = from ?? 0
  const until = to ?? Date.now()
  const rows = db.prepare(`
    SELECT ts.id, ts.ticket_id, ic.data, ts.started_at, ts.ended_at, ts.exit_code, ts.summary
    FROM time_sessions ts
    LEFT JOIN issues_cache ic ON ic.id = ts.ticket_id
    WHERE ts.started_at >= ? AND ts.started_at <= ?
    ORDER BY ts.started_at ASC
  `).all(since, until) as any[]

  const activeStmt = db.prepare('SELECT COUNT(*) as c FROM session_activity WHERE session_id = ?')
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const lines = ['ticket_id,identifier,started_at,ended_at,span_minutes,active_minutes,exit_code,summary']
  for (const r of rows) {
    let identifier = r.ticket_id
    try { identifier = JSON.parse(r.data ?? '{}')?.identifier ?? r.ticket_id } catch {}
    const spanMin = (((r.ended_at ?? Date.now()) - r.started_at) / MINUTE_MS).toFixed(2)
    const activeMin = (activeStmt.get(r.id) as any)?.c ?? 0
    lines.push([
      escape(r.ticket_id), escape(identifier),
      escape(new Date(r.started_at).toISOString()),
      escape(r.ended_at ? new Date(r.ended_at).toISOString() : ''),
      spanMin, String(activeMin),
      r.exit_code ?? '', escape(r.summary ?? ''),
    ].join(','))
  }
  return lines.join('\n')
}
