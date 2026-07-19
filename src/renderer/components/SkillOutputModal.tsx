import React, { useEffect, useRef, useState } from 'react'

// Result of skills.apply() — kept exported so the caller can narrow before deciding
// whether to open this modal (prompt-stream) or handle command/claude_md inline.
export interface ApplyResult {
  ok: boolean
  kind: 'command' | 'prompt-stream' | 'claude_md'
  command?: string
  callId?: string
  mdPath?: string
  error?: string
}

/**
 * Global streaming output modal — driven by the `skillOutput` slice in the store.
 * Subscribes to window.api.ai.onChunk/onDone filtered by callId.
 */
export function SkillOutputModal({ callId, slug, onClose }: { callId: string; slug: string; onClose: () => void }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const [ok, setOk] = useState<boolean | null>(null)
  const preRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    const unChunk = window.api.ai.onChunk((payload) => {
      if (payload.callId !== callId) return
      setText((t) => t + payload.text)
    })
    const unDone = window.api.ai.onDone((payload) => {
      if (payload.callId !== callId) return
      setDone(true)
      setOk(payload.ok)
      if (payload.output) setText((t) => t || payload.output)
    })
    return () => { unChunk(); unDone() }
  }, [callId])

  // Autoscroll
  useEffect(() => {
    const el = preRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-800 rounded-2xl shadow-pop max-w-3xl w-full mx-4 flex flex-col"
        style={{ maxHeight: '80vh' }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div>
            <div className="text-sm font-semibold text-gray-100">Skill output</div>
            <div className="text-[11px] text-gray-500 font-mono">{slug}</div>
          </div>
          <div className="flex items-center gap-2">
            {!done && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-violet-300">
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Streaming…
              </span>
            )}
            {done && ok === true && <span className="text-[11px] text-emerald-400">Done</span>}
            {done && ok === false && <span className="text-[11px] text-red-400">Errored</span>}
            <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xs px-2 py-1">Close</button>
          </div>
        </div>
        <pre
          ref={preRef}
          className="flex-1 overflow-y-auto px-5 py-4 text-xs text-gray-200 font-mono whitespace-pre-wrap leading-relaxed"
        >
          {text || <span className="text-gray-600">Waiting for output…</span>}
        </pre>
        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-end gap-2">
          <button
            onClick={() => { navigator.clipboard.writeText(text).catch(() => {}) }}
            disabled={!text}
            className="h-7 px-3 rounded-md border border-gray-800 hover:border-gray-700 text-gray-300 text-xs transition-colors disabled:opacity-50"
          >
            Copy output
          </button>
        </div>
      </div>
    </div>
  )
}
