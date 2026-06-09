import React, { useEffect, useState, useCallback } from 'react'
import { ProgressBar } from './ProgressBar'
import type { AnalyticsDashboard as AnalyticsDashboardData, ProjectDeadlineEntry } from '../types'

function formatMs(ms: number): string {
  if (ms < 60_000) return '< 1m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDeadlineDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function DeadlineBadge({ days }: { days: number }) {
  if (days < 0) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/50 font-medium flex-shrink-0">
        {Math.abs(days)}d overdue
      </span>
    )
  }
  if (days === 0) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/50 font-medium flex-shrink-0">
        Today
      </span>
    )
  }
  if (days <= 7) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/50 font-medium flex-shrink-0">
        {days}d
      </span>
    )
  }
  if (days <= 30) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-500 border border-yellow-800/30 font-medium flex-shrink-0">
        {days}d
      </span>
    )
  }
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700 font-medium flex-shrink-0">
      {days}d
    </span>
  )
}

function DeadlineRow({ d }: { d: ProjectDeadlineEntry }) {
  const days = daysUntil(d.targetDate)
  const stateLabel = d.state === 'started' ? 'In Progress' : d.state === 'completed' ? 'Completed' : d.state === 'paused' ? 'Paused' : d.state ?? ''

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-800/60 last:border-0">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: d.color || '#6366f1' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm text-gray-200 truncate font-medium">{d.name}</span>
          {stateLabel && (
            <span className="text-xs text-gray-600 flex-shrink-0">{stateLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${d.progress}%`, backgroundColor: d.color || '#6366f1', opacity: 0.7 }}
            />
          </div>
          <span className="text-xs text-gray-600 w-8 text-right flex-shrink-0">{d.progress}%</span>
          <span className="text-xs text-gray-600 flex-shrink-0">{formatDeadlineDate(d.targetDate)}</span>
        </div>
      </div>
      <DeadlineBadge days={days} />
    </div>
  )
}

const DAY_LABELS: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }

export function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const result = await window.api.analytics.getDashboard()
      setData(result)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-900">
        <div className="text-gray-500 text-sm">Loading analytics...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-900">
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    )
  }

  if (!data) return null

  const maxWeekMs = Math.max(...data.week.byDay.map((d) => d.totalMs), 1)

  // Split deadlines: overdue / upcoming
  const overdueDeadlines = data.projectDeadlines.filter((d) => daysUntil(d.targetDate) < 0)
  const upcomingDeadlines = data.projectDeadlines.filter((d) => daysUntil(d.targetDate) >= 0)

  return (
    <div className="flex-1 overflow-y-auto bg-gray-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Analytics</h2>
          <p className="text-xs text-gray-500 mt-0.5">Your productivity at a glance</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-gray-800"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Project Deadlines */}
        {data.projectDeadlines.length > 0 && (
          <div className="bg-gray-800/40 rounded-xl border border-gray-800">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Project Deadlines</p>
              <span className="text-xs text-gray-600">{data.projectDeadlines.length} project{data.projectDeadlines.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="px-4 pb-2">
              {overdueDeadlines.length > 0 && (
                <>
                  <p className="text-xs text-red-500/70 uppercase tracking-wider mb-1 mt-1">Overdue</p>
                  {overdueDeadlines.map((d) => <DeadlineRow key={d.id} d={d} />)}
                  {upcomingDeadlines.length > 0 && <p className="text-xs text-gray-600 uppercase tracking-wider mb-1 mt-3">Upcoming</p>}
                </>
              )}
              {upcomingDeadlines.map((d) => <DeadlineRow key={d.id} d={d} />)}
            </div>
          </div>
        )}

        {/* Today + Week — side by side */}
        <div className="grid grid-cols-2 gap-4">
          {/* Today */}
          <div className="bg-gray-800/40 rounded-xl border border-gray-800 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Today</p>
            <div className="flex items-baseline gap-4 mb-4">
              <div>
                <p className="text-2xl font-bold text-gray-100">{formatMs(data.today.totalMs)}</p>
                <p className="text-xs text-gray-600">coded</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-100">{data.today.ticketCount}</p>
                <p className="text-xs text-gray-600">ticket{data.today.ticketCount !== 1 ? 's' : ''}</p>
              </div>
            </div>
            {data.today.sessions.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No sessions yet today.</p>
            ) : (
              <div className="space-y-2">
                {data.today.sessions.map((s) => {
                  const pct = data.today.totalMs > 0 ? (s.durationMs / data.today.totalMs) * 100 : 0
                  return (
                    <div key={s.ticketId}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-gray-300 truncate max-w-[140px]">{s.title}</span>
                        <span className="text-xs text-gray-500 ml-1 flex-shrink-0">{formatMs(s.durationMs)}</span>
                      </div>
                      <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* This Week */}
          <div className="bg-gray-800/40 rounded-xl border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">This Week</p>
              <span className="text-xs text-gray-500">{formatMs(data.week.totalMs)}</span>
            </div>
            {data.week.byDay.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No sessions this week.</p>
            ) : (
              <div className="flex items-end gap-1.5 h-20">
                {data.week.byDay.map((d) => {
                  const heightPct = (d.totalMs / maxWeekMs) * 100
                  const dayLabel = DAY_LABELS[new Date(d.date + 'T00:00:00').getDay()] || d.date.slice(5)
                  const isToday = d.date === new Date().toISOString().slice(0, 10)
                  return (
                    <div key={d.date} className="flex flex-col items-center flex-1 gap-1">
                      <div className="w-full flex items-end" style={{ height: 56 }}>
                        <div
                          className={`w-full rounded-t transition-all ${isToday ? 'bg-indigo-500' : 'bg-indigo-500/40'}`}
                          style={{ height: `${Math.max(heightPct, 6)}%` }}
                          title={`${d.date}: ${formatMs(d.totalMs)}`}
                        />
                      </div>
                      <span className={`text-xs ${isToday ? 'text-indigo-400' : 'text-gray-600'}`}>{dayLabel}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* In Progress */}
        {data.inProgress.length > 0 && (
          <div className="bg-gray-800/40 rounded-xl border border-gray-800 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">In Progress</p>
            <div className="space-y-3">
              {data.inProgress.map((item) => (
                <div key={item.ticketId}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-300 truncate max-w-xs">{item.title}</span>
                    <span className="text-xs text-gray-500 ml-2 flex-shrink-0 font-mono">{item.percent}%</span>
                  </div>
                  <ProgressBar percent={item.percent} showLabel={false} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Status Changes */}
        {data.recentStatusChanges.length > 0 && (
          <div className="bg-gray-800/40 rounded-xl border border-gray-800 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Recent Status Changes</p>
            <div className="space-y-2">
              {data.recentStatusChanges.slice(0, 8).map((sc, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 py-1 border-b border-gray-800/50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-gray-600 flex-shrink-0">{sc.ticketId}</span>
                    <span className="text-gray-700">→</span>
                    <span className="text-xs text-gray-300">{sc.toState}</span>
                    {sc.fromState && (
                      <span className="text-xs text-gray-600">from {sc.fromState}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-600 flex-shrink-0">{relativeTime(sc.changedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.projectDeadlines.length === 0 && data.inProgress.length === 0 && data.today.sessions.length === 0 && (
          <div className="text-center py-12 text-gray-600 text-sm">
            No data yet — start a Claude session to track time.
          </div>
        )}
      </div>
    </div>
  )
}
