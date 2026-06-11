import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useAppStore } from '../store'
import { useTerminal } from '../hooks/useTerminal'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  onClose: () => void
}

export function TerminalPanel({ onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const store = useAppStore()
  const terminalSessionId = store.terminalSessionId
  const selectedIssue = store.selectedIssue

  const { xtermRef, openTerminal, closeTerminal, resizeTerminal } = useTerminal()

  // Context preview state
  const [previewText, setPreviewText] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState<boolean>(false)
  const [previewExpanded, setPreviewExpanded] = useState<boolean>(false)
  const [refreshFeedback, setRefreshFeedback] = useState<boolean>(false)

  const loadPreview = useCallback(async () => {
    if (!selectedIssue) return
    setPreviewLoading(true)
    try {
      const text = await window.api.context.preview(selectedIssue.id, selectedIssue)
      setPreviewText(text || '')
    } catch (err) {
      console.error('Failed to load context preview', err)
      setPreviewText('')
    } finally {
      setPreviewLoading(false)
    }
  }, [selectedIssue])

  useEffect(() => {
    if (!terminalSessionId && selectedIssue) {
      loadPreview()
    }
  }, [selectedIssue?.id, terminalSessionId, loadPreview])

  const handleRefreshContext = useCallback(async () => {
    if (!terminalSessionId || !selectedIssue) return
    try {
      await window.api.context.refreshForSession(terminalSessionId, selectedIssue.id, selectedIssue)
      setRefreshFeedback(true)
      setTimeout(() => setRefreshFeedback(false), 1500)
    } catch (err) {
      console.error('Failed to refresh context', err)
    }
  }, [terminalSessionId, selectedIssue])

  // Keep sessionIdRef in sync
  useEffect(() => {
    sessionIdRef.current = terminalSessionId
  }, [terminalSessionId])

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0f1117',
        foreground: '#e2e8f0',
        cursor: '#6366f1',
        cursorAccent: '#0f1117',
        black: '#1a1f2e',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#374151',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f9fafb'
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 1000,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon
    xtermRef.current = term

    // Store the dispose handle so we can clean up properly
    const onDataDisposable = term.onData((data) => {
      if (sessionIdRef.current) {
        window.api.terminal.write(sessionIdRef.current, data)
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!fitAddon || !term) return
        try {
          fitAddon.fit()
          const { cols, rows } = term
          if (sessionIdRef.current) {
            window.api.terminal.resize(sessionIdRef.current, cols, rows)
          }
        } catch {
          // ignore
        }
      })
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
      onDataDisposable.dispose() // unsubscribe before dispose to prevent listener leak
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      xtermRef.current = null
    }
  }, [])

  useEffect(() => {
    if (terminalSessionId && terminalRef.current) {
      // Tell main we're rendering this session — pty output streams via IPC.
      // While detached, main drops output into a small ring buffer instead.
      window.api.terminal.attach(terminalSessionId).catch(() => {})
      const unsub = window.api.terminal.onData(terminalSessionId, (data) => {
        terminalRef.current?.write(data)
      })
      return () => {
        unsub()
        window.api.terminal.detach(terminalSessionId).catch(() => {})
      }
    }
  }, [terminalSessionId])

  const handleOpenTerminal = useCallback(async () => {
    if (terminalRef.current) {
      const { cols, rows } = terminalRef.current
      await openTerminal(cols, rows)
    } else {
      await openTerminal()
    }
  }, [openTerminal])

  const handleClose = useCallback(async () => {
    await closeTerminal()
    onClose()
  }, [closeTerminal, onClose])

  const handleClear = useCallback(() => {
    terminalRef.current?.clear()
  }, [])

  // Identifier label for the header
  const headerLabel = selectedIssue
    ? `${selectedIssue.identifier} › terminal`
    : 'terminal'

  return (
    <div className="flex flex-col h-full bg-gray-950 border-l border-gray-800">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-400 font-mono">{headerLabel}</span>
          {terminalSessionId && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {terminalSessionId && (
            <>
              <button
                onClick={handleClear}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Clear
              </button>
              {selectedIssue && (
                <button
                  onClick={handleRefreshContext}
                  className={`text-xs transition-colors ${
                    refreshFeedback
                      ? 'text-green-400'
                      : 'text-indigo-400 hover:text-indigo-300'
                  }`}
                  title="Rewrite CLAUDE.md for this session"
                >
                  {refreshFeedback ? 'Refreshed ✓' : 'Refresh ctx'}
                </button>
              )}
              <button
                onClick={() => window.api.terminal.kill(terminalSessionId)}
                className="text-xs text-red-500 hover:text-red-400 transition-colors"
              >
                Kill
              </button>
            </>
          )}
          <button
            onClick={handleClose}
            className="text-gray-600 hover:text-gray-300 transition-colors text-xs ml-1"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Terminal container */}
      <div className="flex-1 overflow-hidden relative" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)' }}>
        {!terminalSessionId && !selectedIssue && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
            Select a ticket to open terminal
          </div>
        )}
        {!terminalSessionId && selectedIssue && (
          <div className="absolute inset-0 overflow-y-auto p-5 flex flex-col gap-4">
            {/* Context preview — collapsed by default */}
            <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
              <button
                onClick={() => setPreviewExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  CLAUDE.md Preview
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); loadPreview() }}
                    disabled={previewLoading}
                    className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors"
                  >
                    {previewLoading ? 'Loading…' : 'Refresh'}
                  </button>
                  <span className="text-gray-600">{previewExpanded ? '▲' : '▼'}</span>
                </div>
              </button>
              {previewExpanded && (
                <pre className="whitespace-pre-wrap text-xs text-gray-400 font-mono bg-gray-950 p-3 max-h-60 overflow-y-auto border-t border-gray-800">
                  {previewLoading
                    ? 'Loading preview…'
                    : previewText || '(empty)'}
                </pre>
              )}
            </div>

            {/* Start Claude button — centered, prominent */}
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <button
                onClick={handleOpenTerminal}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors font-medium shadow-lg shadow-indigo-900/30"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Start Claude ▶
              </button>
              <p className="text-xs text-gray-600">Opens a new Claude Code session for this ticket</p>
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full p-1" />
      </div>
    </div>
  )
}
