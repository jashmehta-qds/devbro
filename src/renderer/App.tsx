import React, { useCallback, useRef, useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { TicketView } from './components/TicketView'
import { TerminalPanel } from './components/TerminalPanel'
import { ProjectConfigPanel } from './components/ProjectConfigPanel'
import { AnalyticsDashboard } from './components/AnalyticsDashboard'
import { ProjectView } from './components/ProjectView'
import { TabBar } from './components/TabBar'
import { CommandPalette } from './components/CommandPalette'
import { StandupModal } from './components/StandupModal'
import { useAppStore } from './store'
import { useTerminal } from './hooks/useTerminal'

const TERMINAL_MIN = 280
const TERMINAL_MAX = 1100
const TERMINAL_DEFAULT = 420
const SIDEBAR_COLLAPSED_KEY = 'devbro-sidebar-collapsed'

function loadSidebarCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true' } catch { return false }
}

export default function App() {
  const store = useAppStore()
  const terminalOpen = store.terminalOpen
  const settingsOpen = store.settingsOpen
  const dashboardOpen = store.dashboardOpen
  const standupOpen = store.standupOpen
  const activeProjectId = store.activeProjectId
  const commandPaletteOpen = store.commandPaletteOpen
  const tabs = store.tabs
  const activeTabId = store.activeTabId
  const selectedIssue = store.selectedIssue
  const notifications = store.notifications
  const {
    setCommandPaletteOpen,
    setStandupOpen,
    focusTab,
    closeTab,
    updateTab,
    addNotification,
    dismissNotification,
    setTerminalOpen,
    setProgress,
  } = store
  const { closeTerminal, openTerminal } = useTerminal()

  // Refs to avoid stale closures in shortcuts/listeners
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const selectedIssueRef = useRef(selectedIssue)
  const terminalOpenRef = useRef(terminalOpen)
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { selectedIssueRef.current = selectedIssue }, [selectedIssue])
  useEffect(() => { terminalOpenRef.current = terminalOpen }, [terminalOpen])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed)
  const [terminalWidth, setTerminalWidth] = useState(TERMINAL_DEFAULT)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleCloseTerminal = useCallback(async () => {
    await closeTerminal()
  }, [closeTerminal])

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = terminalWidth
    e.preventDefault()
  }, [terminalWidth])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      // Dragging left increases terminal width
      const delta = startX.current - e.clientX
      const next = Math.min(TERMINAL_MAX, Math.max(TERMINAL_MIN, startWidth.current + delta))
      setTerminalWidth(next)
    }
    const onMouseUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      const target = document.activeElement
      const inEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        (target as HTMLElement | null)?.isContentEditable === true

      // Cmd+B — toggle sidebar
      if (e.key === 'b' && !e.shiftKey) {
        e.preventDefault()
        setSidebarCollapsed(c => {
          const next = !c
          try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)) } catch {}
          return next
        })
        return
      }

      // Cmd+K — command palette
      if (e.key === 'k' && !e.shiftKey) {
        e.preventDefault()
        setCommandPaletteOpen(true)
        return
      }

      // Cmd+Shift+] — next tab; Cmd+Shift+[ — prev tab
      if (e.shiftKey && (e.key === ']' || e.key === '[')) {
        const list = tabsRef.current
        if (list.length === 0) return
        const currentId = activeTabIdRef.current
        const idx = list.findIndex((t) => t.id === currentId)
        const nextIdx = e.key === ']'
          ? (idx + 1) % list.length
          : (idx - 1 + list.length) % list.length
        e.preventDefault()
        focusTab(list[nextIdx].id)
        return
      }

      // Cmd+1..8 — focus tab N
      if (!e.shiftKey && /^[1-8]$/.test(e.key)) {
        const list = tabsRef.current
        const idx = parseInt(e.key, 10) - 1
        if (list[idx]) {
          if (!inEditable) e.preventDefault()
          focusTab(list[idx].id)
        }
        return
      }

      // Cmd+W — close active tab
      if (e.key === 'w' && !e.shiftKey) {
        const id = activeTabIdRef.current
        if (id) {
          e.preventDefault()
          closeTab(id)
        }
        return
      }

      // Cmd+T — open terminal for current issue
      if (e.key === 't' && !e.shiftKey) {
        const issue = selectedIssueRef.current
        if (issue && !terminalOpenRef.current) {
          e.preventDefault()
          setTerminalOpen(true)
          void openTerminal(80, 30)
        }
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setCommandPaletteOpen, focusTab, closeTab, setTerminalOpen, openTerminal])

  // Inform main process which tabs are open (drives polling)
  useEffect(() => {
    window.api.tabs.setOpen(tabs.map((t) => t.id)).catch(() => {})
  }, [tabs])

  // Keep stable refs to store actions so IPC subscriptions never need to re-subscribe
  const updateTabRef = useRef(updateTab)
  const addNotificationRef = useRef(addNotification)
  const setProgressRef = useRef(setProgress)
  useEffect(() => { updateTabRef.current = updateTab }, [updateTab])
  useEffect(() => { addNotificationRef.current = addNotification }, [addNotification])
  useEffect(() => { setProgressRef.current = setProgress }, [setProgress])

  // Subscribe to live Linear issue updates — empty dep array so listener is created once only
  useEffect(() => {
    const unsubscribe = window.api.linear.onIssueUpdated((fresh) => {
      if (!fresh?.id) return
      const list = tabsRef.current
      const existing = list.find((t) => t.id === fresh.id)
      if (!existing) return
      const prevUpdated = existing.issue?.updatedAt ? new Date(existing.issue.updatedAt).getTime() : 0
      const nextUpdated = fresh.updatedAt ? new Date(fresh.updatedAt).getTime() : 0
      if (nextUpdated > prevUpdated) {
        updateTabRef.current(fresh.id, { issue: fresh })
        addNotificationRef.current(`${fresh.identifier} updated in Linear`)
      }
    })
    return () => { unsubscribe() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to auto-generated progress updates — created once, uses stable refs
  useEffect(() => {
    const unsubscribe = window.api.progress.onUpdated(async ({ ticketId, summary, newPercent }) => {
      try {
        const p = await window.api.progress.get(ticketId)
        if (p) setProgressRef.current(ticketId, p as any)
      } catch {}
      const truncated = summary.length > 80 ? summary.slice(0, 77) + '…' : summary
      addNotificationRef.current(`Progress: ${newPercent}% — ${truncated}`)
    })
    return () => { unsubscribe() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Memory watchdog notifications — warn at 80%, force-quit at 100% of cap.
  useEffect(() => {
    const unWarn = window.api.memory.onWarn(({ totalMB, limitMB }) => {
      addNotificationRef.current(`⚠ Memory ${(totalMB / 1024).toFixed(1)}GB / ${(limitMB / 1024).toFixed(0)}GB — close idle tabs`)
    })
    const unKill = window.api.memory.onKill(({ totalMB, limitMB }) => {
      addNotificationRef.current(`Memory limit hit (${(totalMB / 1024).toFixed(1)}GB ≥ ${(limitMB / 1024).toFixed(0)}GB) — shutting down`)
    })
    return () => { unWarn(); unKill() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear stale terminalSessionId from any tab whose pty just exited —
  // typically because the concurrent-sessions cap evicted it when a new
  // session started on a different tab. Without this, the old tab would
  // keep showing a green "live" dot and try to write to a dead session.
  useEffect(() => {
    const unsubscribe = window.api.terminal.onAnyExit(({ sessionId, evicted }) => {
      const list = tabsRef.current
      for (const t of list) {
        if (t.terminalSessionId === sessionId) {
          updateTabRef.current(t.id, { terminalSessionId: null, terminalOpen: false })
          if (evicted) {
            addNotificationRef.current(`${t.issue?.identifier || 'Session'} closed — only one Claude session can run at a time`)
          }
        }
      }
    })
    return () => { unsubscribe() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 overflow-hidden">
      {/* Draggable title bar — full width strip, macOS traffic lights sit on top of the left ~80px */}
      <div
        style={{ WebkitAppRegion: 'drag', height: 28 } as React.CSSProperties}
        className="flex-shrink-0 w-full bg-gray-950 flex items-center select-none"
        onDoubleClick={() => window.api.window.toggleMaximize()}
      >
        {/* Left spacer for macOS traffic lights (~80px) */}
        <div style={{ WebkitAppRegion: 'no-drag', width: 80 } as React.CSSProperties} />
        {/* App name centred */}
        <span className="flex-1 text-center text-xs text-gray-500 font-bold tracking-widest pointer-events-none flex items-center justify-center gap-1.5 uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
          devbro
        </span>
        <div style={{ width: 80 } as React.CSSProperties} />
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* Sidebar */}
        <div
          className="flex-shrink-0 flex flex-col transition-all duration-200"
          style={{ width: sidebarCollapsed ? 48 : 256 }}
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => {
              setSidebarCollapsed(c => {
                const next = !c
                try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)) } catch {}
                return next
              })
            }}
          />
        </div>

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden min-w-0 flex-col">
          {/* Tab bar */}
          <TabBar />

        {/* Content row */}
        <div className="flex-1 flex overflow-hidden min-w-0">
          {/* Ticket view or Settings or Dashboard */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {settingsOpen ? <ProjectConfigPanel /> : dashboardOpen ? <AnalyticsDashboard /> : activeProjectId ? <ProjectView /> : <TicketView />}
          </div>

          {/* Drag divider + terminal panel */}
          {terminalOpen && (
            <>
              <div
                onMouseDown={onDividerMouseDown}
                className="w-1 flex-shrink-0 bg-gray-800 hover:bg-indigo-500 cursor-col-resize transition-colors active:bg-indigo-400"
                title="Drag to resize"
              />
              <div className="flex-shrink-0 flex flex-col" style={{ width: terminalWidth }}>
                <TerminalPanel onClose={handleCloseTerminal} />
              </div>
            </>
          )}
        </div>
      </div>
      </div>

      {/* Command Palette overlay */}
      {commandPaletteOpen && <CommandPalette />}

      {/* Standup Modal overlay */}
      {standupOpen && <StandupModal onClose={() => setStandupOpen(false)} />}

      {/* Notification stack */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 flex flex-col items-end">
        {notifications.map((n) => (
          <div
            key={n.id}
            onClick={() => dismissNotification(n.id)}
            style={{ transform: 'translateX(0)', transition: 'transform 150ms ease-out, opacity 150ms ease-out' }}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs px-3 py-2 rounded-lg shadow-lg cursor-pointer hover:bg-gray-700 max-w-xs"
          >
            {n.message}
          </div>
        ))}
      </div>
    </div>
  )
}
