import React from 'react'
import type { LinearCycle } from '../types'

export type StatusFilter = 'all' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' | 'exclude-completed'
export type PriorityFilter = 'any' | '1' | '2' | '3' | '4'
export type CycleFilter = 'any' | 'current' | 'next'

export interface SidebarFilters {
  statusFilter: StatusFilter
  priorityFilter: PriorityFilter
  cycleFilter: CycleFilter
  milestoneFilter: string
}

export const DEFAULT_FILTERS: SidebarFilters = {
  statusFilter: 'all',
  priorityFilter: 'any',
  cycleFilter: 'any',
  milestoneFilter: 'any',
}

export function activeFilterCount(f: SidebarFilters): number {
  return [
    f.statusFilter !== 'all',
    f.priorityFilter !== 'any',
    f.cycleFilter !== 'any',
    f.milestoneFilter !== 'any',
  ].filter(Boolean).length
}

const FILTERS_KEY = 'dev-dashboard-filters'

export function loadFilters(): SidebarFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY)
    if (!raw) return { ...DEFAULT_FILTERS }
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_FILTERS }
  }
}

export function saveFilters(f: SidebarFilters) {
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify(f)) } catch {}
}

interface FilterPanelProps {
  filters: SidebarFilters
  onChange: (f: SidebarFilters) => void
  onClose: () => void
  connectorType: string
  cycles: LinearCycle[]
  milestones: Array<{ id: string; name: string; projectName?: string }>
}

function PillButton({
  active,
  danger,
  onClick,
  children,
}: {
  active: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-full text-xs transition-colors border ${
        danger
          ? 'bg-red-900/40 text-red-300 border-red-700/60'
          : active
          ? 'bg-violet-600/30 text-violet-300 border-violet-600/50'
          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border-transparent'
      }`}
    >
      {children}
    </button>
  )
}

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-xs font-medium text-gray-400">{title}</span>
        {badge && (
          <span className="text-[10px] px-1 py-0 rounded bg-violet-900/40 text-violet-400 border border-violet-800/50 leading-4">
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

export function FilterPanel({ filters, onChange, onClose, connectorType, cycles, milestones }: FilterPanelProps) {
  const isLinear = connectorType === 'linear'

  function set<K extends keyof SidebarFilters>(key: K, value: SidebarFilters[K]) {
    onChange({ ...filters, [key]: value })
  }

  function handleStatusClick(val: 'all' | 'started' | 'backlog' | 'completed') {
    if (val === 'completed') {
      if (filters.statusFilter === 'completed') set('statusFilter', 'exclude-completed')
      else if (filters.statusFilter === 'exclude-completed') set('statusFilter', 'all')
      else set('statusFilter', 'completed')
    } else {
      set('statusFilter', filters.statusFilter === val ? 'all' : val)
    }
  }

  const count = activeFilterCount(filters)

  const currentCycle = cycles.find(c => c.isCurrent)
  const nextCycle = cycles.find(c => c.isNext)

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-200 tracking-wider uppercase">Filters</span>
          {count > 0 && (
            <span className="text-[10px] bg-violet-600 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
              {count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {count > 0 && (
            <button
              onClick={() => onChange({ ...DEFAULT_FILTERS })}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Reset
            </button>
          )}
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-800 text-gray-600 hover:text-gray-300 transition-colors text-xs"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">

        {/* Status */}
        <Section title="Status">
          <div className="flex flex-wrap gap-1">
            <PillButton active={filters.statusFilter === 'all'} onClick={() => handleStatusClick('all')}>All</PillButton>
            <PillButton active={filters.statusFilter === 'started'} onClick={() => handleStatusClick('started')}>Active</PillButton>
            <PillButton active={filters.statusFilter === 'backlog'} onClick={() => handleStatusClick('backlog')}>Backlog</PillButton>
            <PillButton
              active={filters.statusFilter === 'completed' || filters.statusFilter === 'exclude-completed'}
              danger={filters.statusFilter === 'exclude-completed'}
              onClick={() => handleStatusClick('completed')}
            >
              {filters.statusFilter === 'exclude-completed' ? '✕ Done' : 'Done'}
            </PillButton>
          </div>
          {filters.statusFilter === 'exclude-completed' && (
            <p className="text-[10px] text-red-400/70 mt-1">Hiding completed issues</p>
          )}
        </Section>

        {/* Priority */}
        <Section title="Priority">
          <div className="flex flex-wrap gap-1">
            {([
              ['any', 'Any'],
              ['1', 'Urgent'],
              ['2', 'High'],
              ['3', 'Medium'],
              ['4', 'Low'],
            ] as [PriorityFilter, string][]).map(([val, label]) => (
              <PillButton
                key={val}
                active={filters.priorityFilter === val}
                onClick={() => set('priorityFilter', filters.priorityFilter === val ? 'any' : val)}
              >
                {label}
              </PillButton>
            ))}
          </div>
        </Section>

        {/* Linear-only filters */}
        {isLinear && (
          <>
            <div className="border-t border-gray-800/60 pt-3 space-y-4">
              <div className="flex items-center gap-1.5 -mt-1">
                <div className="flex-1 h-px bg-gray-800/60" />
                <span className="text-[10px] text-gray-600 uppercase tracking-wider px-1">Linear</span>
                <div className="flex-1 h-px bg-gray-800/60" />
              </div>

              {/* Cycle */}
              <Section title="Cycle" badge="Linear">
                {cycles.length === 0 ? (
                  <p className="text-xs text-gray-600 italic">No active cycles found</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    <PillButton active={filters.cycleFilter === 'any'} onClick={() => set('cycleFilter', 'any')}>
                      Any
                    </PillButton>
                    {currentCycle && (
                      <PillButton active={filters.cycleFilter === 'current'} onClick={() => set('cycleFilter', filters.cycleFilter === 'current' ? 'any' : 'current')}>
                        {currentCycle.name ? `Current · ${currentCycle.name}` : `Current · #${currentCycle.number}`}
                      </PillButton>
                    )}
                    {nextCycle && (
                      <PillButton active={filters.cycleFilter === 'next'} onClick={() => set('cycleFilter', filters.cycleFilter === 'next' ? 'any' : 'next')}>
                        {nextCycle.name ? `Next · ${nextCycle.name}` : `Next · #${nextCycle.number}`}
                      </PillButton>
                    )}
                  </div>
                )}
              </Section>

              {/* Milestone */}
              <Section title="Milestone" badge="Linear">
                {milestones.length === 0 ? (
                  <p className="text-xs text-gray-600 italic">Open a project to load milestones</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    <PillButton active={filters.milestoneFilter === 'any'} onClick={() => set('milestoneFilter', 'any')}>
                      Any milestone
                    </PillButton>
                    {milestones.map(m => (
                      <button
                        key={m.id}
                        onClick={() => set('milestoneFilter', filters.milestoneFilter === m.id ? 'any' : m.id)}
                        className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors text-left ${
                          filters.milestoneFilter === m.id
                            ? 'bg-violet-600/20 text-violet-300 border border-violet-600/40'
                            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200 border border-transparent'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${filters.milestoneFilter === m.id ? 'bg-violet-400' : 'bg-gray-600'}`} />
                        <span className="truncate">{m.name}</span>
                        {m.projectName && (
                          <span className="text-gray-600 text-[10px] truncate ml-auto flex-shrink-0">{m.projectName}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
