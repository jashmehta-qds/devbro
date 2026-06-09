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
    <div className={`rounded-xl border transition-all duration-150 ${
      isActive ? 'border-indigo-500/50 bg-gray-800/60' : 'border-gray-800 bg-gray-800/30 hover:border-gray-700'
    }`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => isActive ? setEditing(e => !e) : setExpanded(e => !e)}
      >
        <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
          isActive ? 'border-indigo-500' : 'border-gray-600'
        }`}>
          {isActive && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
        </div>
        <span className="text-base flex-shrink-0" style={{ color: def.color }}>{def.icon}</span>
        <span className={`text-sm font-semibold ${isActive ? 'text-gray-100' : 'text-gray-400'}`}>{def.label}</span>
        {isActive && !editing && (
          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800/40 flex items-center gap-1 flex-shrink-0">
            <span className="w-1 h-1 rounded-full bg-green-400 inline-block" />Connected
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isActive && (
            <button
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              onClick={e => { e.stopPropagation(); setEditing(ed => !ed) }}
            >
              {editing ? 'Cancel' : 'Edit'}
            </button>
          )}
          <svg className={`w-3.5 h-3.5 text-gray-600 transition-transform ${showForm ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Saved values preview */}
      {isActive && !editing && savedConfig && (
        <div className="px-4 pb-3 space-y-1">
          {def.fields.map(f => (
            savedConfig[f.key] ? (
              <div key={f.key} className="flex items-center gap-2 text-xs">
                <span className="text-gray-600 w-28 flex-shrink-0">{f.label}</span>
                <span className="font-mono text-gray-500">{savedConfig[f.key]}</span>
              </div>
            ) : null
          ))}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-800/60 pt-3">
          {def.hint && <p className="text-xs text-gray-600 italic">{def.hint}</p>}
          {def.fields.map(f => (
            <div key={f.key}>
              <label className="block text-xs text-gray-500 mb-1">
                {f.label}{f.optional && <span className="ml-1 text-gray-700">(optional)</span>}
              </label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={fields[f.key] || ''}
                onChange={e => setFields(fv => ({ ...fv, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-700 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
              />
            </div>
          ))}
          {testResult && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${
              testResult.ok
                ? 'bg-green-900/20 border-green-800/40 text-green-400'
                : 'bg-red-900/20 border-red-800/40 text-red-400'
            }`}>
              {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
            </div>
          )}
          <button
            onClick={handleTestAndSave}
            disabled={testing}
            className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {testing ? (
              <>
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
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
    <div className="flex-1 overflow-y-auto bg-gray-900 p-6">
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Connections</h2>
          <p className="text-xs text-gray-500 mt-0.5">Connect devbro to your issue tracker. Only one active at a time.</p>
        </div>

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

        <div className="border-t border-gray-800 pt-5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Global Context</h3>
          <p className="text-xs text-gray-600 mb-3">
            Rebuilds <code className="font-mono">~/.dev-dashboard/global-context.md</code> — included in every Claude session.
          </p>
          <button
            onClick={async () => { try { await window.api.context.refresh() } catch {} }}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Rebuild global context
          </button>
        </div>
      </div>
    </div>
  )
}
