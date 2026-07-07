import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useAppStore } from '../store'
import { useLinear } from '../hooks/useLinear'
import { ProgressDot } from './ProgressBar'
import { FilterPanel, loadFilters, saveFilters, activeFilterCount } from './FilterPanel'
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
      className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors disabled:opacity-50 ${
        state === 'done' ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-850'
      }`}
      title="Rebuild global context"
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
            d="M13 10V3L4 14h7v7l9-11h-7z" />
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
    expandedProjects,
    loading,
    isSyncing,
    error,
    progress,
    settingsOpen,
    openSettingsTab,
    dashboardOpen,
    openDashboardTab,
    helpOpen,
    openHelpTab,
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

  useEffect(() => {
    window.api.connector.getActive().then(({ id }) => setConnectorType(id)).catch(() => {})
  }, [])

  useEffect(() => {
    if (connectorType !== 'linear') return
    window.api.linear.getCycles().then(setCycles).catch(() => {})
  }, [connectorType])

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
      <div className="flex flex-col h-full bg-gray-950 border-r border-gray-800 items-center py-3 gap-1 overflow-hidden">
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-850 text-gray-600 hover:text-gray-300 transition-colors"
          title="Expand sidebar (⌘B)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="w-4 h-px bg-gray-800 my-1" />
        <button onClick={openDashboardTab} title="Analytics" className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${dashboardOpen ? 'text-violet-400 bg-violet-500/10' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-850'}`}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </button>
        <button onClick={() => setStandupOpen(!standupOpen)} title="Standup" className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${standupOpen ? 'text-violet-400 bg-violet-500/10' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-850'}`}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </button>
        <button onClick={openSettingsTab} title="Settings" className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${settingsOpen ? 'text-violet-400 bg-violet-500/10' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-850'}`}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 border-r border-gray-800">
      {/* Brand header */}
      <div className="px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-md bg-gradient-to-br from-violet-500 to-violet-700 flex-shrink-0" />
            <span className="text-sm font-semibold tracking-tight text-gray-100">devbro</span>
            {isSyncing && (
              <svg className="animate-spin h-3 w-3 text-violet-500 ml-0.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <RefreshContextButton />
            <button
              onClick={() => loadProjects(true)}
              disabled={loading}
              className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-gray-850 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
              title="Refresh issues"
            >
              <svg
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={() => setFilterPanelOpen(o => !o)}
              className={`relative flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                filterPanelOpen
                  ? 'bg-violet-500/10 text-violet-400'
                  : filterCount > 0
                  ? 'text-violet-400 hover:bg-gray-850'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-850'
              }`}
              title="Filters"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              {filterCount > 0 && !filterPanelOpen && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-violet-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold leading-none">
                  {filterCount}
                </span>
              )}
            </button>
            <button
              onClick={onToggleCollapse}
              className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-gray-850 text-gray-600 hover:text-gray-300 transition-colors"
              title="Collapse sidebar (⌘B)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
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
            {/* Search + filter chips */}
            <div className="px-4 pt-2 pb-2 flex-shrink-0 space-y-2">
              {/* Search input */}
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg h-9 pl-9 pr-14 text-sm text-gray-200 placeholder:text-gray-500 focus:border-gray-700 focus:ring-0 outline-none transition-colors"
                />
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors text-xs"
                  >✕</button>
                ) : (
                  <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-gray-600 bg-gray-850 border border-gray-800 rounded px-1 py-0.5 leading-none pointer-events-none">⌘K</kbd>
                )}
              </div>

              {/* Quick status chips */}
              <div className="flex items-center gap-1 flex-wrap">
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
                      className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-xs transition-colors ${
                        isExcluded
                          ? 'bg-red-500/10 border-red-500/30 text-red-300'
                          : isActive
                          ? 'bg-violet-500/10 border-violet-500/30 text-violet-300'
                          : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-700 hover:text-gray-100'
                      }`}
                    >
                      {isExcluded ? `✕ ${label}` : label}
                    </button>
                  )
                })}
              </div>

              {/* Active non-status filter chips */}
              {(filters.priorityFilter !== 'any' || filters.cycleFilter !== 'any' || filters.milestoneFilter !== 'any') && (
                <div className="flex items-center gap-1 flex-wrap">
                  {filters.priorityFilter !== 'any' && (
                    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs">
                      P: {['', 'Urgent', 'High', 'Med', 'Low'][Number(filters.priorityFilter)]}
                      <button onClick={() => setFilters({ ...filters, priorityFilter: 'any' })} className="hover:text-white leading-none">✕</button>
                    </span>
                  )}
                  {filters.cycleFilter !== 'any' && (
                    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs">
                      {filters.cycleFilter === 'current' ? 'Current cycle' : 'Next cycle'}
                      <button onClick={() => setFilters({ ...filters, cycleFilter: 'any' })} className="hover:text-white leading-none">✕</button>
                    </span>
                  )}
                  {filters.milestoneFilter !== 'any' && (
                    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs">
                      {allMilestones.find(m => m.id === filters.milestoneFilter)?.name ?? 'Milestone'}
                      <button onClick={() => setFilters({ ...filters, milestoneFilter: 'any' })} className="hover:text-white leading-none">✕</button>
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {error && (
                <div className="mx-3 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                  {error}
                </div>
              )}

              {/* Skeleton loaders */}
              {loading && projects.length === 0 && (
                <div className="py-1">
                  {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <div key={i} className="mx-2 my-1 h-7 rounded-md skeleton" />
                  ))}
                </div>
              )}

              <div className="pb-4">
                {filterProjects(projects).map((project, idx) => {
                  const isExpanded = expandedProjects.has(project.id)
                  const projectIssues = filterIssues(issues[project.id])
                  const allProjectIssues = issues[project.id] || []

                  return (
                    <div key={project.id}>
                      {/* Section divider between projects */}
                      {idx > 0 && (
                        <div className="border-t border-gray-800/80 mx-4 my-1" />
                      )}

                      {/* Project heading row */}
                      <button
                        onClick={() => handleProjectClick(project.id)}
                        className="w-full flex items-center gap-2 px-4 pt-4 pb-1.5 text-left group"
                      >
                        <span className="text-[10px] font-medium tracking-[0.14em] text-gray-500 uppercase flex-1 truncate">
                          {project.name}
                        </span>
                        <svg
                          className={`w-3 h-3 text-gray-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openProjectTab(project)
                          }}
                          className={`flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-all ${
                            activeProjectId === project.id
                              ? 'opacity-100 text-violet-400'
                              : 'opacity-0 group-hover:opacity-100 text-gray-600 hover:text-violet-400'
                          }`}
                          title="Open project details in tab"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </button>
                        {!isExpanded && allProjectIssues.length > 0 && (
                          <span className="text-[10px] font-mono text-gray-600 flex-shrink-0">
                            {allProjectIssues.length}
                          </span>
                        )}
                        {isExpanded && allProjectIssues.length > 0 && (
                          <span className="text-[10px] font-mono text-gray-600 flex-shrink-0">
                            {projectIssues.length}/{allProjectIssues.length}
                          </span>
                        )}
                      </button>

                      {/* Issues list */}
                      {isExpanded && (
                        <div>
                          {allProjectIssues.length === 0 && loading ? (
                            <div className="py-1">
                              {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="mx-2 my-1 h-7 rounded-md skeleton" />
                              ))}
                            </div>
                          ) : projectIssues.length === 0 ? (
                            <div className="mx-2 py-5 flex flex-col items-center text-center">
                              <svg className="w-6 h-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                              <p className="text-sm text-gray-400 mt-2">
                                {allProjectIssues.length > 0 ? 'No matches' : 'No issues'}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                {allProjectIssues.length > 0 ? 'Try changing filters' : 'Nothing here yet'}
                              </p>
                            </div>
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
                                  className={`w-full flex items-center gap-2.5 mx-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors duration-150 text-left ${
                                    isSelected
                                      ? 'bg-violet-500/10 text-gray-50'
                                      : 'text-gray-300 hover:bg-gray-900'
                                  }`}
                                  style={{ width: 'calc(100% - 1rem)' }}
                                >
                                  {/* Active indicator bar */}
                                  <span className={`w-0.5 h-4 rounded-full flex-shrink-0 ${isSelected ? 'bg-violet-500' : 'bg-transparent'}`} />
                                  {/* State dot */}
                                  <span
                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ background: stateColor }}
                                  />
                                  {/* Identifier */}
                                  <span className="text-[11px] font-mono text-gray-500 tracking-tight flex-shrink-0 w-14 truncate">
                                    {issue.identifier}
                                  </span>
                                  {/* Title */}
                                  <span className={`text-sm truncate flex-1 ${isSelected ? 'text-gray-50' : 'text-gray-200'}`}>
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
                  <div className="flex flex-col items-center text-center px-4 py-10">
                    <svg className="w-6 h-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <p className="text-sm text-gray-400 mt-2">No issues</p>
                    <p className="text-xs text-gray-500 mt-1">Connect a tracker in Settings</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer — expanding-label launcher */}
      <div className="border-t border-gray-800 flex-shrink-0 px-2 py-2 flex items-center gap-1">
        <LauncherPill
          active={dashboardOpen}
          onClick={openDashboardTab}
          label="Analytics"
          shortcut="⌘D"
          icon={
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 3v18h18M7 14l4-4 4 4 5-6" />
            </svg>
          }
        />
        <LauncherPill
          active={standupOpen}
          onClick={() => setStandupOpen(!standupOpen)}
          label="Standup"
          shortcut="⌘U"
          icon={
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 2v4M4.93 4.93l2.83 2.83M2 12h4M4.93 19.07l2.83-2.83M12 22v-4M19.07 19.07l-2.83-2.83M22 12h-4M19.07 4.93l-2.83 2.83" />
            </svg>
          }
        />
        <LauncherPill
          active={helpOpen}
          onClick={openHelpTab}
          label="Help"
          shortcut="⌘?"
          icon={
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <LauncherPill
          active={settingsOpen}
          onClick={openSettingsTab}
          label="Settings"
          shortcut="⌘,"
          icon={
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
      </div>
    </div>
  )
}

function LauncherPill({ active, onClick, label, shortcut, icon }: {
  active: boolean
  onClick: () => void
  label: string
  shortcut: string
  icon: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  const expanded = active || hover
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${label} · ${shortcut}`}
      style={{ width: expanded ? 128 : 32 }}
      className={`relative flex items-center h-8 rounded-lg overflow-hidden transition-[width,background-color,color] duration-200 ease-out-quart flex-shrink-0 ${
        active
          ? 'bg-violet-500/10 text-violet-300'
          : hover
          ? 'text-gray-100 bg-gray-850'
          : 'text-gray-500'
      }`}
    >
      <span className="flex items-center justify-center w-8 h-8 flex-shrink-0">{icon}</span>
      <span
        className={`text-[11px] font-medium whitespace-nowrap transition-opacity duration-150 ${expanded ? 'opacity-100' : 'opacity-0'}`}
      >{label}</span>
      <span
        className={`ml-auto pr-2 text-[10px] font-mono whitespace-nowrap transition-opacity duration-150 ${
          expanded ? (active ? 'opacity-70' : 'opacity-50') : 'opacity-0'
        }`}
      >{shortcut}</span>
    </button>
  )
}
