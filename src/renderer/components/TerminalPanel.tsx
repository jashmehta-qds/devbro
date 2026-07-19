import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { LinearIssue } from '../types'
import '@xterm/xterm/css/xterm.css'

interface TerminalSessionViewProps {
  sessionId: string
  issue: LinearIssue
  /** Whether this session's pane is currently shown (drawer open + active tab). */
  visible: boolean
  /** External resize signal (drawer height change) — bump to trigger a fit(). */
  resizeSignal: number
}

/**
 * Renders one live terminal session. Stays mounted while its tab exists so the
 * xterm buffer survives tab switches; attaches to the pty only while visible
 * (detaches otherwise, so the backend buffers output into its ring buffer).
 */
export function TerminalSessionView({ sessionId, issue, visible, resizeSignal }: TerminalSessionViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [ready, setReady] = useState(false)
  const [ctxLoading, setCtxLoading] = useState(false)

  // Create the xterm instance once.
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    Promise.all([
      window.api.appConfig.get('terminal_font_size'),
      window.api.appConfig.get('terminal_scrollback'),
    ]).then(([fontSizeRaw, scrollbackRaw]) => {
      if (cancelled || !containerRef.current) return
      const fontSize = parseInt(fontSizeRaw ?? '14', 10) || 14
      const scrollback = parseInt(scrollbackRaw ?? '2000', 10) || 2000

      const term = new Terminal({
        theme: {
          background: '#0f1117', foreground: '#e2e8f0', cursor: '#8b5cf6', cursorAccent: '#0f1117',
          black: '#1a1f2e', red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa',
          magenta: '#c084fc', cyan: '#22d3ee', white: '#e2e8f0', brightBlack: '#374151',
          brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde047', brightBlue: '#93c5fd',
          brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#f9fafb'
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
        fontSize, lineHeight: 1.4, cursorBlink: true, scrollback, allowProposedApi: true
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(new WebLinksAddon())
      term.open(containerRef.current)
      try { fitAddon.fit() } catch {}

      terminalRef.current = term
      fitAddonRef.current = fitAddon
      setReady(true)

      term.onData((data) => { window.api.terminal.write(sessionId, data) })

      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          try {
            fitAddon.fit()
            window.api.terminal.resize(sessionId, term.cols, term.rows)
          } catch { /* ignore */ }
        })
      })
      resizeObserver.observe(containerRef.current)
      ;(term as any).__resizeObserver = resizeObserver
    })

    return () => {
      cancelled = true
      const term = terminalRef.current as any
      if (term?.__resizeObserver) term.__resizeObserver.disconnect()
      if (terminalRef.current) {
        terminalRef.current.dispose()
        terminalRef.current = null
        fitAddonRef.current = null
      }
      setReady(false)
    }
  }, [sessionId])

  // Attach to the pty only while visible; detach when hidden.
  useEffect(() => {
    if (!ready || !visible) return
    window.api.terminal.attach(sessionId).catch(() => {})
    const unsub = window.api.terminal.onData(sessionId, (data) => {
      terminalRef.current?.write(data)
    })
    // fit once shown
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit()
        if (terminalRef.current) window.api.terminal.resize(sessionId, terminalRef.current.cols, terminalRef.current.rows)
      } catch {}
    })
    return () => {
      unsub()
      window.api.terminal.detach(sessionId).catch(() => {})
    }
  }, [ready, visible, sessionId])

  // React to external resize (drawer drag / becoming active).
  useEffect(() => {
    if (!ready || !visible) return
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit()
        if (terminalRef.current) window.api.terminal.resize(sessionId, terminalRef.current.cols, terminalRef.current.rows)
      } catch {}
    })
  }, [resizeSignal, ready, visible, sessionId])

  const handleRefreshContext = useCallback(async () => {
    try {
      await window.api.context.refreshForSession(sessionId, issue.id, issue)
    } catch (err) {
      console.error('Failed to refresh context', err)
    }
  }, [sessionId, issue])

  useEffect(() => {
    const un1 = window.api.terminal.onContextInjecting(sessionId, () => setCtxLoading(true))
    const un2 = window.api.terminal.onContextReady(sessionId, () => setCtxLoading(false))
    return () => { un1(); un2() }
  }, [sessionId])

  return (
    <div className="flex flex-col h-full" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="flex items-center justify-end gap-2 px-3 py-1 border-b border-border flex-shrink-0">
        <button
          onClick={() => terminalRef.current?.clear()}
          className="h-6 px-2 rounded text-[11px] text-gray-400 hover:text-gray-100 hover:bg-surface2 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={handleRefreshContext}
          title="Rewrite CLAUDE.md for this session"
          className="h-6 px-2 rounded text-[11px] text-gray-400 hover:text-gray-100 hover:bg-surface2 transition-colors"
        >
          Refresh ctx
        </button>
      </div>
      <div className="flex-1 overflow-hidden relative" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)' }}>
        <div ref={containerRef} className="w-full h-full p-3" />
        {ctxLoading && (
          <div className="absolute inset-0 bg-gray-950/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10 animate-fade-in">
            <div className="w-8 h-8 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
            <div className="text-sm text-gray-100">Loading session context…</div>
            <div className="text-[11px] text-gray-500">Claude is reading your ticket, guidelines, and skills</div>
          </div>
        )}
      </div>
    </div>
  )
}
