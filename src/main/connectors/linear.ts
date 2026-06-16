import type { Connector, ConnectorIssue, ConnectorProject, ConnectorProjectDetails, ConnectorState, ConnectorCycle } from './types'
import {
  fetchProjects as _fetchProjects,
  fetchIssues as _fetchIssues,
  fetchIssue as _fetchIssue,
  fetchIssueStates as _fetchIssueStates,
  fetchProjectDetails as _fetchProjectDetails,
  updateIssueState as _updateIssueState,
  fetchTeamCycles as _fetchTeamCycles,
} from '../linear'

interface LinearConfig {
  api_key?: string
  team_id?: string
}

export class LinearConnector implements Connector {
  type = 'linear' as const
  private config: LinearConfig

  constructor(config: LinearConfig) {
    this.config = config
    // Only update env + reset client if key actually changed
    const prevKey = process.env.LINEAR_API_KEY
    if (config.api_key) process.env.LINEAR_API_KEY = config.api_key
    if (config.team_id) process.env.LINEAR_TEAM_ID = config.team_id
    if (config.api_key && config.api_key !== prevKey) {
      try {
        const linear = require('../linear')
        if (linear._resetClient) linear._resetClient()
      } catch {}
    }
  }

  async fetchProjects(): Promise<ConnectorProject[]> {
    return _fetchProjects() as any
  }

  async fetchIssues(projectId: string): Promise<ConnectorIssue[]> {
    return _fetchIssues(projectId) as any
  }

  async fetchIssue(id: string): Promise<ConnectorIssue> {
    return _fetchIssue(id) as any
  }

  async fetchIssueStates(issueId: string): Promise<ConnectorState[]> {
    return _fetchIssueStates(issueId) as any
  }

  async fetchProjectDetails(projectId: string): Promise<ConnectorProjectDetails> {
    return _fetchProjectDetails(projectId) as any
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    return _updateIssueState(issueId, stateId)
  }

  async fetchCycles(): Promise<ConnectorCycle[]> {
    return _fetchTeamCycles()
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const projects = await _fetchProjects()
      return { ok: true, message: `Connected — ${projects.length} project(s) found` }
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Connection failed' }
    }
  }
}
