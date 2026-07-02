import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store'

interface ELI5CardProps {
  ticketId: string
  title: string
  description?: string
}

export function ELI5Card({ ticketId, title, description }: ELI5CardProps) {
  const { eli5Cache, eli5Loading, setEli5, setEli5Loading } = useAppStore()

  const content = eli5Cache[ticketId]
  const isLoading = eli5Loading[ticketId]
  const [error, setError] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState('')

  // Collapsed by default when content already exists
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    // Only check SQLite cache on mount — don't auto-call the API
    window.api.eli5.get(ticketId).then((cached: string | null) => {
      if (cached) setEli5(ticketId, cached)
    }).catch(() => {})
  }, [ticketId])

  // When content loads in, don't auto-expand — keep collapsed
  // But if there's no content yet and user opens it, let them expand
  useEffect(() => {
    if (!content) setExpanded(false)
  }, [ticketId])

  // Subscribe to AI streaming while generating
  useEffect(() => {
    if (!isLoading) return
    const offChunk = window.api.ai.onChunk(({ text }) => setStreamingText(prev => prev + text))
    const offDone = window.api.ai.onDone(({ output, ok }) => {
      if (ok) setStreamingText(output)
      offChunk(); offDone()
    })
    return () => { offChunk(); offDone() }
  }, [isLoading])

  const loadELI5 = async (force: boolean = false) => {
    if (!force) {
      try {
        const cached = await window.api.eli5.get(ticketId)
        if (cached) {
          setEli5(ticketId, cached)
          setError(null)
          return
        }
      } catch {
        // ignore
      }
    }

    setStreamingText('')
    setEli5Loading(ticketId, true)
    setError(null)
    try {
      const result = await window.api.eli5.generate(ticketId, title, description || '')
      if (result) {
        setEli5(ticketId, result)
        setExpanded(true)
        setError(null)
      } else {
        setError('Claude CLI failed to generate explanation. Is the claude command available?')
      }
    } catch (err: any) {
      console.error('ELI5 generation failed:', err.message)
      setError(err.message || 'Failed to generate explanation')
    } finally {
      setEli5Loading(ticketId, false)
    }
  }

  return (
    <div className="bg-violet-950/30 border border-violet-500/20 rounded-lg overflow-hidden">
      {/* Toggle header */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-xs font-medium text-violet-400 hover:text-violet-300 transition-colors"
        >
          <span>💡</span>
          <span>ELI5</span>
          <span className="text-gray-600">{expanded ? '▲' : '▼'}</span>
        </button>
        <button
          onClick={() => { setExpanded(true); loadELI5(true) }}
          disabled={isLoading}
          className="text-xs text-violet-500 hover:text-violet-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <span className="flex items-center gap-1">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating…
            </span>
          ) : (
            content ? 'Regen' : 'Generate'
          )}
        </button>
      </div>

      {/* Collapsible body */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-violet-500/10">
          {isLoading ? (
            <p className="text-gray-300 text-sm leading-relaxed pt-2">{streamingText || 'Generating…'}</p>
          ) : error ? (
            <p className="text-red-400 text-xs italic pt-2">{error}</p>
          ) : content ? (
            <p className="text-gray-300 text-sm leading-relaxed pt-2">{content}</p>
          ) : (
            <p className="text-gray-600 text-xs italic pt-2">
              Click "Generate" to explain this ticket in simple terms using Claude.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
