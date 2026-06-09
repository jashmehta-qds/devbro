import React from 'react'
import { useAppStore } from '../store'
import { useTerminal } from '../hooks/useTerminal'
import { ProgressDot } from './ProgressBar'

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
    isSyncing, terminalOpen, setTerminalOpen, progress
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
    <div className="flex items-center bg-gray-900 border-b border-gray-800 flex-shrink-0 overflow-x-auto">
      {/* Issue tabs */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const stateColor = STATE_COLORS[tab.issue.state.type] || '#6B7280'
        const hasTerminal = tab.terminalOpen && tab.terminalSessionId
        const issueProgress = progress[tab.id]
        const pct = issueProgress?.percent || 0

        return (
          <div
            key={tab.id}
            title={tab.issue.title}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer flex-shrink-0 border-b-2 transition-all duration-150 group relative select-none ${
              isActive
                ? 'border-indigo-500 text-gray-100 bg-gray-800'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/40'
            }`}
            onClick={() => focusTab(tab.id)}
          >
            {/* State dot */}
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: stateColor }}
            />

            {/* Identifier only */}
            <span className="font-mono text-xs">{tab.issue.identifier}</span>

            {/* Progress dot — only if progress > 0 */}
            {pct > 0 && <ProgressDot percent={pct} />}

            {/* Live terminal indicator */}
            {hasTerminal && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0 animate-pulse" />
            )}

            {/* Close button — visible on hover */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 ml-0.5 text-gray-600 hover:text-gray-300 transition-all flex-shrink-0 leading-none w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-gray-700"
              title="Close tab"
            >
              ✕
            </button>
          </div>
        )
      })}

      {/* Project / Settings / Dashboard tabs */}
      {projectTabs.map((pt) => {
        const isActive = pt.id === activeProjectTabId
        const tabType = (pt as any).tabType || 'project'

        const icon = tabType === 'settings' ? (
          <svg className="w-3 h-3 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ) : tabType === 'dashboard' ? (
          <svg className="w-3 h-3 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ) : (
          <svg className="w-3 h-3 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        )

        return (
          <div
            key={pt.id}
            title={pt.name}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer flex-shrink-0 border-b-2 transition-all duration-150 group relative select-none ${
              isActive
                ? 'border-indigo-500 text-gray-100 bg-gray-800'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/40'
            }`}
            onClick={() => focusProjectTab(pt.id)}
          >
            {/* Color dot — only for project tabs */}
            {tabType === 'project' && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: pt.color || '#6366f1' }}
              />
            )}
            {icon}
            <span className="max-w-[100px] truncate">{pt.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeProjectTab(pt.id) }}
              className="opacity-0 group-hover:opacity-100 ml-0.5 text-gray-600 hover:text-gray-300 transition-all flex-shrink-0 leading-none w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-gray-700"
              title="Close tab"
            >✕</button>
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
          <svg className="animate-spin h-3 w-3 text-indigo-500/70" viewBox="0 0 24 24" fill="none">
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
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-600/40'
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
