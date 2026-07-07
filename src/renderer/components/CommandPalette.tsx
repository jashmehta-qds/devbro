import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAppStore } from '../store'
import { useTerminal } from '../hooks/useTerminal'
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

interface AppCommand {
  id: string
  label: string
  desc: string
  run: (ctx: CommandContext) => void
}

interface CommandContext {
  openStandup: () => void
  openAnalytics: () => void
  openSettings: () => void
  refresh: () => void
  toggleTerminal: () => void
  openTerminalForCurrent: () => void
  exportCsv: () => void
  refreshAnalytics: () => void
  closeCommandPalette: () => void
}

const COMMANDS: AppCommand[] = [
  { id: 'toggle-terminal', label: 'Toggle terminal (⌘J)', desc: 'Show or hide the terminal drawer', run: (ctx) => { ctx.toggleTerminal(); ctx.closeCommandPalette() } },
  { id: 'open-terminal', label: 'Open terminal for current ticket', desc: 'Start / focus a Claude session', run: (ctx) => { ctx.openTerminalForCurrent(); ctx.closeCommandPalette() } },
  { id: 'standup', label: 'Generate standup', desc: 'Draft daily standup', run: (ctx) => { ctx.openStandup(); ctx.closeCommandPalette() } },
  { id: 'export-csv', label: 'Export analytics CSV', desc: 'Download session data as CSV', run: (ctx) => { ctx.exportCsv(); ctx.closeCommandPalette() } },
  { id: 'refresh-analytics', label: 'Refresh analytics', desc: 'Reload analytics data', run: (ctx) => { ctx.refreshAnalytics(); ctx.closeCommandPalette() } },
  { id: 'dashboard', label: 'Go to Analytics', desc: 'Open analytics dashboard', run: (ctx) => { ctx.openAnalytics(); ctx.closeCommandPalette() } },
  { id: 'settings', label: 'Go to Settings', desc: 'Open project configuration', run: (ctx) => { ctx.openSettings(); ctx.closeCommandPalette() } },
  { id: 'refresh', label: 'Refresh issues', desc: 'Reload issues from tracker', run: (ctx) => { ctx.refresh(); ctx.closeCommandPalette() } },
]

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

const Kbd = ({ children, large }: { children: React.ReactNode; large?: boolean }) => (
  <span className={`inline-flex items-center justify-center font-mono border border-gray-700/50 bg-gray-800 text-gray-400 rounded-md ${large ? 'min-w-[24px] h-6 px-1.5 text-xs' : 'min-w-[20px] h-5 px-1.5 text-[11px]'}`}>
    {children}
  </span>
)

const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const IconCommand = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
  </svg>
)

const IconHash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </svg>
)

export function CommandPalette() {
  const {
    setCommandPaletteOpen,
    issues,
    openTab,
    tabs,
    recentIssueIds,
    setStandupOpen,
    openDashboardTab,
    openSettingsTab,
    setIsSyncing,
    toggleDrawer,
    addNotification,
  } = useAppStore()
  const { openTerminal } = useTerminal()
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const allIssues: LinearIssue[] = useMemo(() => Object.values(issues).flat(), [issues])

  const mode = useMemo(() => {
    if (query.startsWith('>')) return 'command'
    if (query.startsWith('#')) return 'identifier'
    return 'issue'
  }, [query])

  const commandCtx: CommandContext = useMemo(() => ({
    openStandup: () => setStandupOpen(true),
    openAnalytics: () => openDashboardTab(),
    openSettings: () => openSettingsTab(),
    refresh: () => setIsSyncing(true),
    toggleTerminal: () => toggleDrawer(),
    openTerminalForCurrent: () => {
      const issue = useAppStore.getState().selectedIssue
      if (issue) void openTerminal(80, 30)
      else addNotification('Open a ticket first to start a terminal')
    },
    exportCsv: async () => {
      try {
        const csv = await window.api.analytics.exportCsv()
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'devbro-export.csv'
        a.click()
        URL.revokeObjectURL(url)
        addNotification('Analytics CSV exported')
      } catch {
        addNotification('CSV export failed')
      }
    },
    refreshAnalytics: () => { openDashboardTab() },
    closeCommandPalette: () => setCommandPaletteOpen(false),
  }), [setStandupOpen, openDashboardTab, openSettingsTab, setIsSyncing, toggleDrawer, openTerminal, addNotification, setCommandPaletteOpen])

  const filteredCommands = useMemo(() => {
    if (mode !== 'command') return []
    const searchText = query.slice(1).toLowerCase().trim()
    if (!searchText) return COMMANDS.slice(0, 20)
    return COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(searchText)).slice(0, 20)
  }, [query, mode])

  const filteredByIdentifier = useMemo(() => {
    if (mode !== 'identifier') return []
    const searchId = query.slice(1).toLowerCase()
    if (!searchId) return []
    return allIssues.filter((i) => i.identifier.toLowerCase().includes(searchId)).slice(0, 20)
  }, [query, mode, allIssues])

  const parsed = useMemo(() => parseQuery(query), [query])

  const filteredIssues: LinearIssue[] = useMemo(() => {
    if (mode !== 'issue') return []

    let pool = allIssues.filter((i) => {
      if (parsed.priority !== null && i.priority !== parsed.priority) return false
      if (parsed.stateType !== null && i.state.type !== parsed.stateType) return false
      return fuzzyMatch(parsed.text, i)
    })

    if (!query.trim()) {
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
  }, [mode, allIssues, parsed, query, tabs, recentIssueIds])

  const filtered = useMemo(() => {
    if (mode === 'command') return filteredCommands as any[]
    if (mode === 'identifier') return filteredByIdentifier as any[]
    return filteredIssues as any[]
  }, [mode, filteredCommands, filteredByIdentifier, filteredIssues])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSelectIssue = useCallback(
    (issue: LinearIssue) => {
      openTab(issue)
      setCommandPaletteOpen(false)
    },
    [openTab, setCommandPaletteOpen]
  )

  const handleSelectCommand = useCallback(
    (cmd: AppCommand) => {
      cmd.run(commandCtx)
    },
    [commandCtx]
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
        const item = filtered[selectedIdx]
        if (!item) return
        if (mode === 'command') {
          handleSelectCommand(item as AppCommand)
        } else {
          handleSelectIssue(item as LinearIssue)
        }
      }
    },
    [filtered, selectedIdx, mode, handleSelectCommand, handleSelectIssue, setCommandPaletteOpen]
  )

  const isOpenInTab = (issue: LinearIssue) => tabs.some((t) => t.id === issue.id)

  const projectNames = useMemo(() => {
    const set = new Set<string>()
    if (mode === 'issue') {
      for (const i of filteredIssues) set.add((i as LinearIssue).project?.name ?? 'No Project')
    }
    return set
  }, [filteredIssues, mode])

  const showProjectHeaders = projectNames.size > 1

  const renderItems = useMemo(() => {
    if (mode === 'command') {
      return filteredCommands.map((cmd, idx) => ({ kind: 'command' as const, cmd, idx }))
    }

    if (mode === 'identifier') {
      return filteredByIdentifier.map((issue, idx) => ({ kind: 'issue' as const, issue, idx }))
    }

    if (!showProjectHeaders) {
      return filteredIssues.map((issue, idx) => ({ kind: 'issue' as const, issue, idx }))
    }

    const result: Array<
      | { kind: 'header'; project: string }
      | { kind: 'issue'; issue: LinearIssue; idx: number }
    > = []
    let lastProject: string | null = null
    filteredIssues.forEach((issue, idx) => {
      const proj = issue.project?.name ?? 'No Project'
      if (proj !== lastProject) {
        result.push({ kind: 'header', project: proj })
        lastProject = proj
      }
      result.push({ kind: 'issue', issue, idx })
    })
    return result
  }, [mode, filteredCommands, filteredByIdentifier, filteredIssues, showProjectHeaders])

  const placeholder =
    mode === 'command' ? 'Run a command…' :
    mode === 'identifier' ? 'Jump to identifier…' :
    'Search issues, type > for commands, # for ID lookup'

  const modeDot =
    mode === 'command' ? 'bg-violet-500' :
    mode === 'identifier' ? 'bg-amber-500' :
    'bg-blue-500'

  const modeLabel =
    mode === 'command' ? 'Commands' :
    mode === 'identifier' ? 'Identifier' :
    'Issues'

  const emptyIcon =
    mode === 'command' ? <IconCommand /> :
    mode === 'identifier' ? <IconHash /> :
    <IconSearch />

  const emptyHint =
    mode === 'command' ? 'No commands matched' :
    mode === 'identifier' ? 'No issue found with that identifier' :
    'Try removing filters or different keywords'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 animate-fade-in"
      style={{ paddingTop: '20vh' }}
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

      <div
        className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl shadow-pop overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 h-14 border-b border-gray-800">
          <span className="text-gray-500 flex-shrink-0">
            <IconSearch />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-base text-gray-50 placeholder:text-gray-500 outline-none"
          />
          <Kbd large>⌘K</Kbd>
        </div>

        <div className="max-h-[420px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2">
              <span className="text-gray-600">{emptyIcon}</span>
              <span className="text-sm text-gray-400">No matches</span>
              <span className="text-xs text-gray-500">{emptyHint}</span>
            </div>
          ) : (
            <>
              {mode === 'command' && (
                <div className="text-[10px] tracking-[0.14em] text-gray-500 font-medium px-5 pt-3 pb-1.5 uppercase">
                  Commands
                </div>
              )}
              {mode === 'identifier' && (
                <div className="text-[10px] tracking-[0.14em] text-gray-500 font-medium px-5 pt-3 pb-1.5 uppercase">
                  Identifier
                </div>
              )}
              {renderItems.map((item, key) => {
                if (item.kind === 'header') {
                  return (
                    <div
                      key={`h-${item.project}-${key}`}
                      className="text-[10px] tracking-[0.14em] text-gray-500 font-medium px-5 pt-3 pb-1.5 uppercase"
                    >
                      {item.project}
                    </div>
                  )
                }

                if (item.kind === 'command') {
                  const cmd = item.cmd
                  const idx = item.idx
                  const selected = idx === selectedIdx
                  return (
                    <div
                      key={cmd.id}
                      className={`relative flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-colors duration-150 ease-out-quart ${selected ? 'bg-violet-500/10 text-gray-50' : 'text-gray-300 hover:bg-gray-800/40'}`}
                      onClick={() => handleSelectCommand(cmd)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      {selected && (
                        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-violet-500" />
                      )}
                      <span className={selected ? 'text-violet-400' : 'text-gray-500'}>
                        <IconCommand />
                      </span>
                      <span className="flex-1 flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-medium leading-none">{cmd.label}</span>
                        <span className="text-xs text-gray-500 leading-none mt-1">{cmd.desc}</span>
                      </span>
                    </div>
                  )
                }

                const issue = item.issue
                const idx = item.idx
                const selected = idx === selectedIdx
                const stateColor = STATE_COLORS[issue.state.type] || '#6B7280'
                const openInTab = isOpenInTab(issue)
                return (
                  <div
                    key={issue.id}
                    className={`relative flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-colors duration-150 ease-out-quart ${selected ? 'bg-violet-500/10 text-gray-50' : 'text-gray-300 hover:bg-gray-800/40'}`}
                    onClick={() => handleSelectIssue(issue)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    {selected && (
                      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-violet-500" />
                    )}
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stateColor }}
                    />
                    <span className="font-mono text-xs text-gray-500 flex-shrink-0 w-16">{issue.identifier}</span>
                    <span className="flex-1 text-sm truncate">{issue.title}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {openInTab && (
                        <Kbd>open</Kbd>
                      )}
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded border font-mono"
                        style={{
                          borderColor: stateColor + '50',
                          backgroundColor: stateColor + '18',
                          color: stateColor
                        }}
                      >
                        {issue.state.name}
                      </span>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        <div className="h-9 px-5 flex items-center justify-between border-t border-gray-800 text-[11px] text-gray-500">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${modeDot}`} />
            <span>{modeLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <Kbd>↑↓</Kbd>
            <span>navigate</span>
            <Kbd>↵</Kbd>
            <span>open</span>
            <Kbd>esc</Kbd>
            <span>close</span>
          </div>
        </div>
      </div>
    </div>
  )
}
