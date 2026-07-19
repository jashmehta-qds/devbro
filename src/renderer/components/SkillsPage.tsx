import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../store'
import { Markdown } from './Markdown'
import type { ApplyResult } from './SkillOutputModal'

// New skills IPC contract — coded against Agent 1's target surface.
// Cast through `any` so this file compiles independently of the older per-ticket
// `window.api.skills` shape currently in preload.
interface SkillManifest {
  _slug: string
  _dir: string
  name: string
  description: string
  type: 'prompt' | 'command'
  apply_to?: 'terminal' | 'claude_md'
  command?: string
  tags: string[]
  body: string
  installedFromRepo?: string
}
interface RegistryEntry {
  name: string
  description: string
  repo: string
  author?: string
  tags: string[]
  stars?: number
}
interface SkillsApi {
  list(): Promise<SkillManifest[]>
  install(gitUrl: string): Promise<{ ok: boolean; slug?: string; name?: string; error?: string }>
  uninstall(slug: string): Promise<{ ok: boolean }>
  update(slug: string): Promise<{ ok: boolean; changed?: boolean }>
  apply(slug: string, ctx: any): Promise<ApplyResult>
  discover(force?: boolean): Promise<{ ok: boolean; skills: RegistryEntry[]; error?: string }>
  getRegistryUrl(): Promise<string>
  setRegistryUrl(url: string): Promise<void>
  openFolder(slug: string): Promise<void>
  getBody(slug: string): Promise<string>
  appliedHistory(ticketId?: string, limit?: number): Promise<Array<{ id: string; slug: string; appliedAt: number; ticketId?: string; outcome: string }>>
}
const skillsApi = () => (window as any).api.skillPkg as SkillsApi

function normalizeRepo(url: string | undefined | null): string {
  if (!url) return ''
  return url
    .trim()
    .toLowerCase()
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
}

type Tab = 'installed' | 'discover' | 'guidelines'

export function SkillsPage() {
  const [tab, setTab] = useState<Tab>('installed')
  const [installed, setInstalled] = useState<SkillManifest[]>([])
  const [installedLoading, setInstalledLoading] = useState(false)
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const addNotification = useAppStore((s) => s.addNotification)
  const terminalSessionId = useAppStore((s) => s.terminalSessionId)
  const selectedIssue = useAppStore((s) => s.selectedIssue)
  const openSkillOutput = useAppStore((s) => s.openSkillOutput)

  const [installOpen, setInstallOpen] = useState(false)
  // Local modal for the non-streaming Apply results (command / claude_md).
  // Streaming (prompt-stream) is handled by the global SkillOutputModal via the store.
  const [inlineApply, setInlineApply] = useState<{ result: ApplyResult; skillName: string } | null>(null)

  const refreshInstalled = useCallback(async () => {
    setInstalledLoading(true)
    try {
      const list = await skillsApi().list()
      setInstalled(Array.isArray(list) ? list : [])
    } catch {
      setInstalled([])
    } finally {
      setInstalledLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshInstalled().catch(() => {})
  }, [refreshInstalled])

  async function handleApply(slug: string, skillName: string) {
    try {
      const ctx = selectedIssue
        ? {
            ticketId: selectedIssue.id,
            identifier: selectedIssue.identifier,
            title: selectedIssue.title,
            description: (selectedIssue as any).description ?? '',
          }
        : {}
      const result = await skillsApi().apply(slug, ctx)
      if (!result?.ok) {
        addNotification(`Apply failed: ${result?.error ?? 'unknown error'}`)
        return
      }
      if (result.kind === 'prompt-stream' && result.callId) {
        openSkillOutput({ callId: result.callId, slug })
      } else {
        setInlineApply({ result, skillName })
      }
    } catch (e: any) {
      addNotification(`Apply failed: ${e?.message ?? 'error'}`)
    }
  }

  return (
    <div className="bg-gray-950 min-h-full py-10 px-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-50 tracking-tight">Skills</h1>
            <p className="text-sm text-gray-500 mt-1">Prompt packs and command scripts that plug into every Claude session</p>
          </div>
          <button
            onClick={() => setInstallOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs font-medium hover:bg-violet-500/20 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Install from URL
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 mb-6">
          <TabPill active={tab === 'installed'} onClick={() => setTab('installed')} label="Installed" />
          <TabPill active={tab === 'discover'} onClick={() => setTab('discover')} label="Discover" />
          <TabPill active={tab === 'guidelines'} onClick={() => setTab('guidelines')} label="Guidelines" />
        </div>

        {tab === 'installed' ? (
          <InstalledTab
            list={installed}
            loading={installedLoading}
            onOpenInstall={() => setInstallOpen(true)}
            onApply={handleApply}
            onChanged={refreshInstalled}
          />
        ) : tab === 'discover' ? (
          <DiscoverTab installed={installed} onChanged={refreshInstalled} />
        ) : (
          <GuidelinesTab projects={projects} activeProjectId={activeProjectId} />
        )}
      </div>

      {installOpen && (
        <InstallFromUrlModal
          onClose={() => setInstallOpen(false)}
          onInstalled={() => {
            setInstallOpen(false)
            refreshInstalled().catch(() => {})
          }}
        />
      )}

      {inlineApply && (
        <InlineApplyModal
          result={inlineApply.result}
          skillName={inlineApply.skillName}
          terminalSessionId={terminalSessionId}
          onClose={() => setInlineApply(null)}
          onNotify={addNotification}
        />
      )}
    </div>
  )
}

// ============================================================================
// Inline modal for command / claude_md apply results (non-streaming)
// ============================================================================

function InlineApplyModal({
  result,
  skillName,
  terminalSessionId,
  onClose,
  onNotify,
}: {
  result: ApplyResult
  skillName: string
  terminalSessionId: string | null
  onClose: () => void
  onNotify: (msg: string) => void
}) {
  const isCommand = result.kind === 'command'
  const isMd = result.kind === 'claude_md'

  async function runInTerminal() {
    if (!terminalSessionId || !result.command) {
      onNotify('Start a terminal session first')
      return
    }
    try {
      await window.api.terminal.write(terminalSessionId, result.command + '\n')
      onNotify(`Sent to terminal: ${skillName}`)
      onClose()
    } catch (e: any) {
      onNotify(`Terminal write failed: ${e?.message ?? 'error'}`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-800 rounded-2xl shadow-pop max-w-3xl w-full mx-4 p-6"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-50">{skillName}</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">{isCommand ? 'Command ready to run' : isMd ? 'Skill added to CLAUDE.md' : 'Skill applied'}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xs">✕</button>
        </div>

        {isCommand && result.command && (
          <>
            <pre className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-3 text-xs text-gray-200 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">{result.command}</pre>
            <p className="text-[11px] text-gray-500 mt-2">This will be pasted into the active terminal.</p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => { navigator.clipboard.writeText(result.command!).catch(() => {}); onNotify('Copied') }}
                className="h-7 px-3 rounded-md border border-gray-800 hover:border-gray-700 text-gray-300 text-xs"
              >
                Copy
              </button>
              <button
                onClick={runInTerminal}
                disabled={!terminalSessionId}
                className="h-7 px-3 rounded-md bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium disabled:opacity-50"
                title={!terminalSessionId ? 'Start a terminal session first' : undefined}
              >
                Run in terminal
              </button>
            </div>
          </>
        )}

        {isMd && (
          <>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-3 text-xs text-emerald-200">
              Skill added to CLAUDE.md at{' '}
              <span className="font-mono text-emerald-100">{result.mdPath ?? '(unknown)'}</span>.
              <div className="text-emerald-300/70 mt-1">Next terminal launch will include it.</div>
            </div>
            <div className="flex items-center justify-end mt-4">
              <button onClick={onClose} className="h-7 px-4 rounded-md bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium">OK</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TabPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  const [hover, setHover] = useState(false)
  const expanded = active || hover
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ width: expanded ? 116 : 90 }}
      className={`relative flex items-center justify-center h-8 px-3 rounded-lg text-xs font-medium transition-[width,background-color,color] duration-200 ease-out-quart flex-shrink-0 ${
        active ? 'bg-violet-500/10 text-violet-300' : hover ? 'text-gray-100 bg-gray-850' : 'text-gray-500'
      }`}
    >
      {label}
    </button>
  )
}

// ============================================================================
// Installed tab
// ============================================================================

function InstalledTab({
  list,
  loading,
  onOpenInstall,
  onApply,
  onChanged,
}: {
  list: SkillManifest[]
  loading: boolean
  onOpenInstall: () => void
  onApply: (slug: string, name: string) => void
  onChanged: () => void
}) {
  const [q, setQ] = useState('')
  const addNotification = useAppStore((s) => s.addNotification)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return list
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.tags.some((t) => t.toLowerCase().includes(query)),
    )
  }, [list, q])

  if (loading && list.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 rounded-xl skeleton" />
        ))}
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center shadow-soft">
        <p className="text-sm text-gray-300">No skills installed yet</p>
        <p className="text-xs text-gray-500 mt-1">Head to Discover, or paste a git URL below</p>
        <button
          onClick={onOpenInstall}
          className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium transition-colors"
        >
          Install from URL
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search installed skills…"
            className="w-full bg-gray-900 border border-gray-800 rounded-lg h-9 pl-9 pr-3 text-sm text-gray-200 placeholder:text-gray-500 focus:border-gray-700 focus:ring-0 outline-none transition-colors"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {filtered.map((s) => (
          <SkillCard key={s._slug} skill={s} onApply={() => onApply(s._slug, s.name)} onChanged={onChanged} onNotify={addNotification} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 text-center text-xs text-gray-500 py-8">No matches</div>
        )}
      </div>
    </div>
  )
}

function SkillCard({
  skill,
  onApply,
  onChanged,
  onNotify,
}: {
  skill: SkillManifest
  onApply: () => void
  onChanged: () => void
  onNotify: (msg: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleUpdate() {
    setBusy(true); setMenuOpen(false)
    try {
      const r = await skillsApi().update(skill._slug)
      onNotify(r?.ok ? (r.changed ? `Updated ${skill.name}` : `${skill.name} already up to date`) : `Update failed`)
      if (r?.ok && r.changed) onChanged()
    } catch (e: any) {
      onNotify(`Update failed: ${e?.message ?? 'error'}`)
    } finally { setBusy(false) }
  }
  async function handleUninstall() {
    setMenuOpen(false)
    if (!confirm(`Uninstall ${skill.name}?`)) return
    setBusy(true)
    try {
      const r = await skillsApi().uninstall(skill._slug)
      if (r?.ok) { onNotify(`Uninstalled ${skill.name}`); onChanged() }
      else onNotify(`Uninstall failed`)
    } finally { setBusy(false) }
  }
  async function handleOpenFolder() {
    setMenuOpen(false)
    try { await skillsApi().openFolder(skill._slug) } catch { /* ignore */ }
  }
  async function handleViewBody() {
    setMenuOpen(false)
    try {
      const body = await skillsApi().getBody(skill._slug)
      // Simple view — open a blob in a new window
      const blob = new Blob([body], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch { onNotify('Could not load SKILL.md') }
  }

  const typeChip =
    skill.type === 'prompt'
      ? 'bg-violet-500/10 text-violet-300 border-violet-500/20'
      : 'bg-amber-500/10 text-amber-300 border-amber-500/20'

  return (
    <div className="relative bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-soft hover:border-gray-700 transition-colors">
      <div className="flex items-start gap-2">
        <h3 className="text-sm font-semibold text-gray-100 flex-1 truncate">{skill.name}</h3>
        <span className={`text-[10px] font-mono px-1.5 h-4 rounded border ${typeChip} flex items-center`}>
          {skill.type}
        </span>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-850 text-gray-500 hover:text-gray-300 transition-colors"
            title="More"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-10 w-40 bg-gray-900 border border-gray-800 rounded-lg shadow-pop py-1 text-xs">
              <MenuItem onClick={handleUpdate}>Update</MenuItem>
              <MenuItem onClick={handleOpenFolder}>Open folder</MenuItem>
              <MenuItem onClick={handleViewBody}>View SKILL.md</MenuItem>
              <div className="border-t border-gray-800 my-1" />
              <MenuItem onClick={handleUninstall} danger>Uninstall</MenuItem>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-2 leading-relaxed line-clamp-3">{skill.description}</p>

      {skill.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-3">
          {skill.tags.slice(0, 6).map((t) => (
            <span key={t} className="h-4 px-1.5 rounded bg-gray-850 border border-gray-800 text-[9px] font-mono text-gray-500 flex items-center">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <button
          onClick={onApply}
          disabled={busy}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium transition-colors disabled:opacity-50"
        >
          Apply
        </button>
        {skill.installedFromRepo && (
          <a
            href={skill.installedFromRepo}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-mono text-gray-600 hover:text-gray-400 truncate max-w-[180px]"
            title={skill.installedFromRepo}
          >
            {shortRepo(skill.installedFromRepo)}
          </a>
        )}
      </div>
    </div>
  )
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-gray-850 transition-colors ${danger ? 'text-red-400' : 'text-gray-300'}`}
    >
      {children}
    </button>
  )
}

function shortRepo(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '')
}

// ============================================================================
// Discover tab
// ============================================================================

type SortKey = 'popular' | 'az' | 'recent'

function DiscoverTab({ installed, onChanged }: { installed: SkillManifest[]; onChanged: () => void }) {
  const [entries, setEntries] = useState<RegistryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortKey>('popular')
  const [registryUrl, setRegistryUrl] = useState<string>('')
  const [registryEditOpen, setRegistryEditOpen] = useState(false)
  const [registryDraft, setRegistryDraft] = useState('')
  const addNotification = useAppStore((s) => s.addNotification)

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null)
    try {
      const r = await skillsApi().discover(force)
      if (r?.ok) setEntries(r.skills || [])
      else { setError(r?.error ?? 'Failed to load registry'); setEntries([]) }
    } catch (e: any) {
      setError(e?.message ?? 'Network error')
      setEntries([])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load(false).catch(() => {})
    skillsApi().getRegistryUrl().then(setRegistryUrl).catch(() => {})
  }, [load])

  const installedRepos = useMemo(() => {
    const set = new Set<string>()
    for (const s of installed) {
      if (s.installedFromRepo) set.add(normalizeRepo(s.installedFromRepo))
    }
    return set
  }, [installed])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) for (const t of e.tags || []) set.add(t)
    return [...set].sort()
  }, [entries])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    let out = entries.filter((e) => {
      if (selectedTags.size > 0 && !e.tags.some((t) => selectedTags.has(t))) return false
      if (!query) return true
      return (
        e.name.toLowerCase().includes(query) ||
        e.description.toLowerCase().includes(query) ||
        e.tags.some((t) => t.toLowerCase().includes(query))
      )
    })
    if (sort === 'popular') out = [...out].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
    else if (sort === 'az') out = [...out].sort((a, b) => a.name.localeCompare(b.name))
    else out = [...out].sort((a, b) => a.name.localeCompare(b.name))
    return out
  }, [entries, q, selectedTags, sort])

  function toggleTag(t: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  async function saveRegistry() {
    try {
      await skillsApi().setRegistryUrl(registryDraft.trim())
      setRegistryUrl(registryDraft.trim())
      setRegistryEditOpen(false)
      load(true).catch(() => {})
    } catch (e: any) {
      addNotification(`Registry update failed: ${e?.message ?? 'error'}`)
    }
  }

  async function handleInstall(repo: string, name: string) {
    try {
      const r = await skillsApi().install(repo)
      if (r?.ok) { addNotification(`Installed ${r.name ?? name}`); onChanged() }
      else addNotification(`Install failed: ${r?.error ?? 'unknown'}`)
    } catch (e: any) {
      addNotification(`Install failed: ${e?.message ?? 'error'}`)
    }
  }

  async function handleUpdate(slugOrRepo: string, name: string) {
    // Find installed slug matching this repo
    const match = installed.find((s) => normalizeRepo(s.installedFromRepo) === normalizeRepo(slugOrRepo))
    if (!match) return
    try {
      const r = await skillsApi().update(match._slug)
      addNotification(r?.ok ? (r.changed ? `Updated ${name}` : `${name} up to date`) : `Update failed`)
      if (r?.ok && r.changed) onChanged()
    } catch (e: any) {
      addNotification(`Update failed: ${e?.message ?? 'error'}`)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the registry…"
            className="w-full bg-gray-900 border border-gray-800 rounded-lg h-9 pl-9 pr-3 text-sm text-gray-200 placeholder:text-gray-500 focus:border-gray-700 focus:ring-0 outline-none transition-colors"
          />
        </div>
        <button
          onClick={() => { setRegistryDraft(registryUrl); setRegistryEditOpen((o) => !o) }}
          className="flex items-center justify-center w-9 h-9 rounded-lg border border-gray-800 bg-gray-900 hover:border-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
          title="Custom registry"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {registryEditOpen && (
        <div className="mb-4 bg-gray-900 border border-gray-800 rounded-lg p-3 flex items-center gap-2">
          <input
            value={registryDraft}
            onChange={(e) => setRegistryDraft(e.target.value)}
            placeholder="https://example.com/registry.json"
            className="flex-1 bg-gray-950 border border-gray-800 rounded-md h-8 px-2 text-xs text-gray-200 outline-none focus:border-gray-700"
          />
          <button onClick={saveRegistry} className="h-8 px-3 rounded-md bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium">Save</button>
          <button onClick={() => setRegistryEditOpen(false)} className="h-8 px-3 rounded-md text-gray-400 hover:text-gray-200 text-xs">Cancel</button>
        </div>
      )}

      <div className="flex gap-6">
        {/* Left rail */}
        <aside className="w-44 flex-shrink-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-2">Tags</div>
          <div className="flex flex-col gap-1 mb-6">
            {allTags.length === 0 && <div className="text-[11px] text-gray-600">—</div>}
            {allTags.map((t) => {
              const active = selectedTags.has(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={`text-[11px] h-6 px-2 rounded-md text-left transition-colors ${
                    active
                      ? 'bg-violet-500/10 text-violet-300 border border-violet-500/30'
                      : 'text-gray-400 hover:bg-gray-850 border border-transparent'
                  }`}
                >
                  {t}
                </button>
              )
            })}
          </div>

          <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-2">Sort</div>
          <div className="flex flex-col gap-1">
            {(['popular', 'az', 'recent'] as SortKey[]).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`text-[11px] h-6 px-2 rounded-md text-left transition-colors ${
                  sort === s ? 'bg-gray-850 text-gray-100' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {s === 'popular' ? 'Popular' : s === 'az' ? 'A → Z' : 'Recent'}
              </button>
            ))}
          </div>
        </aside>

        {/* Right grid */}
        <div className="flex-1 min-w-0">
          {loading && (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 rounded-xl skeleton" />)}
            </div>
          )}
          {!loading && error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-xs text-red-300">
              <div className="font-medium mb-1">Could not load registry</div>
              <div className="text-red-400/80 mb-2">{error}</div>
              <div className="text-[11px] text-gray-500 font-mono mb-3">{registryUrl || '(no registry configured)'}</div>
              <button onClick={() => load(true)} className="h-7 px-3 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-medium">Retry</button>
            </div>
          )}
          {!loading && !error && (
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((e) => {
                const isInstalled = installedRepos.has(normalizeRepo(e.repo))
                return (
                  <RegistryCard
                    key={e.repo}
                    entry={e}
                    installed={isInstalled}
                    onInstall={() => handleInstall(e.repo, e.name)}
                    onUpdate={() => handleUpdate(e.repo, e.name)}
                  />
                )
              })}
              {filtered.length === 0 && (
                <div className="col-span-2 text-center text-xs text-gray-500 py-8">No matches</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RegistryCard({
  entry,
  installed,
  onInstall,
  onUpdate,
}: {
  entry: RegistryEntry
  installed: boolean
  onInstall: () => void
  onUpdate: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function click(fn: () => Promise<void> | void) {
    setBusy(true); try { await fn() } finally { setBusy(false) }
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-soft hover:border-gray-700 transition-colors">
      <div className="flex items-start gap-2">
        <h3 className="text-sm font-semibold text-gray-100 flex-1 truncate">{entry.name}</h3>
        {typeof entry.stars === 'number' && (
          <span className="text-[10px] font-mono text-gray-500 flex items-center gap-0.5">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.966a1 1 0 00.95.69h4.169c.969 0 1.371 1.24.588 1.81l-3.372 2.45a1 1 0 00-.363 1.118l1.287 3.966c.3.921-.755 1.688-1.54 1.118l-3.371-2.45a1 1 0 00-1.176 0l-3.371 2.45c-.784.57-1.838-.197-1.539-1.118l1.287-3.966a1 1 0 00-.364-1.118l-3.37-2.45c-.784-.57-.38-1.81.588-1.81h4.168a1 1 0 00.951-.69l1.286-3.966z" />
            </svg>
            {entry.stars}
          </span>
        )}
      </div>
      {entry.author && <div className="text-[11px] text-gray-500 mt-0.5 font-mono">{entry.author}</div>}
      <p className="text-xs text-gray-400 mt-2 leading-relaxed line-clamp-3">{entry.description}</p>
      {entry.tags?.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-3">
          {entry.tags.slice(0, 6).map((t) => (
            <span key={t} className="h-4 px-1.5 rounded bg-gray-850 border border-gray-800 text-[9px] font-mono text-gray-500 flex items-center">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mt-4 gap-2">
        {installed ? (
          <>
            <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-medium">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Installed
            </span>
            <button
              onClick={() => click(onUpdate)}
              disabled={busy}
              className="h-7 px-3 rounded-md border border-gray-800 hover:border-gray-700 text-gray-300 text-xs transition-colors disabled:opacity-50"
            >
              {busy ? '…' : 'Update'}
            </button>
          </>
        ) : (
          <button
            onClick={() => click(onInstall)}
            disabled={busy}
            className="h-7 px-3 rounded-md bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Cloning…' : 'Install'}
          </button>
        )}
        <a
          href={entry.repo}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] font-mono text-gray-600 hover:text-gray-400 truncate max-w-[140px] ml-auto"
          title={entry.repo}
        >
          {shortRepo(entry.repo)}
        </a>
      </div>
    </div>
  )
}

// ============================================================================
// Install from URL modal
// ============================================================================

function InstallFromUrlModal({ onClose, onInstalled }: { onClose: () => void; onInstalled: () => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const addNotification = useAppStore((s) => s.addNotification)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true); setError(null)
    try {
      const r = await skillsApi().install(url.trim())
      if (r?.ok) {
        addNotification(`Installed ${r.name ?? r.slug ?? 'skill'}`)
        onInstalled()
      } else {
        setError(r?.error ?? 'Install failed')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Install failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-800 rounded-2xl shadow-pop max-w-lg w-full mx-4 p-6"
      >
        <h2 className="text-base font-semibold text-gray-50">Install skill from URL</h2>
        <p className="text-xs text-gray-500 mt-1">Paste a git URL — a shallow clone runs locally.</p>

        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/skill-name"
          className="w-full mt-4 bg-gray-950 border border-gray-800 rounded-lg h-10 px-3 text-sm text-gray-200 placeholder:text-gray-500 focus:border-gray-700 focus:ring-0 outline-none transition-colors"
        />

        {error && <div className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{error}</div>}

        <div className="flex items-center gap-2 mt-4">
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="h-8 px-4 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy && (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {busy ? 'Cloning…' : 'Install'}
          </button>
          <button type="button" onClick={onClose} className="h-8 px-4 rounded-lg text-gray-400 hover:text-gray-200 text-xs">Cancel</button>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-800 flex items-start gap-2">
          <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12.25a2 2 0 00-3.48 0L3.19 16a2 2 0 001.74 3z" />
          </svg>
          <p className="text-[11px] text-amber-300/80 leading-relaxed">
            Skills run with your shell privileges. Only install skills you trust.
          </p>
        </div>
      </form>
    </div>
  )
}

// ============================================================================
// Guidelines tab — per-scope (global/project) markdown editing
// ============================================================================

interface GuidelineRow {
  id: string
  name: string
  command: string
  created_at: number
}

function GuidelinesTab({
  projects,
  activeProjectId,
}: {
  projects: any[]
  activeProjectId: string | null
}) {
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    activeProjectId && projects.length > 0 ? activeProjectId : projects.length > 0 ? projects[0].id : null
  )

  const [guidelineRows, setGuidelineRows] = useState<GuidelineRow[]>([])
  const [body, setBody] = useState('')
  const [lastSaved, setLastSaved] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load guidelines for the current scope
  const loadGuidelines = useCallback(async () => {
    setLoading(true)
    try {
      let rows: GuidelineRow[] = []
      if (scope === 'global') {
        rows = await (window.api.globalSkills.list() as Promise<GuidelineRow[]>)
      } else if (scope === 'project' && selectedProjectId) {
        rows = await (window.api.projectSkills.list(selectedProjectId) as Promise<GuidelineRow[]>)
      }

      // ponytail: multi-row fallback (v0 shortcut; proper library deferred)
      // If multiple rows exist, use first and show warning
      let row = rows.find((r) => r.name === 'default') ?? rows[0]
      if (rows.length > 1 && !rows.find((r) => r.name === 'default')) {
        // Multiple legacy entries; show note
        row = rows[0]
      }

      setGuidelineRows(rows)
      setBody(row?.command ?? '')
      setIsDirty(false)
      setLastSaved(row?.created_at ?? null)
    } catch (err) {
      console.error('Failed to load guidelines:', err)
    } finally {
      setLoading(false)
    }
  }, [scope, selectedProjectId])

  useEffect(() => {
    loadGuidelines()
  }, [loadGuidelines])

  const handleBodyChange = (newBody: string) => {
    setBody(newBody)
    setIsDirty(true)
  }

  const saveGuideline = useCallback(async () => {
    if (!body.trim()) return
    try {
      const existingDefault = guidelineRows.find((r) => r.name === 'default')
      const targetRow = existingDefault ?? guidelineRows[0]

      if (targetRow) {
        // Update existing
        if (scope === 'global') {
          await window.api.globalSkills.update(targetRow.id, 'default', body.trim())
        } else if (scope === 'project' && selectedProjectId) {
          await window.api.projectSkills.update(targetRow.id, 'default', body.trim())
        }
      } else {
        // Create new
        if (scope === 'global') {
          await window.api.globalSkills.add('default', body.trim())
        } else if (scope === 'project' && selectedProjectId) {
          await window.api.projectSkills.add(selectedProjectId, 'default', body.trim())
        }
      }

      setLastSaved(Date.now())
      setIsDirty(false)
      await loadGuidelines()
    } catch (err) {
      console.error('Failed to save guideline:', err)
    }
  }, [body, scope, selectedProjectId, guidelineRows, loadGuidelines])

  const handleReset = async () => {
    if (isDirty && !confirm('Discard unsaved changes?')) return
    await loadGuidelines()
  }

  const handleBlur = () => {
    if (isDirty) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        saveGuideline()
      }, 500)
    }
  }

  const hasMultipleRows = guidelineRows.length > 1

  return (
    <div className="space-y-4">
      {/* Scope & project selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 h-8">
          <button
            onClick={() => setScope('global')}
            className={`px-3 h-full rounded-lg text-xs font-medium transition-colors ${
              scope === 'global'
                ? 'bg-violet-500/10 text-violet-300 border border-violet-500/30'
                : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-300'
            }`}
          >
            Global
          </button>
          <button
            onClick={() => setScope('project')}
            className={`px-3 h-full rounded-lg text-xs font-medium transition-colors ${
              scope === 'project'
                ? 'bg-violet-500/10 text-violet-300 border border-violet-500/30'
                : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-300'
            }`}
          >
            Project
          </button>
        </div>

        {scope === 'project' && (
          <select
            value={selectedProjectId ?? ''}
            onChange={(e) => setSelectedProjectId(e.target.value || null)}
            className="h-8 px-3 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 focus:border-gray-700 focus:ring-0 outline-none"
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <div className="flex-1" />

        {/* Action buttons */}
        <button
          onClick={saveGuideline}
          disabled={!isDirty || loading}
          className="h-8 px-3 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium transition-colors disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={handleReset}
          disabled={loading}
          className="h-8 px-3 rounded-lg border border-gray-800 hover:border-gray-700 text-gray-400 hover:text-gray-300 text-xs transition-colors disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      {/* Textarea */}
      <div className="relative">
        <textarea
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          onBlur={handleBlur}
          placeholder="Markdown guidelines… (auto-saves on blur)"
          disabled={loading || (scope === 'project' && !selectedProjectId)}
          className="w-full bg-gray-950 border border-gray-800 rounded-lg p-4 font-mono text-sm text-gray-200 min-h-[400px] outline-none focus:border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Multi-row warning */}
      {hasMultipleRows && guidelineRows.length > 1 && !guidelineRows.find((r) => r.name === 'default') && (
        <div className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
          You have {guidelineRows.length} entries. Showing #1. Clean up duplicates in the database.
        </div>
      )}

      {/* Footer: last saved + preview toggle */}
      <div className="flex items-center gap-3 justify-between">
        <div className="text-xs text-gray-500">
          {lastSaved ? `Saved · ${relTime(lastSaved)}` : 'Not saved yet'}
        </div>
        <div className="flex items-center gap-1 h-7 px-1 border border-gray-800 rounded-lg bg-gray-900">
          <button
            onClick={() => setShowPreview(false)}
            className={`px-2.5 h-6 rounded text-xs font-medium transition-colors ${
              !showPreview
                ? 'bg-gray-800 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Edit
          </button>
          <button
            onClick={() => setShowPreview(true)}
            className={`px-2.5 h-6 rounded text-xs font-medium transition-colors ${
              showPreview
                ? 'bg-gray-800 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Preview
          </button>
        </div>
      </div>

      {/* Preview */}
      {showPreview && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 max-h-[600px] overflow-y-auto">
          {body.trim() ? (
            <Markdown>{body}</Markdown>
          ) : (
            <p className="text-sm text-gray-500 italic">No content to preview</p>
          )}
        </div>
      )}
    </div>
  )
}

// Relative time helper (reuse from SkillsTab)
function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 172800) return 'Yesterday'
  return `${Math.floor(s / 86400)}d ago`
}
