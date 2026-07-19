import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store'
import type { ChecklistItem } from '../types'
const uuidv4 = () => crypto.randomUUID()

interface ChecklistWidgetProps {
  ticketId: string
}

export function ChecklistWidget({ ticketId }: ChecklistWidgetProps) {
  const { checklists, setChecklist, selectedIssue } = useAppStore()
  const [newItemText, setNewItemText] = useState('')
  const [generating, setGenerating] = useState(false)
  const checklist = checklists[ticketId]
  const items = checklist?.items || []

  useEffect(() => {
    loadChecklist()
  }, [ticketId])

  const loadChecklist = async () => {
    try {
      const data = await window.api.checklist.get(ticketId)
      if (data) {
        setChecklist(ticketId, data as any)
      }
    } catch {
      // ignore
    }
  }

  const saveItems = async (newItems: ChecklistItem[]) => {
    try {
      const saved = await window.api.checklist.save(ticketId, newItems)
      setChecklist(ticketId, saved as any)
    } catch (err) {
      console.error('Failed to save checklist:', err)
    }
  }

  const toggleItem = (id: string) => {
    const newItems = items.map((item) =>
      item.id === id ? { ...item, done: !item.done } : item
    )
    saveItems(newItems)
  }

  const addItem = () => {
    if (!newItemText.trim()) return
    const newItems = [...items, { id: uuidv4(), text: newItemText.trim(), done: false }]
    saveItems(newItems)
    setNewItemText('')
  }

  const deleteItem = (id: string) => {
    const newItems = items.filter((item) => item.id !== id)
    saveItems(newItems)
  }

  const doneCount = items.filter((i) => i.done).length

  const autoGenerate = async () => {
    if (!selectedIssue || generating) return
    if (items.length > 0 && !window.confirm('Append AI-generated items to the existing checklist?')) return
    setGenerating(true)
    try {
      const generated = await window.api.checklist.generate(ticketId, selectedIssue.title, selectedIssue.description || '')
      if (generated && generated.length > 0) {
        const newItems = [...items, ...generated.map((text) => ({ id: uuidv4(), text, done: false }))]
        await saveItems(newItems)
      }
    } catch (err) {
      console.error('Failed to auto-generate checklist:', err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Checklist</h3>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <span className="text-xs text-gray-600">{doneCount}/{items.length} done</span>
          )}
          <button
            onClick={autoGenerate}
            disabled={generating || !selectedIssue}
            className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[10px] font-medium bg-violet-500/10 text-violet-300 border border-violet-500/20 hover:bg-violet-500/20 disabled:opacity-50 transition-colors"
            title="Generate checklist items from the ticket description"
          >
            {generating ? '…' : '✨'} {generating ? 'Generating' : 'Auto'}
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="space-y-0.5">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 group py-1 px-1.5 rounded hover:bg-gray-800/40 transition-colors"
            >
              <button
                onClick={() => toggleItem(item.id)}
                className={`flex-shrink-0 w-3.5 h-3.5 rounded border transition-colors ${
                  item.done
                    ? 'bg-violet-500 border-violet-500'
                    : 'border-gray-600 hover:border-violet-400'
                }`}
              >
                {item.done && (
                  <svg viewBox="0 0 12 12" fill="none" className="w-full h-full p-0.5">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
              <span
                className={`flex-1 text-xs ${
                  item.done ? 'line-through text-gray-600' : 'text-gray-300'
                }`}
              >
                {item.text}
              </span>
              <button
                onClick={() => deleteItem(item.id)}
                className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-400 transition-all text-xs"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-600 italic">No checklist items yet.</p>
      )}

      <div className="flex gap-2 mt-1.5">
        <input
          type="text"
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addItem()}
          placeholder="+ Add item..."
          className="flex-1 bg-transparent border-b border-gray-800 focus:border-violet-600 px-1 py-0.5 text-xs text-gray-400 placeholder-gray-600 focus:outline-none transition-colors"
        />
        {newItemText.trim() && (
          <button
            onClick={addItem}
            className="px-2 py-0.5 bg-violet-600 text-white rounded text-xs hover:bg-violet-700 transition-colors"
          >
            Add
          </button>
        )}
      </div>
    </div>
  )
}
