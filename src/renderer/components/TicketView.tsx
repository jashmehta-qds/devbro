import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useAppStore } from '../store'
import { ELI5Card } from './ELI5Card'
import { ChecklistWidget } from './ChecklistWidget'
import { SkillsTab } from './SkillsTab'
import { DiffViewer } from './DiffViewer'
import { ActivityTimeline } from './ActivityTimeline'
import type { IssueState, GitBranchInfo } from '../types'
import { useTerminal } from '../hooks/useTerminal'
import { useLinear } from '../hooks/useLinear'
import { useWorkDir, repoPath as buildRepoPath } from '../hooks/useWorkDir'
import { Markdown } from './Markdown'

const TEMPLATES: Record<string, string> = {
  bug: `## Bug Report\n\n**Repro steps:**\n1. \n\n**Expected:**\n\n**Actual:**\n\n**Possible cause:**\n`,
  feature: `## Implementation Plan\n\n**Goal:**\n\n**Approach:**\n\n**Open questions:**\n\n**Testing:**\n`,
  chore: `## Tasks\n\n- [ ] \n\n**Notes:**\n`,
}

function InlineNotes({ ticketId }: { ticketId: string }) {
  const { notes, setNote } = useAppStore()
  const [localContent, setLocalContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const templatesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.notes.get(ticketId).then((note: any) => {
      if (note) setNote(ticketId, note)
    }).catch(() => {})
  }, [ticketId])

  useEffect(() => {
    setLocalContent(notes[ticketId]?.content || '')
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
    if (localContent.trim().length > 0 && !window.confirm('Replace current notes?')) {
      setTemplatesOpen(false)
      return
    }
    setLocalContent(TEMPLATES[key])
    setTemplatesOpen(false)
  }

  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <h3 className="flex text-sm uppercase tracking-[0.14em] text-gray-500 font-medium">Notes</h3>

        <div className="flex items-center gap-2">
          <div ref={templatesRef} className="relative">
            <button
              onClick={() => setTemplatesOpen((o) => !o)}
              className="inline-flex items-center h-6 px-2 rounded-md bg-gray-900 border border-gray-800 text-xs text-gray-400 hover:border-gray-700 hover:text-gray-200 transition-colors"
            >
              Templates ▾
            </button>
            {templatesOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-gray-850 border border-gray-800 rounded-lg shadow-elev w-36 overflow-hidden">
                {(['bug', 'feature', 'chore'] as const).map((k) => (
                  <button key={k} onClick={() => applyTemplate(k)}
                    className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 capitalize transition-colors"
                  >{k}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center bg-gray-900 border border-gray-800 rounded-md overflow-hidden">
            {(['edit', 'preview'] as const).map((m) => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`h-6 px-2 text-xs transition-colors ${viewMode === m ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >{m.charAt(0).toUpperCase() + m.slice(1)}</button>
            ))}
          </div>
          <span className="text-xs text-gray-600 min-w-[50px] text-right">
            {saving ? <span className="text-yellow-400">Saving…</span> : saved ? <span className="text-green-400">Saved</span> : ''}
          </span>
        </div>
      </div>

      {viewMode === 'edit' ? (
        <textarea
          value={localContent}
          onChange={(e) => setLocalContent(e.target.value)}
          onBlur={saveNotes}
          placeholder="Write notes… (Markdown supported)"
          className="flex-1 w-full bg-transparent text-gray-200 text-sm leading-relaxed placeholder:text-gray-600 outline-none resize-none font-mono"
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {localContent.trim()
            ? <Markdown>{localContent}</Markdown>
            : <p className="text-xs text-gray-600 italic">Nothing to preview yet.</p>}
        </div>
      )}

      <div className="flex justify-between items-center flex-shrink-0">
        <p className="text-xs text-gray-600">Included as Claude context</p>
        <button onClick={saveNotes} disabled={saving}
          className="inline-flex items-center h-7 px-3 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium transition-colors shadow-soft"
        >Save</button>
      </div>
    </div>
  )
}


type SecondaryTab = 'notes' | 'checklist' | 'skills' | 'diff' | 'activity'

const PRIORITY_COLORS: Record<number, string> = {
  1: 'text-red-300 bg-red-500/10 border-red-500/20',
  2: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
  3: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20',
  4: 'text-gray-400 bg-gray-800 border-gray-800',
}
const PRIORITY_LABELS: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' }

const STATE_DOT_COLOR: Record<string, string> = {
  started: 'bg-violet-400',
  completed: 'bg-green-400',
  cancelled: 'bg-gray-500',
  backlog: 'bg-gray-600',
  unstarted: 'bg-gray-500',
}

export function TicketView() {
  const store = useAppStore()
  const selectedIssue = store.selectedIssue
  const drawerSessions = store.drawerSessions
  const isSyncing = store.isSyncing
  const { progress, setProgress, ticketBranches, setTicketBranch, activeTabId, updateTab } = store
  // Does this ticket currently have a live terminal session in the drawer?
  const hasLiveTerminal = !!selectedIssue && drawerSessions.some((d) => d.ticketId === selectedIssue.id)
  const { openTerminal } = useTerminal()
  const workDir = useWorkDir()
  const { selectIssue } = useLinear()
  const [branchInput, setBranchInput] = useState('')
  const [branchSaved, setBranchSaved] = useState(false)
  const [branchEditing, setBranchEditing] = useState(false)
  const [branchCopied, setBranchCopied] = useState(false)

  const [issueStates, setIssueStates] = useState<IssueState[]>([])
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [statusUpdated, setStatusUpdated] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [gitInfo, setGitInfo] = useState<GitBranchInfo | null>(null)
  const [secondaryTab, setSecondaryTab] = useState<SecondaryTab>('notes')

  // GitHub integration state
  const [ghPat, setGhPat] = useState<string | null>(null)
  const [prInfo, setPrInfo] = useState<any | null>(null)
  const [prLoading, setPrLoading] = useState(false)
  const [showCreatePr, setShowCreatePr] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [prBase, setPrBase] = useState('main')
  const [prBodyLoading, setPrBodyLoading] = useState(false)
  const [prCreating, setPrCreating] = useState(false)
  const [createBranchLoading, setCreateBranchLoading] = useState(false)

  useEffect(() => {
    if (selectedIssue) {
      loadProgress(selectedIssue.id)
      loadBranch(selectedIssue.id)
      loadIssueStates(selectedIssue.id)
    }
    setStatusDropdownOpen(false)
    setGitInfo(null)
    setBranchEditing(false)
    setPrInfo(null)
  }, [selectedIssue?.id])

  // Load GitHub PAT once
  useEffect(() => {
    window.api.appConfig.get('github_pat').then((v: string | null) => setGhPat(v || null)).catch(() => {})
  }, [])

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
          issue: { ...selectedIssue, state: { id: state.id, name: state.name, color: state.color, type: state.type } }
        })
      }
      setStatusUpdated(true)
      setTimeout(() => setStatusUpdated(false), 1000)
      setStatusDropdownOpen(false)
    } catch {
    } finally {
      setUpdatingStatus(false)
    }
  }

  const loadProgress = async (ticketId: string) => {
    try {
      const p = await window.api.progress.get(ticketId)
      if (p) setProgress(ticketId, p as any)
    } catch {}
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
    } catch {}
  }

  const handleBranchSave = async () => {
    if (!selectedIssue) return
    try {
      await window.api.ticketBranch.save(selectedIssue.id, branchInput.trim())
      setTicketBranch(selectedIssue.id, branchInput.trim())
      setBranchSaved(true)
      setBranchEditing(false)
      setTimeout(() => setBranchSaved(false), 1800)
    } catch {}
  }

  const loadPr = async (repoPath: string, branch: string) => {
    if (!ghPat || !branch) return
    setPrLoading(true)
    try {
      const result = await (window.api as any).github.getPrForBranch(buildRepoPath(workDir, repoPath), branch)
      setPrInfo(result)
    } catch {
      setPrInfo(null)
    } finally {
      setPrLoading(false)
    }
  }

  const handleCreateBranch = async () => {
    if (!selectedIssue || projectRepos.length === 0) return
    const name = (selectedIssue.identifier.toLowerCase() + '-' + selectedIssue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 52).replace(/-+$/, '')
    setCreateBranchLoading(true)
    try {
      const result = await (window.api as any).github.createBranch(buildRepoPath(workDir, projectRepos[0]), name)
      if (result.ok) {
        setBranchInput(name)
        await window.api.ticketBranch.save(selectedIssue.id, name)
        setTicketBranch(selectedIssue.id, name)
      }
    } catch {}
    setCreateBranchLoading(false)
  }

  const handleOpenCreatePr = async () => {
    if (!selectedIssue || projectRepos.length === 0) return
    setPrTitle(selectedIssue.title)
    setPrBody('')
    setPrBodyLoading(true)
    setShowCreatePr(true)
    try {
      const result = await (window.api as any).github.draftPrBody(
        buildRepoPath(workDir, projectRepos[0]), branchInput, prBase,
        selectedIssue.title, selectedIssue.description || ''
      )
      if (result.ok) setPrBody(result.body)
    } catch {}
    setPrBodyLoading(false)
  }

  const handleCreatePr = async () => {
    if (!selectedIssue || projectRepos.length === 0) return
    setPrCreating(true)
    try {
      const result = await (window.api as any).github.createPr(buildRepoPath(workDir, projectRepos[0]), {
        title: prTitle, body: prBody, head: branchInput, base: prBase
      })
      if (result.url) {
        window.open(result.url, '_blank')
        setShowCreatePr(false)
        await loadPr(projectRepos[0], branchInput)
      }
    } catch {}
    setPrCreating(false)
  }


  const [projectRepos, setProjectRepos] = useState<string[]>([])

  const reposKey = selectedIssue?.project?.id ?? (selectedIssue ? '__no_project__' : null)

  useEffect(() => {
    if (reposKey) {
      window.api.projectRepos.getForProject(reposKey)
        .then(async (repos: string[]) => {
          setProjectRepos(repos)
          if (repos.length > 0 && selectedIssue && !ticketBranches[selectedIssue.id]) {
            try {
              const info = await window.api.git.getBranchInfo(buildRepoPath(workDir, repos[0]))
              setGitInfo(info)
              if (info.branch && !ticketBranches[selectedIssue.id]) {
                setBranchInput(info.branch)
                await window.api.ticketBranch.save(selectedIssue.id, info.branch)
                setTicketBranch(selectedIssue.id, info.branch)
              }
            } catch {}
          } else if (repos.length > 0) {
            try {
              const info = await window.api.git.getBranchInfo(buildRepoPath(workDir, repos[0]))
              setGitInfo(info)
            } catch {}
          }
        })
        .catch(() => setProjectRepos([]))
    } else {
      setProjectRepos([])
      setGitInfo(null)
    }
  }, [reposKey])

  useEffect(() => {
    if (!hasLiveTerminal || projectRepos.length === 0) return
    const refreshGit = async () => {
      try {
        const info = await window.api.git.getBranchInfo(buildRepoPath(workDir, projectRepos[0]))
        setGitInfo(info)
      } catch {}
    }
    const interval = setInterval(refreshGit, 30_000)
    return () => clearInterval(interval)
  }, [hasLiveTerminal, projectRepos])

  // Load PR info when branch or repo changes
  useEffect(() => {
    if (branchInput && projectRepos.length > 0 && ghPat) {
      loadPr(projectRepos[0], branchInput)
    } else {
      setPrInfo(null)
    }
  }, [branchInput, projectRepos[0], ghPat])

  const handleOpenTerminal = async (repoName?: string) => {
    await openTerminal(80, 30, repoName)
  }

  if (!selectedIssue) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-950">
        <div className="text-center max-w-sm">
          <svg className="w-8 h-8 text-gray-700 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm text-gray-400 mt-4">No ticket selected</p>
          <p className="text-xs text-gray-500 mt-1.5">
            Pick one from the sidebar or press{' '}
            <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-gray-800 text-gray-300 text-[11px] font-mono border border-gray-700/50 ml-1">⌘K</kbd>
            {' '}to search
          </p>
        </div>
      </div>
    )
  }

  const issueProgress = progress[selectedIssue.id]
  const progressPercent = issueProgress?.percent || 0
  const priority = selectedIssue.priority

  const stateType = selectedIssue.state?.type || 'unstarted'
  const dotClass = STATE_DOT_COLOR[stateType] || 'bg-gray-500'

  const getStateBadge = (state: { name: string; color: string; type: string }) => (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        onClick={() => !statusLoading && setStatusDropdownOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-gray-900 border border-gray-800 text-xs text-gray-200 hover:border-gray-700 transition-colors disabled:opacity-60"
        title="Click to change status"
        disabled={updatingStatus}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <span style={{ minWidth: '4rem', display: 'inline-block' }}>
          {statusUpdated ? 'Updated ✓' : state.name}
        </span>
        {statusLoading
          ? <svg className="w-3 h-3 opacity-40 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 20l4-4m0 0a9 9 0 0112.7 0M20 4l-4 4m0 0a9 9 0 00-12.7 0" /></svg>
          : <svg className="w-3 h-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        }
      </button>
      {statusDropdownOpen && issueStates.length > 0 && (
        <div className="absolute left-0 top-full z-20 bg-gray-850 border border-gray-800 rounded-lg shadow-elev w-48 mt-1 overflow-hidden">
          {issueStates.map((s) => (
            <button key={s.id} onClick={() => handleStatusUpdate(s)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 transition-colors text-left"
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="bg-gray-950 flex flex-col h-full overflow-hidden">
      {isSyncing && <div className="h-0.5 bg-violet-500 animate-pulse flex-shrink-0" />}

      {/* Header */}
      <div className="px-8 pt-7 pb-5 border-b border-gray-800 flex-shrink-0">
        {/* Top row: identifier · project · parent · status · priority · assignee · labels · terminal buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-gray-500">{selectedIssue.identifier}</span>

          {selectedIssue.project && (
            <>
              <span className="text-gray-700 text-[11px]">·</span>
              <span className="text-[11px] text-gray-500">{selectedIssue.project.name}</span>
            </>
          )}

          {selectedIssue.parent && (
            <button
              onClick={() => selectedIssue.parent && selectIssue(selectedIssue.parent.id)}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-gray-900 border border-gray-800 text-xs text-gray-500 hover:text-violet-400 hover:border-violet-600/40 transition-colors"
              title={`Parent: ${selectedIssue.parent.title}`}
            >
              <span className="text-gray-600 text-[10px]">↑</span>
              <span className="font-mono text-[10px]">{selectedIssue.parent.identifier}</span>
            </button>
          )}

          <a href={selectedIssue.url} target="_blank" rel="noopener noreferrer"
            className="text-gray-600 hover:text-violet-400 transition-colors"
            title="View in Linear"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>

          <div className="flex items-center gap-2 ml-2">
            {getStateBadge(selectedIssue.state)}

            {priority > 0 && PRIORITY_LABELS[priority] && (
              <span className={`inline-flex items-center h-6 px-2 rounded-md border text-xs font-medium ${PRIORITY_COLORS[priority] || PRIORITY_COLORS[4]}`}>
                {PRIORITY_LABELS[priority]}
              </span>
            )}

            {selectedIssue.assignee && (
              <span className="flex items-center gap-1.5 text-xs text-gray-400">
                {selectedIssue.assignee.avatarUrl
                  ? <img src={selectedIssue.assignee.avatarUrl} className="w-5 h-5 rounded-full flex-shrink-0" alt="" />
                  : <span className="w-5 h-5 rounded-full bg-violet-700 flex items-center justify-center text-xs text-violet-200 font-medium flex-shrink-0">
                      {selectedIssue.assignee.name.charAt(0)}
                    </span>
                }
                @{selectedIssue.assignee.name}
              </span>
            )}

            {selectedIssue.labels && selectedIssue.labels.length > 0 && (
              <div className="flex items-center gap-1.5">
                {selectedIssue.labels.map((label) => (
                  <span key={label.id} className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: label.color }} title={label.name} />
                ))}
              </div>
            )}

            {/* Branch inline */}
            <div className="flex items-center gap-1.5 pl-2 ml-1 border-l border-gray-800">
              {branchEditing ? (
                <>
                  <input
                    type="text"
                    value={branchInput}
                    onChange={(e) => setBranchInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleBranchSave(); if (e.key === 'Escape') setBranchEditing(false) }}
                    autoFocus
                    placeholder="feature/my-branch"
                    className="bg-transparent border-b border-gray-800 focus:border-gray-600 text-[11px] font-mono text-gray-200 px-1 h-5 outline-none w-44"
                  />
                  <button onClick={handleBranchSave} className="text-[10px] text-violet-400 hover:text-violet-300">{branchSaved ? '✓' : 'save'}</button>
                  <button onClick={() => setBranchEditing(false)} className="text-[10px] text-gray-600 hover:text-gray-400">✕</button>
                </>
              ) : (
                <button onClick={() => setBranchEditing(true)} title="Click to edit branch"
                  className="text-[11px] font-mono text-gray-300 hover:text-gray-100 transition-colors"
                >
                  {branchInput || <span className="text-gray-600 italic">no branch</span>}
                </button>
              )}
              {branchInput && !branchEditing && (
                <button
                  onClick={() => { navigator.clipboard.writeText(branchInput); setBranchCopied(true); setTimeout(() => setBranchCopied(false), 1500) }}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                  title="Copy branch"
                >
                  {branchCopied
                    ? <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  }
                </button>
              )}
              {gitInfo && (
                <>
                  {gitInfo.aheadBy > 0 && <span className="text-[10px] font-mono text-emerald-400" title={`${gitInfo.aheadBy} ahead`}>↑{gitInfo.aheadBy}</span>}
                  {gitInfo.behindBy > 0 && <span className="text-[10px] font-mono text-orange-400" title={`${gitInfo.behindBy} behind`}>↓{gitInfo.behindBy}</span>}
                  {gitInfo.isDirty && <span className="text-[10px] font-mono text-gray-400" title="Uncommitted changes">● dirty</span>}
                </>
              )}
              {/* Create Branch button — only when no branch and PAT configured */}
              {ghPat && !branchInput && !branchEditing && projectRepos.length > 0 && (
                <button
                  onClick={handleCreateBranch}
                  disabled={createBranchLoading}
                  className="inline-flex items-center h-6 px-2 rounded-md bg-gray-900 border border-gray-800 text-[10px] text-gray-400 hover:border-violet-600/40 hover:text-violet-400 transition-colors disabled:opacity-50"
                >
                  {createBranchLoading ? '…' : '+ branch'}
                </button>
              )}
              {/* PR chip */}
              {ghPat && prLoading && (
                <span className="text-[10px] text-gray-600 font-mono">PR…</span>
              )}
              {ghPat && !prLoading && prInfo && (
                <button
                  onClick={() => window.open(prInfo.url, '_blank')}
                  title={prInfo.title}
                  className={`inline-flex items-center h-6 px-2 rounded-md border text-[10px] font-mono transition-colors ${
                    prInfo.mergedAt
                      ? 'bg-violet-500/10 border-violet-500/20 text-violet-300 hover:border-violet-400/40'
                      : prInfo.checks?.status === 'passing'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300 hover:border-emerald-400/40'
                      : prInfo.checks?.status === 'failing'
                      ? 'bg-red-500/10 border-red-500/20 text-red-300 hover:border-red-400/40'
                      : prInfo.checks?.status === 'pending'
                      ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300 hover:border-yellow-400/40'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                  }`}
                >
                  PR #{prInfo.number}
                  {prInfo.mergedAt ? ' ✓ merged' : prInfo.checks?.status === 'passing' ? ' ✓' : prInfo.checks?.status === 'failing' ? ' ✗' : prInfo.checks?.status === 'pending' ? ' ⋯' : ''}
                </button>
              )}
              {/* Create PR button — when branch exists, PAT configured, no PR found, has commits ahead */}
              {ghPat && branchInput && !branchEditing && !prInfo && !prLoading && projectRepos.length > 0 && gitInfo && gitInfo.aheadBy > 0 && (
                <button
                  onClick={handleOpenCreatePr}
                  className="inline-flex items-center h-6 px-2 rounded-md bg-violet-500/10 border border-violet-500/20 text-[10px] text-violet-300 hover:border-violet-400/40 transition-colors"
                >
                  Create PR
                </button>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {projectRepos.length > 1 ? (
              projectRepos.map((repo) => (
                <button key={repo} onClick={() => handleOpenTerminal(repo)}
                  className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors border ${
                    hasLiveTerminal
                      ? 'bg-surface border-border text-gray-400 hover:border-gray-700 hover:text-gray-200'
                      : 'bg-accent hover:bg-violet-500 border-transparent text-white shadow-soft'
                  }`}
                  title={`Open terminal in ${buildRepoPath(workDir, repo)}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {repo}
                </button>
              ))
            ) : projectRepos.length === 1 ? (
              <button onClick={() => handleOpenTerminal(projectRepos[0])}
                className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors ${
                  hasLiveTerminal
                    ? 'text-gray-400 hover:text-gray-200 hover:bg-surface px-2'
                    : 'bg-accent hover:bg-violet-500 text-white shadow-soft'
                }`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {projectRepos[0]}
              </button>
            ) : null}
          </div>
        </div>

        {/* Title + progress bar */}
        <div className="flex items-center gap-4 mt-3">
          <h2 className="text-2xl font-semibold text-gray-50 tracking-[-0.01em] leading-tight flex-1 min-w-0 truncate">
            {selectedIssue.title}
          </h2>
          <div className="flex items-center gap-2 w-[100px] flex-shrink-0">
            <div className="flex-1 h-0.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  progressPercent === 100 ? 'bg-emerald-500' : progressPercent > 0 ? 'bg-violet-500' : 'bg-gray-700'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-500 font-mono">{progressPercent}%</span>
          </div>
        </div>
      </div>

      {/* Two-column body */}
      <div className="flex-1 grid grid-cols-[3fr_2fr] overflow-hidden">
        {/* Left: ELI5 + description */}
        <div className="overflow-y-auto pl-8 pr-4 py-6 space-y-4">
          <ELI5Card
            ticketId={selectedIssue.id}
            title={selectedIssue.title}
            description={selectedIssue.description}
            issue={selectedIssue}
            repoPaths={projectRepos.map((r) => buildRepoPath(workDir, r))}
          />

          {selectedIssue.description ? (
            <div>
              <h3 className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-3">Description</h3>
              <div className="text-gray-300 text-sm leading-relaxed">
                <Markdown>{selectedIssue.description}</Markdown>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600 italic">No description provided.</p>
          )}

          <div className="border-t border-gray-800 pt-3 grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-medium">Created</span>
              <p className="text-gray-400 mt-0.5">{new Date(selectedIssue.createdAt).toLocaleDateString()}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-medium">Updated</span>
              <p className="text-gray-400 mt-0.5">{new Date(selectedIssue.updatedAt).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Right: switchable pane (notes / checklist / skills / diff / activity) */}
        <div className="overflow-y-auto pl-4 pr-8 py-6 border-l border-gray-800 flex flex-col min-h-0">
          <div className="flex items-center gap-1 mb-4 flex-shrink-0">
            {SECONDARY_TABS.map((t) => (
              <SecondaryTabPill
                key={t.id}
                active={secondaryTab === t.id}
                onClick={() => setSecondaryTab(t.id)}
                label={t.label}
                icon={t.icon}
              />
            ))}
          </div>
          <div className="flex-1 min-h-0">
            {secondaryTab === 'notes' && <InlineNotes ticketId={selectedIssue.id} />}
            {secondaryTab === 'checklist' && <ChecklistWidget ticketId={selectedIssue.id} />}
            {secondaryTab === 'skills' && <SkillsTab ticketId={selectedIssue.id} repos={projectRepos} />}
            {secondaryTab === 'diff' && (
              <DiffViewer ticketId={selectedIssue.id} projectRepos={projectRepos} />
            )}
            {secondaryTab === 'activity' && (
              <ActivityTimeline
                ticketId={selectedIssue.id}
                onSwitchToDiff={() => setSecondaryTab('diff')}
              />
            )}
          </div>
        </div>
      </div>

      {/* Create PR modal */}
      {showCreatePr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowCreatePr(false) }}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-pop w-[560px] max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
              <h3 className="text-sm font-semibold text-gray-100">Create Pull Request</h3>
              <button onClick={() => setShowCreatePr(false)} className="text-gray-500 hover:text-gray-300 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1.5">Title</label>
                <input
                  type="text"
                  value={prTitle}
                  onChange={e => setPrTitle(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg h-9 px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:border-gray-600 focus:ring-0 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1.5">
                  Body
                  {prBodyLoading && <span className="ml-2 text-gray-600">drafting…</span>}
                </label>
                <textarea
                  value={prBody}
                  onChange={e => setPrBody(e.target.value)}
                  rows={10}
                  placeholder={prBodyLoading ? 'Claude is drafting…' : 'PR description (Markdown)'}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-gray-600 focus:ring-0 outline-none transition-colors resize-none font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1.5">Base branch</label>
                <input
                  type="text"
                  value={prBase}
                  onChange={e => setPrBase(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg h-9 px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:border-gray-600 focus:ring-0 outline-none transition-colors font-mono"
                />
              </div>
              <div className="text-xs text-gray-600 font-mono">{branchInput} → {prBase}</div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-800 flex-shrink-0">
              <button onClick={() => setShowCreatePr(false)} className="h-9 px-4 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
              <button
                onClick={handleCreatePr}
                disabled={prCreating || !prTitle.trim()}
                className="h-9 px-5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors shadow-soft"
              >
                {prCreating ? 'Creating…' : 'Create PR'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SECONDARY_TABS: { id: SecondaryTab; label: string; icon: React.ReactNode }[] = [
  { id: 'notes',     label: 'Notes',     icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> },
  { id: 'checklist', label: 'Checklist', icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg> },
  { id: 'skills',    label: 'Skills',    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6L21 11l-5.5 2L13 19l-2.5-6L5 11l5.5-2L13 3z" /></svg> },
  { id: 'diff',      label: 'Diff',      icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m-12 5h12m-12 5h12M4 7h.01M4 12h.01M4 17h.01" /></svg> },
  { id: 'activity',  label: 'Activity',  icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
]

function SecondaryTabPill({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  const [hover, setHover] = useState(false)
  const expanded = active || hover
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={label}
      style={{ width: expanded ? 108 : 30 }}
      className={`relative flex items-center h-7 rounded-md overflow-hidden transition-[width,background-color,color] duration-200 ease-out-quart flex-shrink-0 ${
        active
          ? 'bg-violet-500/10 text-violet-300'
          : hover
          ? 'text-gray-100 bg-gray-850'
          : 'text-gray-500'
      }`}
    >
      <span className="flex items-center justify-center w-[30px] h-7 flex-shrink-0">{icon}</span>
      <span className={`text-[11px] font-medium whitespace-nowrap transition-opacity duration-150 ${expanded ? 'opacity-100' : 'opacity-0'}`}>{label}</span>
    </button>
  )
}
