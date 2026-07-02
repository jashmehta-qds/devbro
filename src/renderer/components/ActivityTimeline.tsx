import React, { useEffect, useState } from 'react'
import { Markdown } from './Markdown'

interface ActivityEvent {
  id: string
  type: 'session' | 'status' | 'progress'
  at: number
  data: any
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  if (h < 48) {
    const hh = ts
    const d = new Date(hh)
    return `Yesterday ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dayKey(ts: number): string {
  const now = new Date()
  const d = new Date(ts)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const dMid = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (dMid.getTime() === today.getTime()) return 'Today'
  if (dMid.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return '< 1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function SessionRow({ event, onViewDiff }: { event: ActivityEvent; onViewDiff?: () => void }) {
  const [open, setOpen] = useState(false)
  const { gitStartSha, exitCode, started_at, ended_at, summary } = event.data || {}
  const duration = ended_at ? formatDuration(ended_at - started_at) : null

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-violet-500 ring-2 ring-gray-950 mt-0.5" />
        <div className="w-px flex-1 bg-gray-800 mt-1" />
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-200 font-medium">Terminal session</span>
          {duration && <span className="text-[11px] text-gray-500">{duration}</span>}
          {exitCode !== undefined && exitCode !== null && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md border ${
              exitCode === 0
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-red-400 bg-red-500/10 border-red-500/20'
            }`}>
              exit {exitCode}
            </span>
          )}
          <span className="ml-auto text-[10px] text-gray-600 flex-shrink-0">{relativeTime(event.at)}</span>
        </div>
        {summary && (
          <button
            onClick={() => setOpen(o => !o)}
            className="text-[11px] text-gray-400 mt-1 text-left hover:text-gray-200 transition-colors line-clamp-2"
          >
            {summary}
          </button>
        )}
        {open && summary && (
          <div className="mt-2 text-xs text-gray-400 leading-relaxed border-l-2 border-gray-800 pl-3">
            <Markdown>{summary}</Markdown>
          </div>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {gitStartSha && (
            <span className="text-[10px] font-mono text-gray-600" title="Git SHA at session start">
              {String(gitStartSha).slice(0, 7)}
            </span>
          )}
          {onViewDiff && (
            <button
              onClick={onViewDiff}
              className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
            >
              View diff
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusRow({ event }: { event: ActivityEvent }) {
  const { from_state, to_state } = event.data || {}
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-gray-950 mt-0.5" />
        <div className="w-px flex-1 bg-gray-800 mt-1" />
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-200 font-medium">Status changed</span>
          <div className="flex items-center gap-1 text-[11px]">
            {from_state && <span className="text-gray-500">{from_state}</span>}
            {from_state && <span className="text-gray-600">→</span>}
            <span className="px-1.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-300">{to_state}</span>
          </div>
          <span className="ml-auto text-[10px] text-gray-600 flex-shrink-0">{relativeTime(event.at)}</span>
        </div>
      </div>
    </div>
  )
}

function ProgressRow({ event }: { event: ActivityEvent }) {
  const [open, setOpen] = useState(false)
  const { percent, log } = event.data || {}
  const preview = log ? log.split('\n').slice(0, 1).join('\n') : null

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-gray-950 mt-0.5" />
        <div className="w-px flex-1 bg-gray-800 mt-1" />
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-200 font-medium">Progress updated</span>
          {percent !== undefined && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{percent}%</span>
          )}
          <span className="ml-auto text-[10px] text-gray-600 flex-shrink-0">{relativeTime(event.at)}</span>
        </div>
        {preview && (
          <button
            onClick={() => setOpen(o => !o)}
            className="text-[11px] text-gray-500 mt-1 text-left hover:text-gray-300 transition-colors truncate max-w-full"
          >
            {preview}
          </button>
        )}
        {open && log && (
          <div className="mt-2 text-xs text-gray-400 leading-relaxed border-l-2 border-gray-800 pl-3 line-clamp-3">
            <Markdown>{log.split('\n').slice(0, 3).join('\n')}</Markdown>
          </div>
        )}
      </div>
    </div>
  )
}

export function ActivityTimeline({ ticketId, onSwitchToDiff }: {
  ticketId: string
  onSwitchToDiff?: () => void
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    window.api.activity.getForTicket(ticketId)
      .then((data: ActivityEvent[]) => setEvents(data))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [ticketId])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-600 text-center px-4">
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs">No activity yet — start a Claude session to log progress</p>
      </div>
    )
  }

  // Group by day
  const groups: Array<{ day: string; events: ActivityEvent[] }> = []
  for (const ev of events) {
    const day = dayKey(ev.at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) {
      last.events.push(ev)
    } else {
      groups.push({ day, events: [ev] })
    }
  }

  return (
    <div className="overflow-y-auto">
      {groups.map((group) => (
        <div key={group.day}>
          <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-3 mt-1">{group.day}</div>
          {group.events.map((ev) => {
            if (ev.type === 'session') return <SessionRow key={ev.id} event={ev} onViewDiff={onSwitchToDiff} />
            if (ev.type === 'status') return <StatusRow key={ev.id} event={ev} />
            if (ev.type === 'progress') return <ProgressRow key={ev.id} event={ev} />
            return null
          })}
        </div>
      ))}
    </div>
  )
}
