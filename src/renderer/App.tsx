import React, { useRef, useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { TicketView } from './components/TicketView'
import { TerminalDrawer } from './components/TerminalDrawer'
import { ProjectConfigPanel } from './components/ProjectConfigPanel'
import { AnalyticsDashboard } from './components/AnalyticsDashboard'
import { HelpPanel } from './components/HelpPanel'
import { ProjectView } from './components/ProjectView'
import { TabBar } from './components/TabBar'
import { CommandPalette } from './components/CommandPalette'
import { StandupModal } from './components/StandupModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toasts } from './components/ui'
import { useAppStore } from './store'
import { useTerminal } from './hooks/useTerminal'

const SIDEBAR_COLLAPSED_KEY = 'devbro-sidebar-collapsed'

function loadSidebarCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true' } catch { return false }
}

export default function App() {
  const store = useAppStore()
  const settingsOpen = store.settingsOpen
  const dashboardOpen = store.dashboardOpen
  const helpOpen = store.helpOpen
  const standupOpen = store.standupOpen
  const activeProjectId = store.activeProjectId
  const commandPaletteOpen = store.commandPaletteOpen
  const tabs = store.tabs
  const activeTabId = store.activeTabId
  const selectedIssue = store.selectedIssue
  const {
    setCommandPaletteOpen,
    setStandupOpen,
    openSettingsTab,
    openDashboardTab,
    openHelpTab,
    focusTab,
    closeTab,
    updateTab,
    addNotification,
    setProgress,
    toggleDrawer,
    removeDrawerSession,
  } = store
  const { openTerminal } = useTerminal()

  // Refs to avoid stale closures in shortcuts/listeners
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const selectedIssueRef = useRef(selectedIssue)
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { selectedIssueRef.current = selectedIssue }, [selectedIssue])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed)

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

      // Cmd+J — toggle terminal drawer (open+focus current ticket's session when none)
      if (e.key === 'j' && !e.shiftKey) {
        e.preventDefault()
        const { drawerOpen, drawerSessions } = useAppStore.getState()
        const issue = selectedIssueRef.current
        if (!drawerOpen && drawerSessions.length === 0 && issue) {
          void openTerminal(80, 30)
        } else {
          toggleDrawer()
        }
        return
      }

      // Cmd+D analytics · Cmd+U standup · Cmd+, settings · Cmd+? / Cmd+/ help
      if (e.key === 'd' && !e.shiftKey) { e.preventDefault(); openDashboardTab(); return }
      if (e.key === 'u' && !e.shiftKey) { e.preventDefault(); setStandupOpen(true); return }
      if (e.key === ',')               { e.preventDefault(); openSettingsTab(); return }
      if (e.key === '?' || e.key === '/') { e.preventDefault(); openHelpTab(); return }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setCommandPaletteOpen, focusTab, closeTab, toggleDrawer, openTerminal, openDashboardTab, setStandupOpen, openSettingsTab, openHelpTab])

  // Inform main process which tabs are open (drives polling)
  useEffect(() => {
    window.api.tabs.setOpen(tabs.map((t) => t.id)).catch(() => {})
  }, [tabs])

  // Keep stable refs to store actions so IPC subscriptions never need to re-subscribe
  const updateTabRef = useRef(updateTab)
  const addNotificationRef = useRef(addNotification)
  const setProgressRef = useRef(setProgress)
  const removeDrawerSessionRef = useRef(removeDrawerSession)
  useEffect(() => { updateTabRef.current = updateTab }, [updateTab])
  useEffect(() => { addNotificationRef.current = addNotification }, [addNotification])
  useEffect(() => { setProgressRef.current = setProgress }, [setProgress])
  useEffect(() => { removeDrawerSessionRef.current = removeDrawerSession }, [removeDrawerSession])

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
    const unsubscribe = window.api.progress.onUpdated(async ({ ticketId, newPercent }) => {
      let identifier = ticketId
      try {
        const p = await window.api.progress.get(ticketId)
        if (p) setProgressRef.current(ticketId, p as any)
      } catch {}
      const tab = tabsRef.current.find((t) => t.id === ticketId)
      if (tab?.issue?.identifier) identifier = tab.issue.identifier
      addNotificationRef.current(`${identifier} progress updated → ${newPercent}%`)
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

  // Drop dead terminal sessions from the drawer. When the concurrent-sessions
  // cap evicts a session, `evicted` is true — surface a toast.
  useEffect(() => {
    const unsubscribe = window.api.terminal.onAnyExit(({ sessionId, evicted }) => {
      const session = useAppStore.getState().drawerSessions.find((d) => d.sessionId === sessionId)
      removeDrawerSessionRef.current(sessionId)
      if (evicted) {
        addNotificationRef.current(`Terminal evicted: session cap${session ? ` (${session.label})` : ''}`)
      }
    })
    return () => { unsubscribe() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-screen bg-bg text-gray-100 overflow-hidden">
      {/* Draggable title bar — full width strip, macOS traffic lights sit on top of the left ~80px */}
      <div
        style={{ WebkitAppRegion: 'drag', height: 28 } as React.CSSProperties}
        className="flex-shrink-0 w-full bg-bg flex items-center select-none"
        onDoubleClick={() => window.api.window.toggleMaximize()}
      >
        <div style={{ WebkitAppRegion: 'no-drag', width: 80 } as React.CSSProperties} />
        <span className="flex-1 text-center text-xs text-gray-500 font-bold tracking-widest pointer-events-none flex items-center justify-center gap-1.5 uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />
          devbro
        </span>
        <div style={{ width: 80 } as React.CSSProperties} />
      </div>

      {/* Body: sidebar (full height) + main column; terminal drawer sits below main column, full window width */}
      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* Sidebar — full height on the left */}
        <div
          className="flex-shrink-0 flex flex-col transition-all duration-200"
          style={{ width: sidebarCollapsed ? 48 : 256 }}
        >
          <ErrorBoundary label="Sidebar">
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
          </ErrorBoundary>
        </div>

        {/* Main column: tab bar + content, then the drawer beneath (drawer spans this column width;
            sidebar stays full-height per existing layout). */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <ErrorBoundary label="TabBar">
            <TabBar />
          </ErrorBoundary>

          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <ErrorBoundary label="TicketView">
              {settingsOpen ? (
                <ErrorBoundary label="ProjectConfigPanel"><ProjectConfigPanel /></ErrorBoundary>
              ) : dashboardOpen ? (
                <ErrorBoundary label="AnalyticsDashboard"><AnalyticsDashboard /></ErrorBoundary>
              ) : helpOpen ? (
                <ErrorBoundary label="HelpPanel"><HelpPanel /></ErrorBoundary>
              ) : activeProjectId ? (
                <ErrorBoundary label="ProjectView"><ProjectView /></ErrorBoundary>
              ) : (
                <TicketView />
              )}
            </ErrorBoundary>
          </div>

          {/* App-level terminal drawer */}
          <ErrorBoundary label="TerminalDrawer">
            <TerminalDrawer />
          </ErrorBoundary>
        </div>
      </div>

      {/* Command Palette overlay */}
      {commandPaletteOpen && (
        <ErrorBoundary label="CommandPalette"><CommandPalette /></ErrorBoundary>
      )}

      {/* Standup Modal overlay */}
      {standupOpen && (
        <ErrorBoundary label="StandupModal"><StandupModal onClose={() => setStandupOpen(false)} /></ErrorBoundary>
      )}

      {/* Toast stack */}
      <Toasts />
    </div>
  )
}
