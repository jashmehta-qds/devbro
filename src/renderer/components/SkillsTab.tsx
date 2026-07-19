import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAppStore } from '../store'
import type { Skill, SkillManifest, SkillApplication, TicketContext } from '../types'
import { useTerminal } from '../hooks/useTerminal'
import { useWorkDir, repoPath as buildRepoPath } from '../hooks/useWorkDir'
import { applySkillAndRoute } from '../lib/applySkill'

interface RepoSkill {
  name: string
  description?: string
  command: string
}

interface SkillsTabProps {
  ticketId: string
  repos?: string[]
}

type Scope = 'global' | 'project' | 'ticket'

interface Links {
  global: string[]
  project: string[]
  ticket: string[]
}

const SCOPE_META: Record<Scope, { icon: string; label: string; activeCls: string; inactiveCls: string; footerCls: string }> = {
  global: {
    icon: '🌍',
    label: 'Global',
    activeCls: 'bg-amber-500/10 text-amber-300 border-amber-500/40',
    inactiveCls: 'text-gray-500 border-gray-800 hover:text-amber-300 hover:border-amber-500/30',
    footerCls: 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20',
  },
  project: {
    icon: '📁',
    label: 'Project',
    activeCls: 'bg-violet-500/10 text-violet-300 border-violet-500/40',
    inactiveCls: 'text-gray-500 border-gray-800 hover:text-violet-300 hover:border-violet-500/30',
    footerCls: 'bg-violet-500/10 text-violet-300 border-violet-500/30 hover:bg-violet-500/20',
  },
  ticket: {
    icon: '🎯',
    label: 'Ticket',
    activeCls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40',
    inactiveCls: 'text-gray-500 border-gray-800 hover:text-emerald-300 hover:border-emerald-500/30',
    footerCls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20',
  },
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 172800) return 'Yesterday'
  return `${Math.floor(s / 86400)}d ago`
}

export function SkillsTab({ ticketId, repos = [] }: SkillsTabProps) {
  const { skills, setSkills, selectedIssue, openSkillsTab, ticketBranches } = useAppStore()
  const { runCommand } = useTerminal()
  const workDir = useWorkDir()
  const projectId = selectedIssue?.project?.id ?? null

  // Installed skills
  const [installedSkills, setInstalledSkills] = useState<SkillManifest[]>([])
  const [installedQuery, setInstalledQuery] = useState('')
  const [appliedRowSlug, setAppliedRowSlug] = useState<string | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<string | undefined>(repos[0])
  useEffect(() => { if (!selectedRepo || !repos.includes(selectedRepo)) setSelectedRepo(repos[0]) }, [repos, selectedRepo])

  // Links (global / project / ticket)
  const [links, setLinks] = useState<Links>({ global: [], project: [], ticket: [] })
  const linkedSets = useMemo(() => ({
    global: new Set(links.global),
    project: new Set(links.project),
    ticket: new Set(links.ticket),
  }), [links])

  // Batch selection
  const [checked, setChecked] = useState<Set<string>>(new Set())

  // History + repo playbook
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [history, setHistory] = useState<SkillApplication[]>([])
  const [repoSkills, setRepoSkills] = useState<Record<string, RepoSkill[]>>({})
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    repoPlaybook: true,
    quickCommands: true,
  })
  const toggleCollapse = (key: string) =>
    setCollapsedSections((p) => ({ ...p, [key]: !p[key] }))

  const [runningId, setRunningId] = useState<string | null>(null)
  const [sentSkillId, setSentSkillId] = useState<string | null>(null)

  // ---- loaders
  const loadInstalled = useCallback(async () => {
    try { setInstalledSkills(await window.api.skillPkg.list()) } catch {}
  }, [])
  useEffect(() => { loadInstalled() }, [loadInstalled])

  const loadLinks = useCallback(async () => {
    try {
      const l = await window.api.skillLinks.listForTicket(ticketId, projectId)
      setLinks(l)
    } catch {}
  }, [ticketId, projectId])
  useEffect(() => { loadLinks() }, [loadLinks])

  const loadHistory = useCallback(async () => {
    try { setHistory(await window.api.skillPkg.appliedHistory(ticketId)) } catch {}
  }, [ticketId])
  useEffect(() => { if (historyExpanded) loadHistory() }, [historyExpanded, loadHistory])

  // Legacy per-ticket commands (demoted to Quick commands)
  // ponytail: this UI is legacy — the underlying `skills` table can be dropped in a future migration
  const loadTicket = useCallback(async () => {
    try {
      const data = await window.api.skills.list(ticketId)
      setSkills(ticketId, data as Skill[])
    } catch {}
  }, [ticketId, setSkills])
  useEffect(() => { loadTicket() }, [loadTicket])
  const ticketSkills = skills[ticketId] || []

  useEffect(() => {
    if (repos.length === 0) { setRepoSkills({}); return }
    const load = async () => {
      const next: Record<string, RepoSkill[]> = {}
      await Promise.all(repos.map(async (r) => {
        try {
          const data = await window.api.skills.readRepo(buildRepoPath(workDir, r))
          next[r] = data as RepoSkill[]
        } catch {
          next[r] = []
        }
      }))
      setRepoSkills(next)
    }
    load()
  }, [repos.join(',')])

  // ---- apply
  const buildCtx = (): TicketContext => ({
    ticketId,
    issue: {
      identifier: selectedIssue?.identifier ?? '',
      title: selectedIssue?.title ?? '',
      description: selectedIssue?.description ?? undefined,
      branch: ticketBranches[ticketId],
    },
    repoPath: selectedRepo ? buildRepoPath(workDir, selectedRepo) : undefined,
  })

  const applyInstalled = async (slug: string) => {
    setAppliedRowSlug(slug)
    await applySkillAndRoute(slug, buildCtx(), runCommand)
    setTimeout(() => setAppliedRowSlug(null), 1500)
    if (historyExpanded) loadHistory()
  }

  const runLegacyCommand = async (id: string, command: string) => {
    setRunningId(id); setSentSkillId(id)
    try { await runCommand(command) }
    finally {
      setTimeout(() => { setRunningId(null); setSentSkillId(null) }, 1500)
    }
  }

  // ---- link mutations
  const linkCtx = { projectId: projectId ?? undefined, ticketId }

  const toggleBadge = async (slug: string, scope: Scope) => {
    if (scope === 'project' && !projectId) return
    const currentlyOn = linkedSets[scope].has(slug)
    // Optimistic
    setLinks(prev => {
      const next = { ...prev }
      const arr = new Set(next[scope])
      if (currentlyOn) arr.delete(slug); else arr.add(slug)
      next[scope] = Array.from(arr)
      return next
    })
    try {
      await window.api.skillLinks.setSingle(slug, scope, !currentlyOn, linkCtx)
    } catch {
      // fallback refetch on failure
      loadLinks()
    }
  }

  const batchAttach = async (scope: Scope) => {
    if (scope === 'project' && !projectId) return
    if (checked.size === 0) return
    const slugs = Array.from(checked)
    try {
      const res = await window.api.skillLinks.toggleBatch(slugs, scope, linkCtx)
      // Optimistic update using result
      setLinks(prev => {
        const next = { ...prev }
        const arr = new Set(next[scope])
        for (const s of res.attached || []) arr.add(s)
        for (const s of res.detached || []) arr.delete(s)
        next[scope] = Array.from(arr)
        return next
      })
    } catch {
      loadLinks()
    }
  }

  // ---- filtering + rendering
  const filteredInstalled = installedSkills.filter((s) => {
    const q = installedQuery.trim().toLowerCase()
    if (!q) return true
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
    )
  })

  const toggleCheck = (slug: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug); else next.add(slug)
      return next
    })
  }

  // Broader scopes cover narrower ones — hide narrower attach buttons if already
  // covered by a broader scope. Active (attached) pills always render.
  const shouldRenderBadge = (slug: string, scope: Scope): boolean => {
    const isOn = linkedSets[scope].has(slug)
    if (isOn) return true
    const atGlobal = linkedSets.global.has(slug)
    const atProject = linkedSets.project.has(slug)
    if (scope === 'ticket' && (atGlobal || atProject)) return false
    if (scope === 'project' && atGlobal) return false
    return true
  }

  const scopeBadge = (slug: string, scope: Scope) => {
    if (!shouldRenderBadge(slug, scope)) return null
    const meta = SCOPE_META[scope]
    const isOn = linkedSets[scope].has(slug)
    const disabled = scope === 'project' && !projectId
    return (
      <button
        key={scope}
        onClick={(e) => { e.stopPropagation(); if (!disabled) toggleBadge(slug, scope) }}
        disabled={disabled}
        className={`inline-flex items-center gap-1 h-5 px-1.5 rounded border text-[10px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          isOn ? meta.activeCls : meta.inactiveCls
        }`}
        title={disabled ? 'No project' : `${isOn ? 'Detach from' : 'Attach to'} ${meta.label}`}
      >
        <span>{meta.icon}</span>
        <span>{isOn ? `Attached · ${meta.label}` : meta.label}</span>
      </button>
    )
  }

  const previewStrip = (
    <div className="flex items-center gap-3 text-[11px] px-2 py-1.5 bg-gray-950 border border-gray-800 rounded-md">
      <span className="text-gray-500 uppercase tracking-wider text-[9px]">Session includes</span>
      {(['global', 'project', 'ticket'] as Scope[]).map(sc => {
        const meta = SCOPE_META[sc]
        const count = links[sc].length
        const dim = count === 0
        return (
          <span key={sc} className={dim ? 'text-gray-600' : 'text-gray-300'}>
            {meta.icon} {count} {sc}
          </span>
        )
      })}
    </div>
  )

  return (
    <div className="h-full flex flex-col relative">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Preview strip */}
        <section>{previewStrip}</section>

        {/* Repo selector when multi-repo (used by apply) */}
        {repos.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">repo</span>
            {repos.map((r) => (
              <button
                key={r}
                onClick={() => setSelectedRepo(r)}
                className={`inline-flex items-center h-5 px-2 rounded-md text-[10px] font-mono transition-colors border ${
                  selectedRepo === r
                    ? 'bg-violet-500/10 text-violet-300 border-violet-500/30'
                    : 'text-gray-400 border-gray-800 hover:border-gray-700 hover:text-gray-200'
                }`}
              >{r}</button>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={installedQuery}
            onChange={(e) => setInstalledQuery(e.target.value)}
            placeholder="Search installed skills…"
            className="flex-1 bg-gray-950 border border-gray-800 rounded-md h-8 px-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={loadInstalled}
            className="text-[11px] text-gray-500 hover:text-violet-400 transition-colors px-1.5"
            title="Refresh"
          >↻</button>
        </div>

        {/* Installed skill rows */}
        <section>
          {installedSkills.length === 0 ? (
            <div className="text-sm text-gray-500 py-4 text-center">
              No skills installed.{' '}
              <button onClick={() => openSkillsTab()} className="text-violet-400 hover:text-violet-300 transition-colors">
                Browse skills →
              </button>
            </div>
          ) : filteredInstalled.length === 0 ? (
            <div className="text-xs text-gray-600 italic py-2">No matches</div>
          ) : (
            <div className="space-y-1">
              {filteredInstalled.map((s) => {
                const isChecked = checked.has(s._slug)
                const isAttached = linkedSets.global.has(s._slug) || linkedSets.project.has(s._slug) || linkedSets.ticket.has(s._slug)
                return (
                  <div
                    key={s._slug}
                    onClick={() => toggleCheck(s._slug)}
                    className={`flex items-start gap-2 border border-gray-800 rounded-md px-2 py-2 cursor-pointer transition-colors ${
                      isChecked ? 'bg-gray-900 border-gray-700' : 'bg-gray-950 hover:bg-gray-900/60'
                    }`}
                  >
                    {/* Checkbox */}
                    <div
                      className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        isChecked ? 'bg-violet-500 border-violet-500' : 'border-gray-600'
                      }`}
                    >
                      {isChecked && <span className="text-[10px] text-white leading-none">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-100 truncate">{s.name}</div>
                      {s.description && (
                        <div className="text-[11px] text-gray-500 truncate">{s.description}</div>
                      )}
                      <div className="flex items-center gap-1 mt-1">
                        {(['global', 'project', 'ticket'] as Scope[]).map(sc => scopeBadge(s._slug, sc))}
                      </div>
                    </div>
                    {!isAttached && (
                      <button
                        onClick={(e) => { e.stopPropagation(); applyInstalled(s._slug) }}
                        className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 transition-colors flex-shrink-0"
                        title="Apply one-shot"
                      >
                        {appliedRowSlug === s._slug ? '✓' : '▶'} Apply
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Repo playbook (collapsed) */}
        {repos.length > 0 && (
          <section>
            <button
              onClick={() => toggleCollapse('repoPlaybook')}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-gray-500 font-medium hover:text-gray-300"
            >
              <span>{collapsedSections.repoPlaybook ? '▸' : '▾'}</span>
              Repo playbook
              <span className="text-gray-600 normal-case tracking-normal">— .devbro/skills.md</span>
            </button>
            {!collapsedSections.repoPlaybook && (
              <div className="mt-2 space-y-1">
                {repos.every(r => (repoSkills[r] ?? []).length === 0) ? (
                  <div className="text-xs text-gray-600 italic">No repo playbook.</div>
                ) : (
                  repos.flatMap((repo) =>
                    (repoSkills[repo] ?? []).map((s, i) => (
                      <div
                        key={`${repo}-${i}`}
                        className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-md px-2 py-1.5 group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-gray-200 truncate">{s.name}</div>
                          <div className="text-[10px] text-gray-500 font-mono truncate">{s.command}</div>
                        </div>
                        <button
                          onClick={() => runLegacyCommand(`repo-${repo}-${i}`, s.command)}
                          disabled={runningId === `repo-${repo}-${i}`}
                          className="inline-flex items-center h-5 px-1.5 rounded text-[10px] text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 transition-colors disabled:opacity-50"
                        >
                          {sentSkillId === `repo-${repo}-${i}` ? '✓' : '▶'}
                        </button>
                      </div>
                    ))
                  )
                )}
              </div>
            )}
          </section>
        )}

        {/* Recently applied (collapsed) */}
        <section>
          <button
            onClick={() => setHistoryExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-gray-500 font-medium hover:text-gray-300"
          >
            <span>{historyExpanded ? '▾' : '▸'}</span>
            Recently applied
          </button>
          {historyExpanded && (
            history.length === 0 ? (
              <div className="text-xs text-gray-600 italic mt-2">No history yet.</div>
            ) : (
              <div className="mt-2 space-y-1">
                {history.slice(0, 10).map((h) => (
                  <div
                    key={h.id}
                    onClick={() => applyInstalled(h.slug)}
                    className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-md px-2 py-1 cursor-pointer hover:border-violet-500/30 transition-colors"
                  >
                    <span className="font-mono text-[11px] text-gray-300 flex-1 truncate">{h.slug}</span>
                    <span className="text-[10px] text-gray-500">{relTime(h.applied_at)}</span>
                    <span className={h.outcome === 'ok' || h.outcome === 'success' ? 'text-green-400' : 'text-red-400'}>
                      {h.outcome === 'ok' || h.outcome === 'success' ? '✓' : '✗'}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
        </section>

        {/* Quick commands (legacy per-ticket) */}
        <section>
          <button
            onClick={() => toggleCollapse('quickCommands')}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-gray-500 font-medium hover:text-gray-300"
          >
            <span>{collapsedSections.quickCommands ? '▸' : '▾'}</span>
            Quick commands (legacy)
          </button>
          {!collapsedSections.quickCommands && (
            ticketSkills.length === 0 ? (
              <div className="text-xs text-gray-600 italic mt-2">No saved commands.</div>
            ) : (
              <div className="mt-2 space-y-1">
                {ticketSkills.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-md px-2 py-1 group">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-200 truncate">{s.name}</div>
                      <div className="text-[10px] text-gray-500 font-mono truncate">{s.command}</div>
                    </div>
                    <button
                      onClick={() => runLegacyCommand(s.id, s.command)}
                      disabled={runningId === s.id}
                      className="inline-flex items-center h-5 px-1.5 rounded text-[10px] text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 transition-colors disabled:opacity-50"
                    >
                      {sentSkillId === s.id ? '✓' : '▶'}
                    </button>
                    <button
                      onClick={async () => { try { await window.api.skills.delete(s.id); loadTicket() } catch {} }}
                      className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all text-xs"
                      title="Delete"
                    >✕</button>
                  </div>
                ))}
              </div>
            )
          )}
        </section>
      </div>

      {/* Sticky footer — batch attach */}
      {checked.size > 0 && (
        <div className="sticky bottom-0 bg-gray-900/95 backdrop-blur border-t border-gray-800 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{checked.size} selected</span>
            <button
              onClick={() => setChecked(new Set())}
              className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >clear</button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">Attach to</span>
            {(['global', 'project', 'ticket'] as Scope[]).map(sc => {
              const meta = SCOPE_META[sc]
              const disabled = sc === 'project' && !projectId
              const selectedSlugs = Array.from(checked)
              const covered = selectedSlugs.every((slug) => {
                if (sc === 'global') return linkedSets.global.has(slug)
                if (sc === 'project') return linkedSets.global.has(slug) || linkedSets.project.has(slug)
                return linkedSets.global.has(slug) || linkedSets.project.has(slug) || linkedSets.ticket.has(slug)
              })
              if (covered) return null
              return (
                <button
                  key={sc}
                  onClick={() => batchAttach(sc)}
                  disabled={disabled}
                  className={`inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${meta.footerCls}`}
                >
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
