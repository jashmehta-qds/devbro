import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../store'
import { Markdown } from './Markdown'

interface NotesTabProps {
  ticketId: string
}

type ViewMode = 'edit' | 'preview'

const TEMPLATES: Record<string, string> = {
  bug: `## Bug Report\n\n**Repro steps:**\n1. \n\n**Expected:**\n\n**Actual:**\n\n**Possible cause:**\n`,
  feature: `## Implementation Plan\n\n**Goal:**\n\n**Approach:**\n\n**Open questions:**\n\n**Testing:**\n`,
  chore: `## Tasks\n\n- [ ] \n\n**Notes:**\n`,
}

export function NotesTab({ ticketId }: NotesTabProps) {
  const { notes, setNote } = useAppStore()
  const [localContent, setLocalContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const templatesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadNotes()
  }, [ticketId])

  useEffect(() => {
    const note = notes[ticketId]
    setLocalContent(note?.content || '')
  }, [notes, ticketId])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) {
        setTemplatesOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const loadNotes = async () => {
    try {
      const note = await window.api.notes.get(ticketId)
      if (note) {
        setNote(ticketId, note as any)
      }
    } catch {
      // ignore
    }
  }

  const saveNotes = useCallback(async () => {
    setSaving(true)
    try {
      const result = await window.api.notes.save(ticketId, localContent)
      setNote(ticketId, result as any)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save notes:', err)
    } finally {
      setSaving(false)
    }
  }, [ticketId, localContent, setNote])

  const applyTemplate = (key: keyof typeof TEMPLATES) => {
    const tmpl = TEMPLATES[key]
    if (localContent.trim().length > 0) {
      const ok = window.confirm('Replace current notes?')
      if (!ok) {
        setTemplatesOpen(false)
        return
      }
    }
    setLocalContent(tmpl)
    setTemplatesOpen(false)
  }

  return (
    <div className="h-full flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-300">Notes</h3>
        <div className="flex items-center gap-2">
          {/* Templates dropdown */}
          <div ref={templatesRef} className="relative">
            <button
              onClick={() => setTemplatesOpen((o) => !o)}
              className="px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Templates ▾
            </button>
            {templatesOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-44 overflow-hidden">
                <button
                  onClick={() => applyTemplate('bug')}
                  className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  Bug Report
                </button>
                <button
                  onClick={() => applyTemplate('feature')}
                  className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  Feature
                </button>
                <button
                  onClick={() => applyTemplate('chore')}
                  className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  Chore
                </button>
              </div>
            )}
          </div>

          {/* View toggle */}
          <div className="flex items-center bg-gray-800 border border-gray-700 rounded overflow-hidden">
            <button
              onClick={() => setViewMode('edit')}
              className={`px-2 py-1 text-xs transition-colors ${
                viewMode === 'edit'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Edit
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`px-2 py-1 text-xs transition-colors ${
                viewMode === 'preview'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Preview
            </button>
          </div>

          <span className="text-xs text-gray-500 min-w-[80px] text-right">
            {saving ? (
              <span className="text-yellow-400">Saving...</span>
            ) : saved ? (
              <span className="text-green-400">Saved</span>
            ) : (
              'Auto-saves'
            )}
          </span>
        </div>
      </div>

      {viewMode === 'edit' ? (
        <textarea
          value={localContent}
          onChange={(e) => setLocalContent(e.target.value)}
          onBlur={saveNotes}
          placeholder="Write notes about this ticket... (Markdown supported)"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono resize-none leading-relaxed"
        />
      ) : (
        <div className="flex-1 overflow-y-auto bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          {localContent.trim() ? (
            <Markdown>{localContent}</Markdown>
          ) : (
            <p className="text-sm text-gray-600 italic">Nothing to preview yet.</p>
          )}
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-600">
          Notes are included as context when launching Claude terminal
        </p>
        <button
          onClick={saveNotes}
          disabled={saving}
          className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  )
}
