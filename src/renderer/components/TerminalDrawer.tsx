import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { useTerminal } from '../hooks/useTerminal'
import { TerminalSessionView } from './TerminalPanel'
import { EmptyState } from './ui'

const DRAWER_MIN = 120
const DRAWER_DEFAULT = 300
const DRAWER_HEIGHT_KEY = 'devbro-terminal-height'

export function loadDrawerHeight(): number {
  try {
    const v = localStorage.getItem(DRAWER_HEIGHT_KEY)
    return v ? parseInt(v, 10) || DRAWER_DEFAULT : DRAWER_DEFAULT
  } catch { return DRAWER_DEFAULT }
}

export function TerminalDrawer() {
  const drawerOpen = useAppStore((s) => s.drawerOpen)
  const drawerSessions = useAppStore((s) => s.drawerSessions)
  const activeDrawerSessionId = useAppStore((s) => s.activeDrawerSessionId)
  const setActiveDrawerSession = useAppStore((s) => s.setActiveDrawerSession)
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  const { killSession } = useTerminal()

  const [height, setHeight] = useState(loadDrawerHeight)
  const [resizeSignal, setResizeSignal] = useState(0)
  const dragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    startY.current = e.clientY
    startHeight.current = height
    e.preventDefault()
  }, [height])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startY.current - e.clientY
      const max = window.innerHeight * 0.7
      const next = Math.min(max, Math.max(DRAWER_MIN, startHeight.current + delta))
      setHeight(next)
      try { localStorage.setItem(DRAWER_HEIGHT_KEY, String(Math.round(next))) } catch {}
    }
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false
        setResizeSignal((n) => n + 1)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Re-fit the active terminal whenever the drawer opens or the active tab changes.
  useEffect(() => {
    if (drawerOpen) setResizeSignal((n) => n + 1)
  }, [drawerOpen, activeDrawerSessionId])

  if (!drawerOpen) return null

  return (
    <>
      {/* Resize handle — drag the top edge */}
      <div
        onMouseDown={onDividerMouseDown}
        className="h-1 flex-shrink-0 bg-border hover:bg-accent/40 cursor-row-resize transition-colors"
        title="Drag to resize"
      />
      <div className="flex-shrink-0 flex flex-col bg-bg border-t border-border" style={{ height }}>
        {/* Tab strip */}
        <div className="flex items-stretch h-8 border-b border-border flex-shrink-0 overflow-x-auto">
          {drawerSessions.map((s) => {
            const active = s.sessionId === activeDrawerSessionId
            return (
              <div
                key={s.sessionId}
                onClick={() => setActiveDrawerSession(s.sessionId)}
                title={`${s.label} — ${s.issue.title}`}
                className={`group flex items-center gap-2 h-full px-3 cursor-pointer border-r border-border relative transition-colors flex-shrink-0 ${
                  active ? 'bg-surface text-gray-50' : 'text-gray-400 hover:bg-surface/60 hover:text-gray-200'
                }`}
              >
                <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span className="text-[11px] font-mono font-medium tracking-tight">{s.label}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); killSession(s.sessionId) }}
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-300 transition-opacity w-4 h-4 flex items-center justify-center rounded hover:bg-red-500/10 text-[10px] leading-none"
                  title="Kill session"
                >✕</button>
                {active && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
              </div>
            )
          })}
          <div className="ml-auto flex items-center px-2 flex-shrink-0">
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500 mr-2">terminal</span>
            <button
              onClick={() => setDrawerOpen(false)}
              title="Hide drawer (⌘J)"
              className="h-6 px-2 rounded text-[11px] text-gray-400 hover:text-gray-100 hover:bg-surface2 transition-colors"
            >✕</button>
          </div>
        </div>

        {/* Session panes — all kept mounted, only the active one visible */}
        <div className="flex-1 min-h-0 relative">
          {drawerSessions.length === 0 ? (
            <EmptyState title="No terminal sessions" hint="Open a ticket and click its repo terminal button, or press ⌘J." />
          ) : (
            drawerSessions.map((s) => (
              <div key={s.sessionId} className="absolute inset-0">
                <TerminalSessionView
                  sessionId={s.sessionId}
                  issue={s.issue}
                  visible={s.sessionId === activeDrawerSessionId}
                  resizeSignal={resizeSignal}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
