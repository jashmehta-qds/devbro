import React, { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '../store'
import type { LinearIssue, IssueState } from '../types'

const STATE_ORDER: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  cancelled: 4,
}

const STATE_COLORS: Record<string, string> = {
  backlog: '#6B7280',
  unstarted: '#9CA3AF',
  started: '#3B82F6',
  completed: '#10B981',
  cancelled: '#6B7280',
}

function PriorityPill({ label }: { label: string }) {
  const colorMap: Record<string, string> = {
    'Urgent': 'bg-red-900/40 text-red-300 border-red-700/50',
    'High': 'bg-orange-900/40 text-orange-300 border-orange-700/50',
    'Medium': 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
    'Low': 'bg-gray-700/40 text-gray-400 border-gray-700',
  }
  const classes = colorMap[label] || 'bg-gray-700/40 text-gray-400 border-gray-700'
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${classes}`}>
      {label}
    </span>
  )
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="w-5 h-5 rounded-full object-cover" />
  }
  return (
    <div className="w-5 h-5 rounded-full bg-violet-700 flex items-center justify-center text-[9px] text-white font-medium flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

interface KanbanBoardProps {
  projectId: string
}

export function KanbanBoard({ projectId }: KanbanBoardProps) {
  const { issues, openTab } = useAppStore()
  const [states, setStates] = useState<IssueState[]>([])
  const [draggedIssueId, setDraggedIssueId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const projectIssues = issues[projectId] ?? []

  // Load states on mount (fetch from first issue's team)
  useEffect(() => {
    const loadStates = async () => {
      try {
        if (projectIssues.length === 0) {
          setStates([])
          setLoading(false)
          return
        }
        const issueStates = await window.api.linear.getIssueStates(projectIssues[0].id)
        setStates(issueStates)
      } catch (err) {
        console.error('Failed to load issue states:', err)
        // ponytail: fallback to unique states from issues themselves
        const uniqueStates = new Map<string, IssueState>()
        projectIssues.forEach((issue) => {
          if (!uniqueStates.has(issue.state.id)) {
            uniqueStates.set(issue.state.id, issue.state)
          }
        })
        setStates(Array.from(uniqueStates.values()))
      } finally {
        setLoading(false)
      }
    }
    loadStates()
  }, [projectIssues])

  // Group issues by state
  const issuesByState = useMemo(() => {
    const grouped: Record<string, LinearIssue[]> = {}
    states.forEach((state) => {
      grouped[state.id] = projectIssues.filter((issue) => issue.state.id === state.id)
    })
    return grouped
  }, [projectIssues, states])

  // Sort states by workflow order
  const sortedStates = useMemo(() => {
    return [...states].sort((a, b) => {
      const orderA = STATE_ORDER[a.type] ?? 999
      const orderB = STATE_ORDER[b.type] ?? 999
      return orderA - orderB
    })
  }, [states])

  const handleDragStart = (issueId: string) => {
    setDraggedIssueId(issueId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (toStateId: string) => {
    if (!draggedIssueId) return
    const issue = projectIssues.find((i) => i.id === draggedIssueId)
    if (!issue) return

    const fromStateName = issue.state.name
    const toState = states.find((s) => s.id === toStateId)
    if (!toState) return

    // ponytail: naive HTML5 drag-drop without lib. works but lacks polishing (no preview, no cancel).
    // if this becomes painful, swap in react-beautiful-dnd or similar.
    setDraggedIssueId(null)

    // Optimistically update local store
    useAppStore.setState((state) => {
      const updated = state.issues[projectId]?.map((i) =>
        i.id === draggedIssueId ? { ...i, state: toState } : i
      ) ?? []
      return { issues: { ...state.issues, [projectId]: updated } }
    })

    // Call API
    try {
      await window.api.linear.updateStatus(draggedIssueId, toStateId, fromStateName, toState.name)
    } catch (err) {
      console.error('Failed to update issue state:', err)
      // Revert on failure
      useAppStore.setState((state) => {
        const reverted = state.issues[projectId]?.map((i) =>
          i.id === draggedIssueId ? { ...i, state: issue.state } : i
        ) ?? []
        return { issues: { ...state.issues, [projectId]: reverted } }
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading board...
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-x-auto bg-gray-900 p-4">
      <div className="flex gap-4 h-full">
        {sortedStates.map((state) => {
          const issuesInState = issuesByState[state.id] ?? []
          return (
            <div
              key={state.id}
              className="w-72 flex-shrink-0 bg-gray-900 border border-gray-800 rounded-xl flex flex-col"
            >
              {/* Column header */}
              <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: state.color }}
                />
                <span className="text-xs font-medium text-gray-300">{state.name}</span>
                <span className="ml-auto text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">
                  {issuesInState.length}
                </span>
              </div>

              {/* Cards container */}
              <div
                className="flex-1 overflow-y-auto p-2"
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(state.id)}
              >
                {issuesInState.length === 0 ? (
                  <div className="text-xs text-gray-600 text-center py-8">
                    No issues
                  </div>
                ) : (
                  issuesInState.map((issue) => (
                    <div
                      key={issue.id}
                      draggable
                      onDragStart={() => handleDragStart(issue.id)}
                      className="bg-gray-850 border border-gray-800 rounded-lg p-3 m-2 cursor-move hover:border-gray-700 transition-colors"
                      onClick={() => openTab(issue)}
                    >
                      {/* Identifier */}
                      <p className="text-[10px] tracking-[0.14em] uppercase text-gray-500 font-mono">
                        {issue.identifier}
                      </p>

                      {/* Title */}
                      <p className="text-sm text-gray-100 mt-1 line-clamp-2 leading-tight">
                        {issue.title}
                      </p>

                      {/* Footer: priority + assignee */}
                      <div className="flex items-center gap-2 mt-3 justify-between">
                        <PriorityPill label={issue.priorityLabel} />
                        {issue.assignee && (
                          <Avatar name={issue.assignee.name} avatarUrl={issue.assignee.avatarUrl} />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
