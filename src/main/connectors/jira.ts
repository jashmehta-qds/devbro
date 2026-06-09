import type { Connector, ConnectorIssue, ConnectorProject, ConnectorProjectDetails, ConnectorState } from './types'

interface JiraConfig {
  api_key: string
  email: string
  base_url: string
  project_key?: string
}

function mapPriority(name: string | undefined): { priority: number; priorityLabel: string } {
  const n = (name || '').toLowerCase()
  if (n.includes('highest') || n.includes('critical')) return { priority: 1, priorityLabel: 'Urgent' }
  if (n.includes('high')) return { priority: 2, priorityLabel: 'High' }
  if (n.includes('medium')) return { priority: 3, priorityLabel: 'Medium' }
  if (n.includes('low')) return { priority: 4, priorityLabel: 'Low' }
  return { priority: 0, priorityLabel: 'No Priority' }
}

function mapStateType(categoryKey: string): string {
  if (categoryKey === 'done') return 'completed'
  if (categoryKey === 'new') return 'unstarted'
  return 'started'
}

export class JiraConnector implements Connector {
  type = 'jira' as const
  private config: JiraConfig
  private baseUrl: string
  private authHeader: string

  constructor(config: JiraConfig) {
    this.config = config
    this.baseUrl = config.base_url.replace(/\/$/, '')
    this.authHeader = 'Basic ' + Buffer.from(`${config.email}:${config.api_key}`).toString('base64')
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Jira API ${res.status}: ${text.slice(0, 200)}`)
    }
    return res.json()
  }

  private mapIssue(issue: any): ConnectorIssue {
    const f = issue.fields || {}
    const { priority, priorityLabel } = mapPriority(f.priority?.name)
    const stateType = mapStateType(f.status?.statusCategory?.key || '')
    return {
      id: issue.id,
      identifier: issue.key,
      title: f.summary || '',
      description: f.description ? (typeof f.description === 'string' ? f.description : JSON.stringify(f.description)) : undefined,
      priority,
      priorityLabel,
      state: {
        id: f.status?.id || '',
        name: f.status?.name || '',
        color: stateType === 'completed' ? '#10B981' : stateType === 'started' ? '#3B82F6' : '#9CA3AF',
        type: stateType,
      },
      assignee: f.assignee ? {
        id: f.assignee.accountId,
        name: f.assignee.displayName,
        email: f.assignee.emailAddress || '',
        avatarUrl: f.assignee.avatarUrls?.['48x48'],
      } : undefined,
      project: f.project ? {
        id: f.project.id,
        name: f.project.name,
        description: f.project.description,
      } : undefined,
      parent: f.parent ? {
        id: f.parent.id,
        identifier: f.parent.key,
        title: f.parent.fields?.summary || '',
      } : undefined,
      createdAt: f.created || new Date().toISOString(),
      updatedAt: f.updated || new Date().toISOString(),
      url: `${this.baseUrl}/browse/${issue.key}`,
      labels: (f.labels || []).map((l: string, i: number) => ({ id: String(i), name: l, color: '#6366f1' })),
    }
  }

  async fetchProjects(): Promise<ConnectorProject[]> {
    const data = await this.fetch('/rest/api/3/project/search?maxResults=100&orderBy=name')
    const projects: ConnectorProject[] = (data.values || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description || undefined,
      color: '#0052CC',
    }))
    return projects
  }

  async fetchIssues(projectId: string): Promise<ConnectorIssue[]> {
    const jql = projectId === '__no_project__'
      ? 'assignee=currentUser() AND resolution is EMPTY ORDER BY updated DESC'
      : `project="${projectId}" AND assignee=currentUser() AND resolution is EMPTY ORDER BY updated DESC`
    const fields = 'id,key,summary,description,priority,status,assignee,project,parent,labels,created,updated'
    const data = await this.fetch(`/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=100`)
    return (data.issues || []).map((i: any) => this.mapIssue(i))
  }

  async fetchIssue(id: string): Promise<ConnectorIssue> {
    const issue = await this.fetch(`/rest/api/3/issue/${id}`)
    return this.mapIssue(issue)
  }

  async fetchIssueStates(issueId: string): Promise<ConnectorState[]> {
    const data = await this.fetch(`/rest/api/3/issue/${issueId}/transitions`)
    return (data.transitions || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      color: mapStateType(t.to?.statusCategory?.key || '') === 'completed' ? '#10B981'
        : mapStateType(t.to?.statusCategory?.key || '') === 'started' ? '#3B82F6' : '#9CA3AF',
      type: mapStateType(t.to?.statusCategory?.key || ''),
    }))
  }

  async fetchProjectDetails(projectId: string): Promise<ConnectorProjectDetails> {
    const project = await this.fetch(`/rest/api/3/project/${projectId}`)
    // Get issue count by status
    const searchData = await this.fetch(
      `/rest/api/3/search?jql=${encodeURIComponent(`project="${projectId}"`)}&fields=status&maxResults=200`
    ).catch(() => ({ issues: [] }))

    const issueStateCounts: Record<string, number> = {}
    for (const issue of searchData.issues || []) {
      const type = mapStateType(issue.fields?.status?.statusCategory?.key || '')
      issueStateCounts[type] = (issueStateCounts[type] || 0) + 1
    }

    return {
      id: project.id,
      name: project.name,
      description: project.description || null,
      content: null,
      state: null,
      progress: 0,
      startDate: null,
      targetDate: null,
      url: `${this.baseUrl}/projects/${project.key}`,
      updatedAt: null,
      lead: project.lead ? {
        id: project.lead.accountId,
        name: project.lead.displayName,
        email: project.lead.emailAddress || '',
        avatarUrl: project.lead.avatarUrls?.['48x48'] || null,
      } : null,
      members: [],
      issueStateCounts,
      totalIssues: searchData.total || 0,
      milestones: [],
    }
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.fetch(`/rest/api/3/issue/${issueId}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: stateId } }),
    })
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const user = await this.fetch('/rest/api/3/myself')
      return { ok: true, message: `Connected as ${user.displayName}` }
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Connection failed' }
    }
  }
}
