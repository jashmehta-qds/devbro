import React, { useState, useEffect, useCallback } from 'react'

function renderStandup(text: string) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('**') && line.endsWith('**')) {
      return <p key={i} className="font-semibold text-gray-100 mt-3 first:mt-0">{line.slice(2, -2)}</p>
    }
    if (line.startsWith('- ')) {
      return <p key={i} className="text-gray-300 ml-2">• {line.slice(2)}</p>
    }
    if (line === '') return <div key={i} className="h-1" />
    return <p key={i} className="text-gray-300">{line}</p>
  })
}

export function StandupModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<{ standup: string; raw: string; usedAI: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    setResult(null)
    try {
      const r = await window.api.standup.generate()
      setResult(r)
    } catch (e: any) {
      setResult({ standup: 'Failed to generate standup: ' + e.message, raw: '', usedAI: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    generate()
  }, [generate])

  const handleCopy = () => {
    navigator.clipboard.writeText(result?.standup ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="text-sm font-semibold text-gray-100">Daily Standup</span>
            {result?.usedAI && (
              <span className="text-xs bg-indigo-900/60 text-indigo-300 border border-indigo-700 rounded px-1.5 py-0.5">
                AI
              </span>
            )}
            {!loading && result && !result.usedAI && (
              <span className="text-xs text-gray-500">No API key</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={generate}
              disabled={loading}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              {loading ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Regenerate
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 py-4 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <svg className="w-6 h-6 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <p className="text-sm text-gray-400">Generating your standup...</p>
            </div>
          ) : result ? (
            <div className="text-sm leading-relaxed">
              {renderStandup(result.standup)}
            </div>
          ) : null}
        </div>

        {/* Raw data toggle */}
        {result && result.raw && (
          <div className="px-4 pb-2">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              {showRaw ? 'Hide raw data' : 'Show raw data'}
            </button>
            {showRaw && (
              <pre className="mt-2 text-xs text-gray-500 bg-gray-800/50 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {result.raw}
              </pre>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
          <button
            onClick={handleCopy}
            disabled={loading || !result}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy to clipboard
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
