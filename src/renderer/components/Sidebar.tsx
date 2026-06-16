import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useAppStore } from '../store'
import { useLinear } from '../hooks/useLinear'
import { ProgressDot } from './ProgressBar'
import { FilterPanel, loadFilters, saveFilters, activeFilterCount, DEFAULT_FILTERS } from './FilterPanel'
import type { SidebarFilters } from './FilterPanel'
import type { LinearCycle } from '../types'

const STATE_COLORS: Record<string, string> = {
  backlog: '#6B7280',
  unstarted: '#9CA3AF',
  started: '#3B82F6',
  completed: '#10B981',
  cancelled: '#6B7280'
}

function RefreshContextButton() {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')

  const handleClick = useCallback(async () => {
    setState('loading')
    try {
      await window.api.context.refresh()
      setState('done')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('idle')
    }
  }, [])

  return (
    <button
      onClick={handleClick}
      disabled={state === 'loading'}
      className="flex items-center justify-center w-8 h-8 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 disabled:opacity-50 transition-colors"
      title="Rebuild ~/.dev-dashboard/global-context.md"
    >
      {state === 'loading' ? (
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ) : state === 'done' ? (
        <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      )}
    </button>
  )
}

export function Sidebar({ collapsed = false, onToggleCollapse }: { collapsed?: boolean; onToggleCollapse?: () => void }) {
  const {
    projects,
    issues,
    activeTabId,
    tabs,
    expandedProjects,
    loading,
    isSyncing,
    error,
    progress,
    settingsOpen,
    openSettingsTab,
    dashboardOpen,
    openDashboardTab,
    standupOpen,
    setStandupOpen,
    openTab,
    activeProjectId,
    openProjectTab,
    projectDetails,
    setProjectDetails,
  } = useAppStore()
  const { loadProjects, handleProjectClick } = useLinear()

  const [filters, setFiltersState] = useState<SidebarFilters>(loadFilters)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [connectorType, setConnectorType] = useState<string>('linear')
  const [cycles, setCycles] = useState<LinearCycle[]>([])

  function setFilters(f: SidebarFilters) {
    setFiltersState(f)
    saveFilters(f)
  }

  // Detect connector type once on mount
  useEffect(() => {
    window.api.connector.getActive().then(({ id }) => setConnectorType(id)).catch(() => {})
  }, [])

  // Load cycles when Linear is connected (once)
  useEffect(() => {
    if (connectorType !== 'linear') return
    window.api.linear.getCycles().then(setCycles).catch(() => {})
  }, [connectorType])

  // When filter panel opens, eagerly load project details for all expanded projects
  useEffect(() => {
    if (!filterPanelOpen || connectorType !== 'linear') return
    for (const projectId of expandedProjects) {
      if (!projectDetails[projectId]) {
        window.api.project.getDetails(projectId)
          .then(d => setProjectDetails(projectId, d))
          .catch(() => {})
      }
    }
  }, [filterPanelOpen, connectorType]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadProjects()
  }, [])

  const allMilestones = useMemo(() => {
    const result: Array<{ id: string; name: string; projectName?: string }> = []
    for (const details of Object.values(projectDetails)) {
      for (const m of details.milestones) {
        result.push({ id: m.id, name: m.name, projectName: details.name })
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [projectDetails])

  const currentCycleId = cycles.find(c => c.isCurrent)?.id
  const nextCycleId = cycles.find(c => c.isNext)?.id

  const filterIssues = (projectIssues: typeof issues[string]) => {
    const { statusFilter, priorityFilter, cycleFilter, milestoneFilter } = filters
    return (projectIssues || []).filter((issue) => {
      const statusOk =
        statusFilter === 'all' ? true
        : statusFilter === 'exclude-completed' ? issue.state.type !== 'completed'
        : issue.state.type === statusFilter

      const priorityOk = priorityFilter === 'any' || String(issue.priority) === priorityFilter

      const cycleOk =
        cycleFilter === 'any' ? true
        : cycleFilter === 'current' ? issue.cycleId != null && issue.cycleId === currentCycleId
        : cycleFilter === 'next' ? issue.cycleId != null && issue.cycleId === nextCycleId
        : true

      const milestoneOk =
        milestoneFilter === 'any' ? true
        : issue.milestoneId === milestoneFilter

      const q = searchQuery.trim().toLowerCase()
      const searchOk = !q || issue.identifier.toLowerCase().includes(q) || issue.title.toLowerCase().includes(q)

      return statusOk && priorityOk && cycleOk && milestoneOk && searchOk
    })
  }

  const filterProjects = (allProjects: typeof projects) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return allProjects
    return allProjects.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true
      const projectIssues = issues[p.id] || []
      return projectIssues.some(
        (i) => i.identifier.toLowerCase().includes(q) || i.title.toLowerCase().includes(q)
      )
    })
  }

  const selectedIssueId = activeTabId
  const filterCount = activeFilterCount(filters)

  // Collapsed icon rail
  if (collapsed) {
    return (
      <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800 items-center py-2 gap-1 overflow-hidden">
        {/* Expand button */}
        <button
          onClick={onToggleCollapse}
          className="w-9 h-9 flex items-center justify-center rounded hover:bg-gray-800 text-gray-600 hover:text-gray-300 transition-colors"
          title="Expand sidebar (⌘B)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="w-5 h-px bg-gray-800 my-1" />
        {/* Dashboard */}
        <button onClick={openDashboardTab} title="Analytics" className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${dashboardOpen ? 'text-indigo-400 bg-indigo-900/20' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-800'}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </button>
        {/* Standup */}
        <button onClick={() => setStandupOpen(!standupOpen)} title="Standup" className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${standupOpen ? 'text-indigo-400 bg-indigo-900/20' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-800'}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </button>
        {/* Settings */}
        <button onClick={openSettingsTab} title="Settings" className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${settingsOpen ? 'text-indigo-400 bg-indigo-900/20' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-800'}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
            <h1 className="text-sm font-bold text-gray-100 tracking-widest uppercase">devbro</h1>
          </div>
          <div className="flex items-center gap-1">
            {isSyncing && (
              <svg className="animate-spin h-3 w-3 text-indigo-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <button
              onClick={loadProjects}
              disabled={loading}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
              title="Refresh"
            >
              <svg
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            {/* Filter button */}
            <button
              onClick={() => setFilterPanelOpen(o => !o)}
              className={`relative flex items-center justify-center w-6 h-6 rounded transition-colors ${
                filterPanelOpen
                  ? 'bg-indigo-600/30 text-indigo-300'
                  : filterCount > 0
                  ? 'text-indigo-400 hover:bg-gray-800'
                  : 'text-gray-600 hover:text-gray-300 hover:bg-gray-800'
              }`}
              title="Filters"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              {filterCount > 0 && !filterPanelOpen && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-indigo-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold leading-none">
                  {filterCount}
                </span>
              )}
            </button>
            {/* Collapse button */}
            <button
              onClick={onToggleCollapse}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-800 text-gray-600 hover:text-gray-300 transition-colors"
              title="Collapse sidebar (⌘B)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Projects section — toggles between filter panel and issue list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {filterPanelOpen ? (
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            onClose={() => setFilterPanelOpen(false)}
            connectorType={connectorType}
            cycles={cycles}
            milestones={allMilestones}
          />
        ) : (
          <>
            <div className="px-3 pt-3 pb-1 flex-shrink-0">
              {/* Search input */}
              <div className="relative mb-2">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search projects & issues…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-md pl-6 pr-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-xs"
                  >✕</button>
                )}
              </div>

              {/* Quick status pills */}
              <div className="flex items-center gap-1 mb-1 flex-wrap">
                {([
                  ['all', 'All'],
                  ['started', 'Active'],
                  ['backlog', 'Backlog'],
                  ['completed', 'Done'],
                ] as ['all' | 'started' | 'backlog' | 'completed', string][]).map(([val, label]) => {
                  const isDone = val === 'completed'
                  const isExcluded = isDone && filters.statusFilter === 'exclude-completed'
                  const isActive = filters.statusFilter === val || isExcluded
                  const handleClick = () => {
                    if (isDone) {
                      const next = filters.statusFilter === 'completed' ? 'exclude-completed'
                        : filters.statusFilter === 'exclude-completed' ? 'all'
                        : 'completed'
                      setFilters({ ...filters, statusFilter: next })
                    } else {
                      setFilters({ ...filters, statusFilter: filters.statusFilter === val ? 'all' : val })
                    }
                  }
                  return (
                    <button
                      key={val}
                      onClick={handleClick}
                      className={`px-2 py-0.5 rounded-full text-xs transition-colors border ${
                        isExcluded
                          ? 'bg-red-900/40 text-red-300 border-red-700/60'
                          : isActive
                          ? 'bg-indigo-600/30 text-indigo-300 border-indigo-600/50'
                          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border-transparent'
                      }`}
                    >
                      {isExcluded ? `✕ ${label}` : label}
                    </button>
                  )
                })}
              </div>

              {/* Active non-status filter chips */}
              {(filters.priorityFilter !== 'any' || filters.cycleFilter !== 'any' || filters.milestoneFilter !== 'any') && (
                <div className="flex items-center gap-1 mb-1 flex-wrap">
                  {filters.priorityFilter !== 'any' && (
                    <span className="flex items-center gap-1 px-1.5 py-0 rounded bg-indigo-900/30 text-indigo-300 border border-indigo-800/50 text-[10px]">
                      P: {['', 'Urgent', 'High', 'Med', 'Low'][Number(filters.priorityFilter)]}
                      <button onClick={() => setFilters({ ...filters, priorityFilter: 'any' })} className="hover:text-white">✕</button>
                    </span>
                  )}
                  {filters.cycleFilter !== 'any' && (
                    <span className="flex items-center gap-1 px-1.5 py-0 rounded bg-indigo-900/30 text-indigo-300 border border-indigo-800/50 text-[10px]">
                      {filters.cycleFilter === 'current' ? 'Current cycle' : 'Next cycle'}
                      <button onClick={() => setFilters({ ...filters, cycleFilter: 'any' })} className="hover:text-white">✕</button>
                    </span>
                  )}
                  {filters.milestoneFilter !== 'any' && (
                    <span className="flex items-center gap-1 px-1.5 py-0 rounded bg-indigo-900/30 text-indigo-300 border border-indigo-800/50 text-[10px]">
                      {allMilestones.find(m => m.id === filters.milestoneFilter)?.name ?? 'Milestone'}
                      <button onClick={() => setFilters({ ...filters, milestoneFilter: 'any' })} className="hover:text-white">✕</button>
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {error && (
                <div className="mx-3 mb-3 p-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-400">
                  {error}
                </div>
              )}

              {/* Skeleton loaders */}
              {loading && projects.length === 0 && (
                <div className="px-3 space-y-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i}>
                      <div className="h-7 bg-gray-800 rounded animate-pulse mb-1" />
                      {i <= 2 && (
                        <div className="ml-4 space-y-1">
                          {[1, 2, 3].map((j) => (
                            <div key={j} className="h-5 bg-gray-800/60 rounded animate-pulse" />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="pb-4">
                {filterProjects(projects).map((project) => {
                  const isExpanded = expandedProjects.has(project.id)
                  const projectIssues = filterIssues(issues[project.id])
                  const allProjectIssues = issues[project.id] || []

                  return (
                    <div key={project.id}>
                      {/* Project row */}
                      <button
                        onClick={() => handleProjectClick(project.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-800 transition-colors group"
                      >
                        <span className="text-gray-600 text-xs w-3 flex-shrink-0">
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        <span className="flex-1 text-sm text-gray-200 truncate font-medium">
                          {project.name}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openProjectTab(project)
                          }}
                          className={`flex-shrink-0 text-xs px-1 transition-all ${
                            activeProjectId === project.id
                              ? 'opacity-100 text-indigo-400'
                              : 'opacity-0 group-hover:opacity-100 text-gray-600 hover:text-indigo-400'
                          }`}
                          title="Open project details in tab"
                        >
                          {'>>'}
                        </button>
                        {!isExpanded && allProjectIssues.length > 0 && (
                          <span className="text-xs bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded-full flex-shrink-0 leading-none">
                            {allProjectIssues.length}
                          </span>
                        )}
                        {isExpanded && allProjectIssues.length > 0 && (
                          <span className="text-xs text-gray-600 flex-shrink-0">
                            {projectIssues.length}/{allProjectIssues.length}
                          </span>
                        )}
                      </button>

                      {/* Issues list */}
                      {isExpanded && (
                        <div className="ml-4 border-l-2 border-indigo-900/60">
                          {allProjectIssues.length === 0 && loading ? (
                            <div className="px-3 space-y-1 py-1">
                              {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="h-5 bg-gray-800/60 rounded animate-pulse" />
                              ))}
                            </div>
                          ) : projectIssues.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-600 italic">
                              {allProjectIssues.length > 0 ? 'No issues match filters' : 'No issues'}
                            </p>
                          ) : (
                            projectIssues.map((issue) => {
                              const issueProgress = progress[issue.id]
                              const isSelected = selectedIssueId === issue.id
                              const stateColor = STATE_COLORS[issue.state.type] || '#6B7280'

                              return (
                                <button
                                  key={issue.id}
                                  onClick={() => openTab(issue)}
                                  title={issue.title}
                                  className={`w-full flex items-center gap-1.5 px-2 py-1 text-left transition-colors ${
                                    isSelected
                                      ? 'bg-indigo-900/30 border-l-2 border-indigo-500 -ml-0.5 pl-2.5'
                                      : 'hover:bg-gray-800/50'
                                  }`}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: stateColor }}
                                  />
                                  <span className="font-mono text-xs text-gray-600 flex-shrink-0 w-16 truncate">
                                    {issue.identifier}
                                  </span>
                                  <span
                                    className={`flex-1 text-xs truncate ${
                                      isSelected ? 'text-indigo-200 font-medium' : 'text-gray-300'
                                    }`}
                                  >
                                    {issue.title}
                                  </span>
                                  <ProgressDot percent={issueProgress?.percent || 0} />
                                </button>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {!loading && projects.length === 0 && !error && (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-gray-500">No projects found.</p>
                    <p className="text-xs text-gray-600 mt-1">Check your LINEAR_API_KEY and LINEAR_TEAM_ID</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom footer — two rows of icon buttons */}
      <div className="border-t border-gray-800 flex-shrink-0">
        {/* Row 1: Dashboard | Standup */}
        <div className="flex items-center border-b border-gray-800/60">
          <button
            onClick={openDashboardTab}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
              dashboardOpen
                ? 'text-indigo-400 bg-indigo-900/20'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
            title="Analytics Dashboard"
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span>Dashboard</span>
          </button>
          <div className="w-px h-5 bg-gray-800" />
          <button
            onClick={() => setStandupOpen(!standupOpen)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
              standupOpen
                ? 'text-indigo-400 bg-indigo-900/20'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
            title="Daily standup"
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span>Standup</span>
          </button>
        </div>
        {/* Row 2: Settings | Refresh context */}
        <div className="flex items-center">
          <button
            onClick={openSettingsTab}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors ${
              settingsOpen
                ? 'text-indigo-400 bg-indigo-900/20'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
            title="Project Settings"
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Settings</span>
          </button>
          <div className="w-px h-5 bg-gray-800" />
          <div className="flex-1 flex items-center justify-center gap-1 py-1.5">
            <RefreshContextButton />
            <span className="text-xs text-gray-600">context</span>
          </div>
        </div>
      </div>
    </div>
  )
}
