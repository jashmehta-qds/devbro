import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { Markdown } from './Markdown'

interface ELI5CardProps {
  ticketId: string
  title: string
  description?: string
  issue?: any
  repoPaths?: string[]
}

type ELI5Action = 'explain' | 'diff' | 'risks' | 'pr'

export function ELI5Card({ ticketId, title, description, issue, repoPaths = [] }: ELI5CardProps) {
  const { eli5Cache, eli5Loading, setEli5, setEli5Loading } = useAppStore()

  const content = eli5Cache[ticketId]
  const isLoading = eli5Loading[ticketId]
  const [error, setError] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [activeAction, setActiveAction] = useState<ELI5Action>('explain')

  // Collapsed by default when content already exists
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    // Only check SQLite cache on mount — don't auto-call the API
    loadELI5()
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

  const generateAction = async (action: ELI5Action, force: boolean = false) => {
    setActiveAction(action)
    setStreamingText('')
    setEli5Loading(ticketId, true)
    setError(null)
    try {
      let result: string | null = null
      switch (action) {
        case 'explain':
          result = await window.api.eli5.generate(ticketId, title, description || '')
          break
        case 'diff':
          if (repoPaths.length === 0) throw new Error('No repo path available')
          result = await window.api.eli5.explainDiff(ticketId, issue, repoPaths)
          break
        case 'risks':
          result = await window.api.eli5.risks(ticketId, issue, repoPaths)
          break
        case 'pr':
          result = await window.api.eli5.draftPr(ticketId, issue, repoPaths)
          break
      }
      if (result) {
        setEli5(ticketId, result)
        setExpanded(true)
        setError(null)
      } else {
        setError('Claude CLI failed to generate. Is the claude command available?')
      }
    } catch (err: any) {
      console.error('ELI5 generation failed:', err.message)
      setError(err.message || 'Failed to generate')
    } finally {
      setEli5Loading(ticketId, false)
    }
  }

  const loadELI5 = async () => {
    try {
      const cached = await window.api.eli5.get(ticketId)
      if (cached) {
        setEli5(ticketId, cached)
        setError(null)
      }
    } catch {
      // ignore
    }
  }

  const hasRepo = repoPaths.length > 0
  const actionLabels = { explain: 'Explain', diff: 'Diff', risks: 'Risks', pr: 'PR Desc' }
  const actions: ELI5Action[] = ['explain', 'diff', 'risks', 'pr']

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
          onClick={() => { setExpanded(true); generateAction(activeAction) }}
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

      {/* Action chips */}
      <div className="px-3 py-2 border-t border-violet-500/10 flex gap-2 flex-wrap">
        {actions.map((action) => {
          const isActive = activeAction === action
          const isDisabled = !hasRepo && (action === 'diff' || action === 'risks' || action === 'pr')
          const label = actionLabels[action]
          return (
            <div key={action} title={isDisabled ? 'No repo linked' : ''}>
              <button
                onClick={() => { setExpanded(true); generateAction(action) }}
                disabled={isLoading || isDisabled}
                className={`inline-flex items-center h-6 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
                  isActive && !isDisabled
                    ? 'text-violet-300 bg-violet-500/10 border-violet-500/20'
                    : isDisabled
                      ? 'text-gray-600 bg-gray-900 border-gray-800 cursor-not-allowed'
                      : 'text-gray-400 bg-gray-900 border-gray-800 hover:border-gray-700'
                }`}
              >
                {label}
              </button>
            </div>
          )
        })}
      </div>

      {/* Collapsible body */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-violet-500/10">
          {isLoading ? (
            <div className="text-gray-300 text-sm leading-relaxed pt-2">
              {streamingText ? <Markdown>{streamingText}</Markdown> : 'Generating…'}
            </div>
          ) : error ? (
            <p className="text-red-400 text-xs italic pt-2">{error}</p>
          ) : content ? (
            <div className="text-gray-300 text-sm leading-relaxed pt-2">
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <p className="text-gray-600 text-xs italic pt-2">
              Click an action button to generate insights using Claude.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
