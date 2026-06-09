import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAppStore } from '../store'
import type { LinearIssue } from '../types'

const STATE_COLORS: Record<string, string> = {
  backlog: '#6B7280',
  unstarted: '#9CA3AF',
  started: '#3B82F6',
  completed: '#10B981',
  cancelled: '#6B7280'
}

const PRIORITY_MAP: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
}

const STATE_TYPES = new Set(['started', 'backlog', 'completed', 'unstarted', 'cancelled'])

interface ParsedQuery {
  text: string
  priority: number | null
  stateType: string | null
}

function parseQuery(query: string): ParsedQuery {
  const tokens = query.split(/\s+/).filter(Boolean)
  let priority: number | null = null
  let stateType: string | null = null
  const remaining: string[] = []
  for (const tok of tokens) {
    const lower = tok.toLowerCase()
    if (lower.startsWith('p:')) {
      const key = lower.slice(2)
      if (key in PRIORITY_MAP) {
        priority = PRIORITY_MAP[key]
        continue
      }
    }
    if (lower.startsWith('s:')) {
      const key = lower.slice(2)
      if (STATE_TYPES.has(key)) {
        stateType = key
        continue
      }
    }
    remaining.push(tok)
  }
  return { text: remaining.join(' '), priority, stateType }
}

function fuzzyMatch(text: string, issue: LinearIssue): boolean {
  if (!text.trim()) return true
  const haystack = `${issue.identifier} ${issue.title}`.toLowerCase()
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  return words.every((w) => haystack.includes(w))
}

export function CommandPalette() {
  const { setCommandPaletteOpen, issues, openTab, tabs, recentIssueIds } = useAppStore()
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const allIssues: LinearIssue[] = useMemo(() => Object.values(issues).flat(), [issues])

  const parsed = useMemo(() => parseQuery(query), [query])

  const filtered: LinearIssue[] = useMemo(() => {
    let pool = allIssues.filter((i) => {
      if (parsed.priority !== null && i.priority !== parsed.priority) return false
      if (parsed.stateType !== null && i.state.type !== parsed.stateType) return false
      return fuzzyMatch(parsed.text, i)
    })

    if (!query.trim()) {
      // Default ordering: open tabs first, then recents in order, then everything else
      const tabIds = new Set(tabs.map((t) => t.id))
      const recentSet = new Set(recentIssueIds)
      const byId = new Map(pool.map((i) => [i.id, i]))

      const result: LinearIssue[] = []
      const used = new Set<string>()

      for (const t of tabs) {
        const issue = byId.get(t.id)
        if (issue && !used.has(issue.id)) {
          result.push(issue)
          used.add(issue.id)
        }
      }
      for (const rid of recentIssueIds) {
        if (used.has(rid)) continue
        const issue = byId.get(rid)
        if (issue) {
          result.push(issue)
          used.add(issue.id)
        }
      }
      for (const issue of pool) {
        if (!used.has(issue.id)) {
          if (!tabIds.has(issue.id) && !recentSet.has(issue.id)) {
            result.push(issue)
            used.add(issue.id)
          }
        }
      }
      return result.slice(0, 20)
    }

    return pool.slice(0, 20)
  }, [allIssues, parsed, query, tabs, recentIssueIds])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSelect = useCallback(
    (issue: LinearIssue) => {
      openTab(issue)
      setCommandPaletteOpen(false)
    },
    [openTab, setCommandPaletteOpen]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        if (filtered[selectedIdx]) {
          handleSelect(filtered[selectedIdx])
        }
      }
    },
    [filtered, selectedIdx, handleSelect, setCommandPaletteOpen]
  )

  const isOpenInTab = (issue: LinearIssue) => tabs.some((t) => t.id === issue.id)

  // Group by project for header display when multiple projects appear
  const projectNames = useMemo(() => {
    const set = new Set<string>()
    for (const i of filtered) set.add(i.project?.name ?? 'No Project')
    return set
  }, [filtered])

  const showProjectHeaders = projectNames.size > 1

  // Build a flat render list with optional project headers; track indices for keyboard nav
  const renderItems = useMemo(() => {
    if (!showProjectHeaders) {
      return filtered.map((issue, idx) => ({ kind: 'issue' as const, issue, idx }))
    }
    const result: Array<
      | { kind: 'header'; project: string }
      | { kind: 'issue'; issue: LinearIssue; idx: number }
    > = []
    let lastProject: string | null = null
    filtered.forEach((issue, idx) => {
      const proj = issue.project?.name ?? 'No Project'
      if (proj !== lastProject) {
        result.push({ kind: 'header', project: proj })
        lastProject = proj
      }
      result.push({ kind: 'issue', issue, idx })
    })
    return result
  }, [filtered, showProjectHeaders])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      onClick={() => setCommandPaletteOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search issues... (try p:high, s:started)"
            className="flex-1 bg-transparent text-gray-100 placeholder-gray-600 text-sm focus:outline-none"
          />
          <kbd className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-600">
              {query ? 'No issues match your search' : 'Start typing to search issues...'}
            </div>
          ) : (
            renderItems.map((item, key) => {
              if (item.kind === 'header') {
                return (
                  <div
                    key={`h-${item.project}-${key}`}
                    className="px-4 py-1 bg-gray-900/80 text-xs uppercase tracking-wider text-gray-600 border-t border-gray-800"
                  >
                    {item.project}
                  </div>
                )
              }
              const issue = item.issue
              const idx = item.idx
              const stateColor = STATE_COLORS[issue.state.type] || '#6B7280'
              const openInTab = isOpenInTab(issue)
              return (
                <div
                  key={issue.id}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    idx === selectedIdx ? 'bg-indigo-600/20' : 'hover:bg-gray-800/50'
                  }`}
                  onClick={() => handleSelect(issue)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: stateColor }}
                  />
                  <span className="font-mono text-xs text-gray-500 flex-shrink-0 w-16">{issue.identifier}</span>
                  <span className="flex-1 text-sm text-gray-200 truncate">{issue.title}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {openInTab && (
                      <span className="text-xs text-indigo-400 bg-indigo-900/40 px-1.5 py-0.5 rounded">open</span>
                    )}
                    <span
                      className="text-xs px-2 py-0.5 rounded-full border"
                      style={{
                        borderColor: stateColor + '60',
                        backgroundColor: stateColor + '20',
                        color: stateColor
                      }}
                    >
                      {issue.state.name}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-4 text-xs text-gray-600">
          <span><kbd className="bg-gray-800 px-1 py-0.5 rounded border border-gray-700">↑↓</kbd> navigate</span>
          <span><kbd className="bg-gray-800 px-1 py-0.5 rounded border border-gray-700">↵</kbd> open</span>
          <span><kbd className="bg-gray-800 px-1 py-0.5 rounded border border-gray-700">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
