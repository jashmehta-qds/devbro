import React from 'react'
import { useAppStore } from '../store'
import { useTerminal } from '../hooks/useTerminal'

const STATE_COLORS: Record<string, string> = {
  backlog: '#6B7280',
  unstarted: '#9CA3AF',
  started: '#3B82F6',
  completed: '#10B981',
  cancelled: '#6B7280'
}

const MAX_TABS = 8

export function TabBar() {
  const {
    tabs, activeTabId, focusTab, closeTab,
    projectTabs, activeProjectTabId, focusProjectTab, closeProjectTab,
    isSyncing, terminalOpen, setTerminalOpen
  } = useAppStore()
  const { openTerminal, closeTerminal } = useTerminal()

  const handleTerminalToggle = async () => {
    if (terminalOpen) {
      await closeTerminal()
    } else {
      setTerminalOpen(true)
      await openTerminal()
    }
  }

  if (tabs.length === 0 && projectTabs.length === 0) return null

  return (
    <div className="flex items-stretch h-9 bg-gray-950 border-b border-gray-800 overflow-hidden">
      {/* Issue tabs */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const stateColor = STATE_COLORS[tab.issue.state.type] || '#6B7280'
        const hasTerminal = tab.terminalOpen && tab.terminalSessionId

        return (
          <div
            key={tab.id}
            title={`${tab.issue.identifier} — ${tab.issue.title}`}
            className={`group inline-flex flex-col justify-center h-full px-2.5 cursor-pointer border-r border-gray-800 relative transition-colors duration-150 flex-1 min-w-0 max-w-[160px] ${
              isActive
                ? 'bg-gray-900 text-gray-50'
                : 'text-gray-400 hover:bg-gray-900/60 hover:text-gray-200'
            }`}
            onClick={() => focusTab(tab.id)}
          >
            <div className="flex items-center gap-1.5 leading-none">
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: stateColor }} />
              <span className="text-[11px] font-mono font-medium tracking-tight truncate">{tab.issue.identifier}</span>
              {hasTerminal && (
                <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
              )}
            </div>
            <span className="text-[10px] text-gray-500 truncate leading-none mt-1">{tab.issue.title}</span>

            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-100 transition-opacity w-4 h-4 flex items-center justify-center rounded bg-gray-900 hover:bg-gray-800 text-[10px] leading-none"
              title="Close"
            >✕</button>

            {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500" />}
          </div>
        )
      })}

      {/* Project / Settings / Dashboard tabs */}
      {projectTabs.map((pt) => {
        const isActive = pt.id === activeProjectTabId
        const tabType = (pt as any).tabType || 'project'
        const label = tabType === 'settings' ? 'Settings' : tabType === 'dashboard' ? 'Analytics' : pt.name

        return (
          <div
            key={pt.id}
            title={pt.name}
            className={`group inline-flex items-center h-full px-3 gap-1.5 cursor-pointer border-r border-gray-800 relative transition-colors duration-150 flex-shrink-0 ${
              isActive
                ? 'bg-gray-900 text-gray-50'
                : 'text-gray-400 hover:bg-gray-900/60 hover:text-gray-200'
            }`}
            onClick={() => focusProjectTab(pt.id)}
          >
            {tabType === 'project' && (
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: pt.color || '#8b5cf6' }} />
            )}
            <span className="text-[11px] font-medium truncate max-w-[110px]">{label}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeProjectTab(pt.id) }}
              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-100 transition-opacity w-4 h-4 flex items-center justify-center rounded hover:bg-gray-800 text-[10px] leading-none ml-0.5"
              title="Close"
            >✕</button>
            {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500" />}
          </div>
        )
      })}

      {/* Tab count indicator when at max */}
      {tabs.length >= MAX_TABS && (
        <div className="flex items-center px-2 text-xs text-red-400 flex-shrink-0 font-mono">
          {tabs.length}/{MAX_TABS}
        </div>
      )}

      {/* Right-side controls */}
      <div className="ml-auto flex items-center gap-2 px-3 flex-shrink-0">
        {/* Syncing — spinning dot only */}
        {isSyncing && (
          <svg className="animate-spin h-3 w-3 text-violet-500/70" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}

        {/* Terminal toggle */}
        {activeTabId && (
          <button
            onClick={handleTerminalToggle}
            title={terminalOpen ? 'Hide terminal (⌘T)' : 'Open terminal (⌘T)'}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all duration-150 ${
              terminalOpen
                ? 'bg-violet-600/20 text-violet-300 border border-violet-600/40'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border border-transparent'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {/* Green pulse when session is live */}
            {terminalOpen && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
