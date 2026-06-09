import React, { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../store'
import { ELI5Card } from './ELI5Card'
import { ChecklistWidget } from './ChecklistWidget'
import { NotesTab } from './NotesTab'
import { SkillsTab } from './SkillsTab'
import { ProgressBar } from './ProgressBar'
import type { TabType, IssueState, GitBranchInfo } from '../types'
import { useTerminal } from '../hooks/useTerminal'
import { useLinear } from '../hooks/useLinear'
import { Markdown } from './Markdown'

function UpdateProgressButton({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const [state, setState] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const handleClick = async () => {
    setState('loading')
    try {
      await window.api.progress.generateManual(ticketId)
      await onDone()
      setState('done')
      setTimeout(() => setState('idle'), 2000)
    } catch (err) {
      console.error('Progress update failed:', err)
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === 'loading'}
      className="text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-50"
      title="Generate progress summary from git activity using Claude"
    >
      {state === 'loading' ? (
        <span className="flex items-center gap-1">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Generating…
        </span>
      ) : state === 'done' ? '✓ Updated' : state === 'error' ? '✕ Failed' : '↻ Update'}
    </button>
  )
}

export function TicketView() {
  const store = useAppStore()
  const selectedIssue = store.selectedIssue
  const activeTab = store.activeTab
  const terminalOpen = store.terminalOpen
  const isSyncing = store.isSyncing
  const { setActiveTab, progress, setProgress, setTerminalOpen, ticketBranches, setTicketBranch, activeTabId, updateTab } = store
  const { openTerminal } = useTerminal()
  const { selectIssue } = useLinear()
  const [branchInput, setBranchInput] = useState('')
  const [branchSaved, setBranchSaved] = useState(false)
  const [branchEditing, setBranchEditing] = useState(false)

  // Status dropdown state
  const [issueStates, setIssueStates] = useState<IssueState[]>([])
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [statusUpdated, setStatusUpdated] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Git branch info state
  const [gitInfo, setGitInfo] = useState<GitBranchInfo | null>(null)

  useEffect(() => {
    if (selectedIssue) {
      loadProgress(selectedIssue.id)
      loadBranch(selectedIssue.id)
      loadIssueStates(selectedIssue.id)
    }
    setStatusDropdownOpen(false)
    setGitInfo(null)
    setBranchEditing(false)
  }, [selectedIssue?.id])

  // Close dropdown on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setStatusDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  const loadIssueStates = async (issueId: string) => {
    try {
      setStatusLoading(true)
      const states = await window.api.linear.getIssueStates(issueId)
      setIssueStates(states)
    } catch {
      // ignore
    } finally {
      setStatusLoading(false)
    }
  }

  const handleStatusUpdate = async (state: IssueState) => {
    if (!selectedIssue) return
    const currentStateName = selectedIssue.state?.name || ''
    try {
      setUpdatingStatus(true)
      await window.api.linear.updateStatus(selectedIssue.id, state.id, currentStateName, state.name)
      if (activeTabId) {
        updateTab(activeTabId, {
          issue: {
            ...selectedIssue,
            state: { id: state.id, name: state.name, color: state.color, type: state.type }
          }
        })
      }
      setStatusUpdated(true)
      setTimeout(() => setStatusUpdated(false), 1000)
      setStatusDropdownOpen(false)
    } catch {
      // ignore
    } finally {
      setUpdatingStatus(false)
    }
  }

  const loadProgress = async (ticketId: string) => {
    try {
      const p = await window.api.progress.get(ticketId)
      if (p) {
        setProgress(ticketId, p as any)
      }
    } catch {
      // ignore
    }
  }

  const loadBranch = async (ticketId: string) => {
    try {
      const branch = await window.api.ticketBranch.get(ticketId)
      if (branch) {
        setTicketBranch(ticketId, branch)
        setBranchInput(branch)
      } else {
        setBranchInput('')
      }
    } catch {
      // ignore
    }
  }

  const handleBranchSave = async () => {
    if (!selectedIssue) return
    try {
      await window.api.ticketBranch.save(selectedIssue.id, branchInput.trim())
      setTicketBranch(selectedIssue.id, branchInput.trim())
      setBranchSaved(true)
      setBranchEditing(false)
      setTimeout(() => setBranchSaved(false), 1800)
    } catch {
      // ignore
    }
  }

  const handleProgressChange = async (percent: number) => {
    if (!selectedIssue) return
    try {
      const p = await window.api.progress.update(selectedIssue.id, percent)
      if (p) setProgress(selectedIssue.id, p as any)
    } catch {
      // ignore
    }
  }

  const [projectRepos, setProjectRepos] = useState<string[]>([])

  useEffect(() => {
    if (selectedIssue?.project?.id) {
      window.api.projectRepos.getForProject(selectedIssue.project.id)
        .then(async (repos: string[]) => {
          setProjectRepos(repos)
          if (repos.length > 0 && selectedIssue && !ticketBranches[selectedIssue.id]) {
            try {
              const info = await window.api.git.getBranchInfo(`~/Work/${repos[0]}`)
              setGitInfo(info)
              if (info.branch && !ticketBranches[selectedIssue.id]) {
                setBranchInput(info.branch)
                await window.api.ticketBranch.save(selectedIssue.id, info.branch)
                setTicketBranch(selectedIssue.id, info.branch)
              }
            } catch {
              // ignore
            }
          } else if (repos.length > 0) {
            try {
              const info = await window.api.git.getBranchInfo(`~/Work/${repos[0]}`)
              setGitInfo(info)
            } catch {
              // ignore
            }
          }
        })
        .catch(() => setProjectRepos([]))
    } else {
      setProjectRepos([])
      setGitInfo(null)
    }
  }, [selectedIssue?.project?.id])

  // Periodically refresh git status while terminal is open
  useEffect(() => {
    if (!terminalOpen || projectRepos.length === 0 || !selectedIssue?.project?.id) return
    const refreshGit = async () => {
      try {
        const info = await window.api.git.getBranchInfo(`~/Work/${projectRepos[0]}`)
        setGitInfo(info)
      } catch {
        // ignore
      }
    }
    const interval = setInterval(refreshGit, 30_000)
    return () => clearInterval(interval)
  }, [terminalOpen, projectRepos, selectedIssue?.project?.id])

  const handleOpenTerminal = async (repoName?: string) => {
    setTerminalOpen(true)
    await openTerminal(80, 30, repoName)
  }

  // ---- Empty state ----
  if (!selectedIssue) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-900">
        <div className="text-center space-y-5">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="w-12 h-12 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center">
              <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-gray-300 text-sm font-medium mb-1">Open a ticket to get started</p>
            <p className="text-gray-600 text-xs">Select any issue from the sidebar</p>
          </div>
          <div className="flex flex-col items-center gap-2 text-xs text-gray-600">
            <span className="flex items-center gap-2">
              <kbd className="bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded font-mono text-gray-400">⌘K</kbd>
              <span>Search tickets</span>
            </span>
            <span>or click any ticket in the sidebar</span>
          </div>
        </div>
      </div>
    )
  }

  const issueProgress = progress[selectedIssue.id]
  const progressPercent = issueProgress?.percent || 0

  const tabs: { id: TabType; label: string }[] = [
    { id: 'detail', label: 'Detail' },
    { id: 'notes', label: 'Notes' },
    { id: 'skills', label: 'Skills' },
    { id: 'progress', label: 'Progress' }
  ]

  const getPriorityChip = (priority: number, label: string) => {
    const dotColors: Record<number, string> = {
      0: 'bg-gray-500',
      1: 'bg-red-500',
      2: 'bg-orange-500',
      3: 'bg-yellow-500',
      4: 'bg-gray-500',
    }
    const textColors: Record<number, string> = {
      0: 'text-gray-400',
      1: 'text-red-400',
      2: 'text-orange-400',
      3: 'text-yellow-400',
      4: 'text-gray-500',
    }
    return (
      <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 ${textColors[priority] || textColors[0]}`}>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColors[priority] || dotColors[0]}`} />
        {label}
      </span>
    )
  }

  const getStateBadge = (state: { name: string; color: string; type: string }) => {
    return (
      <div ref={dropdownRef} className="relative inline-block">
        <button
          onClick={() => !statusLoading && setStatusDropdownOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border transition-all hover:opacity-90"
          style={{
            borderColor: state.color + '60',
            backgroundColor: state.color + '20',
            color: state.color
          }}
          title="Click to change status"
          disabled={updatingStatus}
        >
          <span style={{ minWidth: '4rem', display: 'inline-block' }}>
            {statusUpdated ? 'Updated ✓' : state.name}
          </span>
          {statusLoading
            ? <svg className="w-3 h-3 opacity-60 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 20l4-4m0 0a9 9 0 0112.7 0M20 4l-4 4m0 0a9 9 0 00-12.7 0" /></svg>
            : <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          }
        </button>
        {statusDropdownOpen && issueStates.length > 0 && (
          <div className="absolute left-0 top-full z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-48 mt-1 overflow-hidden">
            {issueStates.map((s) => (
              <button
                key={s.id}
                onClick={() => handleStatusUpdate(s)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors text-left"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-900 overflow-hidden">
      {/* Sync indicator strip */}
      {isSyncing && <div className="h-0.5 bg-indigo-500 animate-pulse flex-shrink-0" />}

      {/* Ticket Header */}
      <div className="px-5 py-3 border-b border-gray-800 flex-shrink-0">
        {/* Top meta line */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-500 font-mono">{selectedIssue.identifier}</span>
          {selectedIssue.project && (
            <>
              <span className="text-gray-700">•</span>
              <span className="text-xs text-gray-500">{selectedIssue.project.name}</span>
            </>
          )}
          {/* Parent ticket pill */}
          {selectedIssue.parent && (
            <button
              onClick={() => selectedIssue.parent && selectIssue(selectedIssue.parent.id)}
              className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-500 hover:text-indigo-400 hover:border-indigo-600/50 transition-colors"
              title={`Parent: ${selectedIssue.parent.title}`}
            >
              <span className="text-gray-600">↑</span>
              <span className="font-mono">{selectedIssue.parent.identifier}</span>
            </button>
          )}
          {/* Linear icon link — small, unobtrusive */}
          <a
            href={selectedIssue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex-shrink-0 text-gray-600 hover:text-indigo-400 transition-colors"
            title="View in Linear"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>

        {/* Title */}
        <h2 className="text-base font-semibold text-gray-100 leading-snug mb-2">
          {selectedIssue.title}
        </h2>

        {/* Thin indigo progress bar right under title */}
        <div className="h-1 bg-gray-800 rounded-full overflow-hidden mb-2.5">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              progressPercent === 100 ? 'bg-green-500' : progressPercent > 0 ? 'bg-indigo-500' : 'bg-gray-700'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Status + priority + assignee row */}
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          {getStateBadge(selectedIssue.state)}
          {getPriorityChip(selectedIssue.priority, selectedIssue.priorityLabel)}
          {selectedIssue.assignee && (
            <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400">
              <span className="w-4 h-4 rounded-full bg-indigo-700 flex items-center justify-center text-xs text-indigo-200 font-medium flex-shrink-0">
                {selectedIssue.assignee.name.charAt(0)}
              </span>
              {selectedIssue.assignee.name}
            </span>
          )}
          {/* Labels as small colored dots */}
          {selectedIssue.labels && selectedIssue.labels.length > 0 && (
            <div className="flex items-center gap-1.5">
              {selectedIssue.labels.map((label) => (
                <span
                  key={label.id}
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: label.color }}
                  title={label.name}
                />
              ))}
            </div>
          )}
          {/* Repo terminal buttons — right side */}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {projectRepos.length > 1 ? (
              projectRepos.map((repo) => (
                <button
                  key={repo}
                  onClick={() => handleOpenTerminal(repo)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors border ${
                    terminalOpen
                      ? 'bg-gray-800 text-gray-400 hover:bg-gray-700 border-gray-700'
                      : 'bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 border-indigo-600/40'
                  }`}
                  title={`Open terminal in ~/Work/${repo}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {repo}
                </button>
              ))
            ) : projectRepos.length === 1 ? (
              <button
                onClick={() => handleOpenTerminal(projectRepos[0])}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                  terminalOpen
                    ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                ▶ {projectRepos[0]}
              </button>
            ) : null}
          </div>
        </div>

        {/* Branch row — compact single line */}
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          {branchEditing ? (
            <>
              <input
                type="text"
                value={branchInput}
                onChange={(e) => setBranchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleBranchSave()
                  if (e.key === 'Escape') setBranchEditing(false)
                }}
                autoFocus
                placeholder="feature/my-branch"
                className="flex-1 max-w-xs bg-gray-800 border border-indigo-600/50 rounded px-2 py-0.5 text-xs text-gray-300 placeholder-gray-600 font-mono focus:outline-none"
              />
              <button
                onClick={handleBranchSave}
                className="px-2 py-0.5 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                {branchSaved ? 'Saved!' : 'Save'}
              </button>
              <button
                onClick={() => setBranchEditing(false)}
                className="px-1.5 py-0.5 rounded text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                ✕
              </button>
            </>
          ) : (
            <button
              onClick={() => setBranchEditing(true)}
              className="text-xs font-mono text-gray-400 hover:text-gray-200 transition-colors"
              title="Click to edit branch"
            >
              {branchInput || <span className="text-gray-600 italic">no branch</span>}
            </button>
          )}
          {/* Git status chips */}
          {gitInfo && (
            <div className="flex items-center gap-1 text-xs ml-1">
              {gitInfo.aheadBy > 0 && (
                <span className="text-blue-400 font-mono" title={`${gitInfo.aheadBy} commit(s) ahead`}>
                  ↑{gitInfo.aheadBy}
                </span>
              )}
              {gitInfo.behindBy > 0 && (
                <span className="text-orange-400 font-mono" title={`${gitInfo.behindBy} commit(s) behind`}>
                  ↓{gitInfo.behindBy}
                </span>
              )}
              {gitInfo.isDirty && (
                <span className="text-yellow-500 font-mono" title="Uncommitted changes">●dirty</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-5 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'detail' && (
          <div className="h-full overflow-y-auto p-5 space-y-5">
            {/* ELI5 Card */}
            <ELI5Card
              ticketId={selectedIssue.id}
              title={selectedIssue.title}
              description={selectedIssue.description}
            />

            {/* Description */}
            {selectedIssue.description ? (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Description</h3>
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <Markdown>{selectedIssue.description}</Markdown>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600 italic">No description provided.</p>
            )}

            {/* Checklist */}
            <div className="border-t border-gray-800 pt-4">
              <ChecklistWidget ticketId={selectedIssue.id} />
            </div>

            {/* Metadata */}
            <div className="border-t border-gray-800 pt-4 grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-gray-500 uppercase tracking-wider text-xs">Created</span>
                <p className="text-gray-400 mt-0.5">
                  {new Date(selectedIssue.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div>
                <span className="text-gray-500 uppercase tracking-wider text-xs">Updated</span>
                <p className="text-gray-400 mt-0.5">
                  {new Date(selectedIssue.updatedAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'notes' && <NotesTab ticketId={selectedIssue.id} />}

        {activeTab === 'skills' && <SkillsTab ticketId={selectedIssue.id} />}

        {activeTab === 'progress' && (
          <div className="h-full overflow-y-auto p-5 space-y-6">
            <div>
              {/* Percent display */}
              <div className="flex items-baseline gap-2 mb-3">
                <span
                  className={`text-3xl font-bold tabular-nums ${
                    progressPercent === 100
                      ? 'text-green-400'
                      : progressPercent > 0
                      ? 'text-indigo-400'
                      : 'text-gray-600'
                  }`}
                >
                  {progressPercent}%
                </span>
                <span className="text-xs text-gray-500">complete</span>
              </div>

              {/* Progress bar */}
              <ProgressBar percent={progressPercent} showLabel={false} className="mb-4" />

              {/* Slider below */}
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={progressPercent}
                onChange={(e) => handleProgressChange(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />

              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Quick set buttons */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Quick Set</p>
              <div className="flex gap-1.5">
                {[0, 25, 50, 75, 100].map((p) => (
                  <button
                    key={p}
                    onClick={() => handleProgressChange(p)}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                      progressPercent === p
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                    }`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>

            {/* Activity log — timeline style */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Activity Log</h3>
                <UpdateProgressButton ticketId={selectedIssue.id} onDone={async () => {
                  const p = await window.api.progress.get(selectedIssue.id)
                  if (p) setProgress(selectedIssue.id, p as any)
                }} />
              </div>
              {issueProgress?.log ? (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {issueProgress.log.split('\n').filter(Boolean).map((line, i) => {
                    const match = line.match(/^\[(.+?)\]\s*\((\d+%\s*→\s*\d+%)\)\s*(.+)$/)
                    if (match) {
                      const [, ts, pct, summary] = match
                      return (
                        <div key={i} className="flex gap-3 text-xs">
                          <div className="flex flex-col items-center pt-1 flex-shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                            <span className="w-px flex-1 bg-gray-800 mt-1" />
                          </div>
                          <div className="pb-3">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-gray-600 font-mono">{ts}</span>
                              <span className="text-indigo-400 font-mono font-medium">{pct}</span>
                            </div>
                            <p className="text-gray-300">{summary}</p>
                          </div>
                        </div>
                      )
                    }
                    return <p key={i} className="text-xs text-gray-500 font-mono">{line}</p>
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-600 italic">No activity logged yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
