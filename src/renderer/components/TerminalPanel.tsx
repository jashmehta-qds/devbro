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
  const [terminalReady, setTerminalReady] = useState<boolean>(false)
  const [editing, setEditing] = useState<boolean>(false)
  const [editedText, setEditedText] = useState<string>('')
  const [saving, setSaving] = useState<boolean>(false)

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
          background: '#0f1117',
          foreground: '#e2e8f0',
          cursor: '#8b5cf6',
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
        fontSize,
        lineHeight: 1.4,
        cursorBlink: true,
        scrollback,
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
      setTerminalReady(true)

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
    })

    return () => {
      cancelled = true
      if (terminalRef.current) {
        terminalRef.current.dispose()
        terminalRef.current = null
        fitAddonRef.current = null
        xtermRef.current = null
      }
      setTerminalReady(false)
    }
  }, [])

  useEffect(() => {
    if (terminalSessionId && terminalReady && terminalRef.current) {
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
  }, [terminalSessionId, terminalReady])

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

  const handleEditStart = useCallback(() => {
    setEditedText(previewText)
    setEditing(true)
  }, [previewText])

  const handleEditCancel = useCallback(() => {
    setEditing(false)
    setEditedText('')
  }, [])

  const handleSaveAndLaunch = useCallback(async () => {
    if (!selectedIssue) return
    setSaving(true)
    try {
      await window.api.context.writeForSession(selectedIssue.id, selectedIssue, editedText)
      await handleOpenTerminal()
    } catch (err) {
      console.error('Failed to save context', err)
    } finally {
      setSaving(false)
      setEditing(false)
      setEditedText('')
    }
  }, [selectedIssue, editedText, handleOpenTerminal])

  // Identifier label for the header
  const headerLabel = selectedIssue
    ? `${selectedIssue.identifier} › terminal`
    : 'terminal'

  return (
    <div className="flex flex-col h-full bg-gray-950 border-t border-gray-800">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-950 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-gray-400">{headerLabel}</span>
          {terminalSessionId && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {terminalSessionId && (
            <>
              <button
                onClick={handleClear}
                className="h-6 px-2 rounded text-[11px] text-gray-400 hover:text-gray-100 hover:bg-gray-900 transition-colors"
              >
                Clear
              </button>
              {selectedIssue && (
                <button
                  onClick={handleRefreshContext}
                  className={`h-6 px-2 rounded text-[11px] transition-colors ${
                    refreshFeedback
                      ? 'text-emerald-300'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-gray-900'
                  }`}
                  title="Rewrite CLAUDE.md for this session"
                >
                  {refreshFeedback ? 'Refreshed ✓' : 'Refresh ctx'}
                </button>
              )}
              <button
                onClick={() => window.api.terminal.kill(terminalSessionId)}
                className="h-6 px-2 rounded text-[11px] text-gray-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
              >
                Kill
              </button>
            </>
          )}
          <button
            onClick={handleClose}
            className="h-6 px-2 rounded text-[11px] text-gray-400 hover:text-gray-100 hover:bg-gray-900 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Terminal container */}
      <div className="flex-1 overflow-hidden relative" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)' }}>
        {!terminalSessionId && !selectedIssue && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
            Select a ticket to open terminal
          </div>
        )}
        {!terminalSessionId && selectedIssue && (
          <div className="absolute inset-0 overflow-y-auto p-6 flex flex-col gap-4">
            {/* Context preview — collapsed by default */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-soft">
              <button
                onClick={() => setPreviewExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-300 hover:text-gray-50 transition-colors"
              >
                <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-gray-400">CLAUDE.md Preview</span>
                <div className="flex items-center gap-2">
                  {!editing && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); loadPreview() }}
                        disabled={previewLoading}
                        className="text-[11px] text-violet-300 hover:text-violet-200 disabled:opacity-50 transition-colors"
                      >
                        {previewLoading ? 'Loading…' : 'Refresh'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditStart() }}
                        className="text-[11px] text-gray-400 hover:text-gray-100 transition-colors"
                      >
                        Edit
                      </button>
                    </>
                  )}
                  {editing && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditCancel() }}
                        disabled={saving}
                        className="text-[11px] text-gray-400 hover:text-gray-100 disabled:opacity-50 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSaveAndLaunch() }}
                        disabled={saving}
                        className="text-[11px] text-emerald-300 hover:text-emerald-200 disabled:opacity-50 transition-colors"
                      >
                        {saving ? 'Saving…' : 'Save & Launch'}
                      </button>
                    </>
                  )}
                  <span className="text-gray-600">{previewExpanded ? '▲' : '▼'}</span>
                </div>
              </button>
              {previewExpanded && !editing && (
                <pre className="whitespace-pre-wrap text-[11px] text-gray-300 font-mono bg-gray-950 p-4 max-h-72 overflow-y-auto border-t border-gray-800 leading-relaxed">
                  {previewLoading
                    ? 'Loading preview…'
                    : previewText || '(empty)'}
                </pre>
              )}
              {previewExpanded && editing && (
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="bg-gray-950 border-t border-gray-800 text-[11px] text-gray-200 font-mono p-4 w-full min-h-[300px] outline-none resize-none focus:bg-gray-950"
                />
              )}
            </div>

            {/* Start Claude button — centered, prominent */}
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <button
                onClick={handleOpenTerminal}
                className="inline-flex items-center gap-2 px-5 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors shadow-elev"
              >
                <svg className="w-4 h-4 stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Start Claude ▶
              </button>
              <p className="text-[11px] text-gray-500 mt-2">Opens a new Claude Code session for this ticket</p>
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full p-3" />
      </div>
    </div>
  )
}
