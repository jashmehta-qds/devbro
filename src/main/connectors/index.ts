import { getDb } from '../db'
import { LinearConnector } from './linear'
import { JiraConnector } from './jira'
import { AsanaConnector } from './asana'
import type { Connector } from './types'

let _cachedConnector: Connector | null = null
let _cachedConnectorId: string | null = null

export function createConnector(type: string, config: Record<string, string>): Connector {
  switch (type) {
    case 'linear': return new LinearConnector(config)
    case 'jira': return new JiraConnector(config as any)
    case 'asana': return new AsanaConnector(config as any)
    default: throw new Error(`Unknown connector type: ${type}`)
  }
}

export function invalidateConnectorCache() {
  _cachedConnector = null
  _cachedConnectorId = null
}

export function getActiveConnector(): Connector {
  try {
    const db = getDb()
    const row = db.prepare('SELECT id, config FROM connectors WHERE enabled = 1 LIMIT 1').get() as any
    if (row) {
      // Return cached connector if the active connector hasn't changed
      if (_cachedConnector && _cachedConnectorId === row.id) return _cachedConnector
      const config = JSON.parse(row.config || '{}')
      _cachedConnector = createConnector(row.id, config)
      _cachedConnectorId = row.id
      return _cachedConnector
    }
  } catch {}

  if (_cachedConnector && _cachedConnectorId === 'linear_env') return _cachedConnector
  _cachedConnector = new LinearConnector({
    api_key: process.env.LINEAR_API_KEY,
    team_id: process.env.LINEAR_TEAM_ID,
  })
  _cachedConnectorId = 'linear_env'
  return _cachedConnector
}

export function maskConfig(config: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {}
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' && v.length > 4) {
      const secretFields = ['api_key', 'personal_access_token', 'token', 'secret', 'password']
      const isSecret = secretFields.some(s => k.toLowerCase().includes(s))
      masked[k] = isSecret ? `••••••••${v.slice(-4)}` : v
    } else {
      masked[k] = v
    }
  }
  return masked
}
