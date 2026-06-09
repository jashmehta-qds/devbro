import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../store'
import type { ProjectDetails } from '../types'
import { Markdown } from './Markdown'

const STATE_TYPE_COLORS: Record<string, string> = {
  backlog: '#6B7280',
  unstarted: '#9CA3AF',
  started: '#3B82F6',
  completed: '#10B981',
  cancelled: '#6B7280',
}

const STATE_TYPE_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In Progress',
  completed: 'Done',
  cancelled: 'Cancelled',
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="w-6 h-6 rounded-full object-cover" />
  }
  return (
    <div className="w-6 h-6 rounded-full bg-indigo-700 flex items-center justify-center text-xs text-white font-medium flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

function relativeDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.round((d.getTime() - now.getTime()) / 86_400_000)
  if (Math.abs(diffDays) < 1) return 'today'
  if (diffDays < 0) return `${Math.abs(diffDays)}d ago`
  if (diffDays < 30) return `in ${diffDays}d`
  if (diffDays < 365) return `in ${Math.round(diffDays / 30)}mo`
  return d.toLocaleDateString()
}

function ReposSection({ projectId }: { projectId: string }) {
  const [repos, setRepos] = useState<Array<{ id: string; repo_name: string }>>([])
  const [allDirs, setAllDirs] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await window.api.projectRepos.list(projectId)
      setRepos(r)
      const all = await window.api.repos.list()
      const linked = new Set(r.map((x: any) => x.repo_name))
      setAllDirs((all as string[]).filter((d: string) => !linked.has(d)))
    } catch {}
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!selected) return
    setAdding(true)
    try {
      await window.api.projectRepos.add(projectId, selected)
      setSelected('')
      await load()
    } finally { setAdding(false) }
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Local Repos</p>
      {repos.length === 0 && (
        <p className="text-xs text-gray-600 italic mb-2">No repos linked — link a local folder to enable terminal context.</p>
      )}
      <div className="space-y-1 mb-2">
        {repos.map((r: any) => (
          <div key={r.id} className="flex items-center gap-2 text-xs bg-gray-800/60 rounded-lg px-3 py-1.5">
            <svg className="w-3 h-3 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="flex-1 font-mono text-gray-300">~/Work/{r.repo_name}</span>
            <button
              onClick={async () => { await window.api.projectRepos.remove(r.id); load() }}
              className="text-gray-700 hover:text-red-400 transition-colors"
              title="Remove"
            >✕</button>
          </div>
        ))}
      </div>
      {allDirs.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Select ~/Work/ folder…</option>
            {allDirs.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selected || adding}
            className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition-colors"
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}

export function ProjectView() {
  const { activeProjectId, projectDetails, setProjectDetails, setActiveProjectId, projects } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (activeProjectId) loadDetails(activeProjectId)
  }, [activeProjectId])

  const loadDetails = async (projectId: string) => {
    if (!projectDetails[projectId]) setLoading(true)
    try {
      const details = await window.api.project.getDetails(projectId)
      setProjectDetails(projectId, details)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    if (!activeProjectId) return
    setRefreshing(true)
    try {
      const details = await window.api.project.refreshDetails(activeProjectId)
      setProjectDetails(activeProjectId, details)
    } finally {
      setRefreshing(false)
    }
  }

  if (!activeProjectId) return null

  const details: ProjectDetails | undefined = projectDetails[activeProjectId]
  const project = projects.find((p) => p.id === activeProjectId)
  const displayName = details?.name ?? project?.name ?? activeProjectId

  const milestones = details?.milestones ?? []
  const members = details?.members ?? []
  const issueStateCounts = details?.issueStateCounts ?? {}
  const totalIssues = details?.totalIssues ?? 0

  const sortedMilestones = [...milestones].sort((a, b) => {
    if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate)
    if (a.targetDate) return -1
    if (b.targetDate) return 1
    return a.sortOrder - b.sortOrder
  })

  const progressPct = details ? Math.round((details.progress ?? 0) * 100) : 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveProjectId(null)}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project?.color ?? '#6366f1' }} />
          <h2 className="text-base font-semibold text-gray-100 flex-1 truncate">{displayName}</h2>
          <div className="flex items-center gap-2 flex-shrink-0">
            {details?.url && (
              <a
                href={details.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                View in Linear ↗
              </a>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
            >
              {refreshing ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {loading ? (
          <div className="space-y-4">
            {[80, 40, 100, 60].map((w, i) => (
              <div key={i} className={`h-10 bg-gray-800 rounded animate-pulse`} style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : details ? (
          <>
            {/* Meta strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">State</p>
                <p className="text-sm font-medium text-gray-200 capitalize">{details.state ?? '—'}</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Progress</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-sm font-medium text-gray-200">{progressPct}%</span>
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Target Date</p>
                <p className="text-sm font-medium text-gray-200">
                  {details.targetDate ? (
                    <span title={details.targetDate}>{relativeDate(details.targetDate)}</span>
                  ) : '—'}
                </p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Issues</p>
                <p className="text-sm font-medium text-gray-200">{totalIssues}</p>
              </div>
            </div>

            {/* Issue breakdown */}
            {totalIssues > 0 && Object.keys(issueStateCounts).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Issues by Status</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(issueStateCounts).map(([type, count]) => (
                    <div key={type} className="flex items-center gap-1.5 bg-gray-800 rounded-full px-3 py-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATE_TYPE_COLORS[type] ?? '#6B7280' }} />
                      <span className="text-xs text-gray-300">{STATE_TYPE_LABELS[type] ?? type}</span>
                      <span className="text-xs font-medium text-gray-100">{count}</span>
                    </div>
                  ))}
                </div>
                <div className="flex h-2 rounded-full overflow-hidden mt-3 gap-px">
                  {Object.entries(issueStateCounts).map(([type, count]) => (
                    <div
                      key={type}
                      className="transition-all"
                      style={{
                        width: `${(count / totalIssues) * 100}%`,
                        backgroundColor: STATE_TYPE_COLORS[type] ?? '#6B7280',
                      }}
                      title={`${STATE_TYPE_LABELS[type] ?? type}: ${count}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Lead + Members */}
            {(details.lead || members.length > 0) && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Team</h3>
                <div className="flex flex-wrap gap-3">
                  {details.lead && (
                    <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                      <Avatar name={details.lead.name} avatarUrl={details.lead.avatarUrl} />
                      <div>
                        <p className="text-xs font-medium text-gray-200">{details.lead.name}</p>
                        <p className="text-xs text-gray-500">Lead</p>
                      </div>
                    </div>
                  )}
                  {members
                    .filter((m) => m.id !== details.lead?.id)
                    .map((member) => (
                      <div key={member.id} className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                        <Avatar name={member.name} avatarUrl={member.avatarUrl} />
                        <div>
                          <p className="text-xs font-medium text-gray-200">{member.name}</p>
                          <p className="text-xs text-gray-500 truncate max-w-[140px]">{member.email}</p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Short summary */}
            {details.description && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Summary</h3>
                <Markdown>{details.description}</Markdown>
              </div>
            )}

            {/* Full body / document content */}
            {details.content && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Description</h3>
                <div className="bg-gray-800/40 rounded-lg p-4">
                  <Markdown>{details.content}</Markdown>
                </div>
              </div>
            )}

            {/* Milestones */}
            {!details.description && sortedMilestones.length === 0 && totalIssues === 0 && members.length === 0 && (
              <p className="text-sm text-gray-600 italic">No details available. Click Refresh to load from Linear.</p>
            )}

            {sortedMilestones.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Milestones ({sortedMilestones.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sortedMilestones.map((m) => (
                    <div key={m.id} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="flex items-start gap-2">
                        <span className="mt-1 w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-200">{m.name}</p>
                          {m.targetDate && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              Due {relativeDate(m.targetDate)}
                              <span className="ml-1 text-gray-600">({m.targetDate})</span>
                            </p>
                          )}
                          {m.description && (
                            <p className="text-sm text-gray-300 mt-2 leading-relaxed whitespace-pre-wrap">{m.description}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Repos */}
            <div className="border-t border-gray-800 pt-4">
              <ReposSection projectId={activeProjectId} />
            </div>

            {details.updatedAt && (
              <p className="text-xs text-gray-600">Last updated {relativeDate(details.updatedAt)}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600 italic">No details available. Try refreshing.</p>
        )}
      </div>
    </div>
  )
}
