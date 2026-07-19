import React, { useEffect, useState, useCallback } from 'react'

interface ConnectorField {
  key: string
  label: string
  placeholder: string
  secret: boolean
  optional?: boolean
}

interface ConnectorDef {
  id: string
  label: string
  icon: React.ReactNode
  color: string
  fields: ConnectorField[]
  hint?: string
}

const CONNECTORS: ConnectorDef[] = [
  {
    id: 'linear',
    label: 'Linear',
    icon: '⬡',
    color: '#5E6AD2',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'lin_api_…', secret: true },
      { key: 'team_id', label: 'Team ID', placeholder: 'your-team-id (optional)', secret: false, optional: true },
    ],
    hint: 'Get your API key at linear.app → Settings → API',
  },
  {
    id: 'jira',
    label: 'Jira',
    icon: '◈',
    color: '#0052CC',
    fields: [
      { key: 'api_key', label: 'API Token', placeholder: 'Atlassian API token', secret: true },
      { key: 'email', label: 'Email', placeholder: 'you@company.com', secret: false },
      { key: 'base_url', label: 'Base URL', placeholder: 'https://yourco.atlassian.net', secret: false },
      { key: 'project_key', label: 'Project Key', placeholder: 'ENG', secret: false, optional: true },
    ],
    hint: 'Get your API token at id.atlassian.com → Security → API tokens',
  },
  {
    id: 'asana',
    label: 'Asana',
    icon: '◉',
    color: '#F06A6A',
    fields: [
      { key: 'personal_access_token', label: 'Personal Access Token', placeholder: 'Asana PAT', secret: true },
      { key: 'workspace_gid', label: 'Workspace GID', placeholder: 'Numeric workspace ID', secret: false },
      { key: 'team_gid', label: 'Team GID', placeholder: 'Optional — filter by team', secret: false, optional: true },
    ],
    hint: 'Get your PAT at app.asana.com → My Profile → Apps → Personal Access Tokens',
  },
]

function ConnectorCard({
  def,
  isActive,
  savedConfig,
  onActivate,
}: {
  def: ConnectorDef
  isActive: boolean
  savedConfig: Record<string, string> | null
  onActivate: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const showForm = (isActive && editing) || (!isActive && expanded)

  const handleTestAndSave = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.connector.test(def.id, fields)
      setTestResult(result)
      if (result.ok) {
        await window.api.connector.setActive(def.id, fields)
        setEditing(false)
        setExpanded(false)
        onActivate()
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || 'Failed' })
    } finally {
      setTesting(false)
    }
  }, [def.id, fields, onActivate])

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-soft">
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none"
        onClick={() => isActive ? setEditing(e => !e) : setExpanded(e => !e)}
      >
        <span className="text-sm flex-shrink-0" style={{ color: def.color }}>{def.icon}</span>
        <span className="text-sm font-semibold text-gray-200 flex-shrink-0">{def.label}</span>
        {isActive && !editing && (
          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />Connected
          </span>
        )}
        {!isActive && (
          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" />Disconnected
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isActive && (
            <button
              className="text-xs text-gray-300 hover:text-gray-50 transition-colors"
              onClick={e => { e.stopPropagation(); setEditing(ed => !ed) }}
            >
              {editing ? 'Cancel' : 'Edit'}
            </button>
          )}
          <svg className={`w-4 h-4 text-gray-500 transition-transform ${showForm ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {isActive && !editing && savedConfig && (
        <div className="px-5 pb-4 space-y-2 border-t border-gray-800 pt-4">
          {def.fields.map(f => (
            savedConfig[f.key] ? (
              <div key={f.key} className="flex items-start justify-between">
                <span className="text-xs text-gray-300 font-medium">{f.label}</span>
                <span className="font-mono text-xs text-gray-500 text-right max-w-xs truncate">{savedConfig[f.key]}</span>
              </div>
            ) : null
          ))}
        </div>
      )}

      {showForm && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-800 pt-4">
          {def.hint && <p className="text-xs text-gray-500">{def.hint}</p>}
          {def.fields.map(f => (
            <div key={f.key}>
              <label className="block text-sm text-gray-300 font-medium mb-1.5">
                {f.label}{f.optional && <span className="ml-1 text-gray-500 font-normal">(optional)</span>}
              </label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={fields[f.key] || ''}
                onChange={e => setFields(fv => ({ ...fv, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg h-9 px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:border-gray-600 focus:ring-0 outline-none transition-colors font-mono"
              />
            </div>
          ))}
          {testResult && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${
              testResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
            </div>
          )}
          <button
            onClick={handleTestAndSave}
            disabled={testing}
            className="w-full h-9 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-soft"
          >
            {testing ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Testing…
              </>
            ) : 'Test & Connect'}
          </button>
        </div>
      )}
    </div>
  )
}

function WorkDirSetting() {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.appConfig.get('work_dir').then(v => {
      setValue(v ?? '~/Work')
    }).catch(() => setValue('~/Work'))
  }, [])

  const handleSave = async () => {
    const trimmed = value.trim() || '~/Work'
    await window.api.appConfig.set('work_dir', trimmed)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-soft">
      <label className="block text-sm text-gray-200 font-medium mb-1">Path</label>
      <p className="text-xs text-gray-500 mb-4">
        Root folder where your repos live. devbro scans this for folders to link to projects.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="~/Work"
          className="flex-1 bg-gray-950 border border-gray-800 rounded-lg h-9 px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:border-gray-600 focus:ring-0 outline-none transition-colors font-mono"
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
        />
        <button
          onClick={handleSave}
          className={`flex-shrink-0 h-9 px-4 rounded-lg text-sm font-medium transition-colors ${
            saved
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'h-9 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors shadow-soft'
          }`}
        >
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function GitHubSetting() {
  const [pat, setPat] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string } | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.appConfig.get('github_pat').then((v: string | null) => {
      if (v) setPat(v)
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    await window.api.appConfig.set('github_pat', pat.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleTest = async () => {
    if (!pat.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      await window.api.appConfig.set('github_pat', pat.trim())
      const result = await (window.api as any).github.testAuth()
      setTestResult(result)
    } catch {
      setTestResult({ ok: false })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-soft">
      <label className="block text-sm text-gray-200 font-medium mb-1">Personal Access Token</label>
      <p className="text-xs text-gray-500 mb-4">
        Enables PR status chips and branch creation. Generate at GitHub Settings → Developer settings → PAT (classic). Needs <code className="font-mono">repo</code> scope.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={pat}
          onChange={e => { setPat(e.target.value); setTestResult(null) }}
          placeholder="ghp_…"
          className="flex-1 bg-gray-950 border border-gray-800 rounded-lg h-9 px-3 text-sm text-gray-100 placeholder:text-gray-600 focus:border-gray-600 focus:ring-0 outline-none transition-colors font-mono"
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
        />
        <button
          onClick={handleTest}
          disabled={testing || !pat.trim()}
          className="flex-shrink-0 h-9 px-3 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 text-sm font-medium transition-colors"
        >
          {testing ? '…' : 'Test'}
        </button>
        <button
          onClick={handleSave}
          disabled={!pat.trim()}
          className={`flex-shrink-0 h-9 px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
            saved
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-violet-600 hover:bg-violet-500 text-white shadow-soft'
          }`}
        >
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
      {testResult && (
        <div className={`mt-3 text-xs px-3 py-2 rounded-lg border ${
          testResult.ok
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {testResult.ok ? `✓ Authenticated as ${testResult.user}` : '✕ Authentication failed — check your PAT'}
        </div>
      )}
    </div>
  )
}

function TerminalSessionsSetting() {
  const [maxSessions, setMaxSessions] = useState('1')
  const [fontSize, setFontSize] = useState('14')
  const [scrollback, setScrollback] = useState('2000')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.appConfig.get('max_terminal_sessions'),
      window.api.appConfig.get('terminal_font_size'),
      window.api.appConfig.get('terminal_scrollback'),
    ]).then(([max, font, sb]) => {
      setMaxSessions(max ?? '1')
      setFontSize(font ?? '14')
      setScrollback(sb ?? '2000')
    }).catch(() => {})
  }, [])

  const handleSaveMaxSessions = async (value: string) => {
    setMaxSessions(value)
    await window.api.appConfig.set('max_terminal_sessions', value)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveFontSize = async (value: string) => {
    setFontSize(value)
    await window.api.appConfig.set('terminal_font_size', value)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveScrollback = async (value: string) => {
    setScrollback(value)
    await window.api.appConfig.set('terminal_scrollback', value)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-3">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-soft">
        <label className="block text-sm text-gray-200 font-medium mb-1">Max Concurrent Sessions</label>
        <p className="text-xs text-gray-500 mb-3">Recommended: 1 session on standard machines</p>
        <select
          value={maxSessions}
          onChange={e => handleSaveMaxSessions(e.target.value)}
          className="w-full bg-gray-950 border border-gray-800 rounded-lg h-9 px-3 text-sm text-gray-100 focus:border-gray-600 focus:ring-0 outline-none transition-colors"
        >
          {[1, 2, 3, 4, 5].map(n => <option key={n} value={String(n)}>{n}</option>)}
        </select>
        <p className="text-[11px] text-yellow-500/80 mt-2 flex items-start gap-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Each Claude session can use 1–4 GB of RAM. Only raise this on machines with 32 GB+.</span>
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-soft">
        <label className="block text-sm text-gray-200 font-medium mb-1">Font Size (px)</label>
        <select
          value={fontSize}
          onChange={e => handleSaveFontSize(e.target.value)}
          className="w-full bg-gray-950 border border-gray-800 rounded-lg h-9 px-3 text-sm text-gray-100 focus:border-gray-600 focus:ring-0 outline-none transition-colors"
        >
          {[12, 13, 14, 15, 16].map(n => <option key={n} value={String(n)}>{n}</option>)}
        </select>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-soft">
        <label className="block text-sm text-gray-200 font-medium mb-1">Scrollback Lines</label>
        <select
          value={scrollback}
          onChange={e => handleSaveScrollback(e.target.value)}
          className="w-full bg-gray-950 border border-gray-800 rounded-lg h-9 px-3 text-sm text-gray-100 focus:border-gray-600 focus:ring-0 outline-none transition-colors"
        >
          {[500, 1000, 2000, 5000].map(n => <option key={n} value={String(n)}>{n}</option>)}
        </select>
      </div>

      {saved && (
        <div className="text-xs px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          ✓ Settings saved
        </div>
      )}
    </div>
  )
}

function NotificationsSetting() {
  const [enabled, setEnabled] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.appConfig.get('notifications_enabled').then(v => {
      setEnabled(v !== 'false')
    }).catch(() => setEnabled(true))
  }, [])

  const handleToggle = async () => {
    const newVal = !enabled
    setEnabled(newVal)
    await window.api.appConfig.set('notifications_enabled', String(newVal))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <label className="block text-sm text-gray-200 font-medium mb-1">Notifications</label>
          <p className="text-xs text-gray-500">
            Notify on assigned / status change / deadline soon
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`ml-4 flex-shrink-0 w-10 h-6 rounded-full transition-colors ${
            enabled ? 'bg-emerald-600' : 'bg-gray-700'
          } flex items-center`}
        >
          <div
            className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {saved && (
        <div className="text-xs mt-3 px-2 py-1 rounded text-emerald-400">
          ✓ Updated
        </div>
      )}
    </div>
  )
}

export function ProjectConfigPanel() {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [savedConfigs, setSavedConfigs] = useState<Record<string, Record<string, string>>>({})

  const reload = useCallback(async () => {
    try {
      const all = await window.api.connector.getAll()
      const configs: Record<string, Record<string, string>> = {}
      let active: string | null = null
      for (const c of all) {
        configs[c.id] = c.config
        if (c.enabled) active = c.id
      }
      setSavedConfigs(configs)
      setActiveId(active)
    } catch {}
  }, [])

  useEffect(() => { reload() }, [reload])

  return (
    <div className="flex-1 overflow-y-auto bg-gray-950 min-h-full py-10 px-8">
      <div className="max-w-2xl space-y-10">
        <div>
          <h2 className="text-2xl font-semibold text-gray-50 tracking-tight">Settings</h2>
          <p className="text-sm text-gray-500 mt-1 mb-8">Manage connections, terminal, and preferences</p>
        </div>

        <div className="mb-10">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-3">Connections</h3>
          <div className="space-y-3">
            {CONNECTORS.map(def => (
              <ConnectorCard
                key={def.id}
                def={def}
                isActive={activeId === def.id}
                savedConfig={savedConfigs[def.id] || null}
                onActivate={() => { setActiveId(def.id); reload() }}
              />
            ))}
          </div>
        </div>

        <div className="mb-10">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-3">GitHub</h3>
          <GitHubSetting />
        </div>

        <div className="mb-10">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-3">Work Directory</h3>
          <WorkDirSetting />
        </div>

        <div className="mb-10">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-3">Terminal Settings</h3>
          <TerminalSessionsSetting />
        </div>

        <div className="mb-10">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-3">Notifications</h3>
          <NotificationsSetting />
        </div>

        <div className="mb-10">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-3">Global Context</h3>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-soft">
            <p className="text-sm text-gray-300 font-medium">Rebuild global context</p>
            <p className="text-xs text-gray-500 mt-0.5 mb-4">
              Rebuilds <code className="font-mono">~/.dev-dashboard/global-context.md</code> — included in every Claude session.
            </p>
            <button
              onClick={async () => { try { await window.api.context.refresh() } catch {} }}
              className="flex items-center gap-2 h-9 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors shadow-soft"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Rebuild
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
