import type { Connector, ConnectorIssue, ConnectorProject, ConnectorProjectDetails, ConnectorState, ConnectorCycle } from './types'

interface AsanaConfig {
  personal_access_token: string
  workspace_gid: string
  team_gid?: string
}

const BASE = 'https://app.asana.com/api/1.0'

const ASANA_STATES: ConnectorState[] = [
  { id: 'open', name: 'In Progress', color: '#3B82F6', type: 'started' },
  { id: 'completed', name: 'Completed', color: '#10B981', type: 'completed' },
]

function extractPriority(customFields: any[]): { priority: number; priorityLabel: string } {
  if (!Array.isArray(customFields)) return { priority: 0, priorityLabel: 'No Priority' }
  const pf = customFields.find(f => f.name?.toLowerCase() === 'priority')
  if (!pf?.display_value) return { priority: 0, priorityLabel: 'No Priority' }
  const v = pf.display_value.toLowerCase()
  if (v.includes('urgent') || v.includes('critical')) return { priority: 1, priorityLabel: 'Urgent' }
  if (v.includes('high')) return { priority: 2, priorityLabel: 'High' }
  if (v.includes('medium') || v.includes('normal')) return { priority: 3, priorityLabel: 'Medium' }
  if (v.includes('low')) return { priority: 4, priorityLabel: 'Low' }
  return { priority: 0, priorityLabel: 'No Priority' }
}

export class AsanaConnector implements Connector {
  type = 'asana' as const
  private config: AsanaConfig

  constructor(config: AsanaConfig) {
    this.config = config
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.config.personal_access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Asana API ${res.status}: ${text.slice(0, 200)}`)
    }
    const json = await res.json()
    return json.data ?? json
  }

  private mapTask(task: any, projectInfo?: { id: string; name: string }): ConnectorIssue {
    const { priority, priorityLabel } = extractPriority(task.custom_fields)
    const isCompleted = !!task.completed
    const gid: string = task.gid || task.id || ''
    return {
      id: gid,
      identifier: `#${gid.slice(-6)}`,
      title: task.name || '',
      description: task.notes || undefined,
      priority,
      priorityLabel,
      state: isCompleted
        ? { id: 'completed', name: 'Completed', color: '#10B981', type: 'completed' }
        : { id: 'open', name: 'In Progress', color: '#3B82F6', type: 'started' },
      assignee: task.assignee ? {
        id: task.assignee.gid,
        name: task.assignee.name || '',
        email: '',
        avatarUrl: task.assignee.photo?.image_36x36,
      } : undefined,
      project: projectInfo,
      createdAt: task.created_at || new Date().toISOString(),
      updatedAt: task.modified_at || new Date().toISOString(),
      url: `https://app.asana.com/0/${this.config.workspace_gid}/${gid}`,
      labels: (task.tags || []).map((t: any) => ({ id: t.gid, name: t.name, color: '#6366f1' })),
    }
  }

  async fetchProjects(): Promise<ConnectorProject[]> {
    const params = new URLSearchParams({
      workspace: this.config.workspace_gid,
      archived: 'false',
      opt_fields: 'gid,name,notes,color',
    })
    if (this.config.team_gid) params.set('team', this.config.team_gid)
    const projects: ConnectorProject[] = await this.fetch(`/projects?${params}`)
    return projects.map((p: any) => ({
      id: p.gid,
      name: p.name,
      description: p.notes?.slice(0, 200) || undefined,
      color: undefined,
    }))
  }

  async fetchIssues(projectId: string): Promise<ConnectorIssue[]> {
    const taskFields = 'gid,name,notes,assignee,assignee.name,assignee.photo,completed,due_on,created_at,modified_at,custom_fields,tags,tags.name'

    if (projectId === '__no_project__') {
      const params = new URLSearchParams({
        assignee: 'me',
        workspace: this.config.workspace_gid,
        completed_since: 'now',
        opt_fields: taskFields,
      })
      const tasks = await this.fetch(`/tasks?${params}`)
      return (Array.isArray(tasks) ? tasks : []).map((t: any) => this.mapTask(t))
    }

    // Fetch project name for display
    let projectInfo: { id: string; name: string } | undefined
    try {
      const p = await this.fetch(`/projects/${projectId}?opt_fields=gid,name`)
      projectInfo = { id: p.gid, name: p.name }
    } catch {}

    const params = new URLSearchParams({ opt_fields: taskFields })
    const tasks = await this.fetch(`/projects/${projectId}/tasks?${params}`)
    const list = Array.isArray(tasks) ? tasks : []
    // Filter to assigned-to-me + not completed
    return list
      .filter((t: any) => !t.completed)
      .map((t: any) => this.mapTask(t, projectInfo))
  }

  async fetchIssue(id: string): Promise<ConnectorIssue> {
    const taskFields = 'gid,name,notes,assignee,assignee.name,assignee.photo,completed,due_on,created_at,modified_at,custom_fields,tags,tags.name,memberships,memberships.project.name,memberships.project.gid'
    const task = await this.fetch(`/tasks/${id}?opt_fields=${taskFields}`)
    const proj = task.memberships?.[0]?.project
    return this.mapTask(task, proj ? { id: proj.gid, name: proj.name } : undefined)
  }

  async fetchIssueStates(_issueId: string): Promise<ConnectorState[]> {
    return ASANA_STATES
  }

  async fetchProjectDetails(projectId: string): Promise<ConnectorProjectDetails> {
    const project = await this.fetch(`/projects/${projectId}?opt_fields=gid,name,notes,color,due_on,start_on,members,members.name,members.email,created_at,modified_at`)
    const tasks = await this.fetch(`/projects/${projectId}/tasks?opt_fields=gid,completed`).catch(() => [])
    const list = Array.isArray(tasks) ? tasks : []
    const completedCount = list.filter((t: any) => t.completed).length
    const openCount = list.length - completedCount

    return {
      id: project.gid,
      name: project.name,
      description: project.notes?.slice(0, 300) || null,
      content: project.notes || null,
      state: null,
      progress: list.length > 0 ? Math.round((completedCount / list.length) * 100) : 0,
      startDate: project.start_on || null,
      targetDate: project.due_on || null,
      url: `https://app.asana.com/0/${project.gid}`,
      updatedAt: project.modified_at || null,
      lead: null,
      members: (project.members || []).map((m: any) => ({
        id: m.gid,
        name: m.name || '',
        email: m.email || '',
        avatarUrl: null,
      })),
      issueStateCounts: { started: openCount, completed: completedCount },
      totalIssues: list.length,
      milestones: [],
    }
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.fetch(`/tasks/${issueId}`, {
      method: 'PUT',
      body: JSON.stringify({ data: { completed: stateId === 'completed' } }),
    })
  }

  async fetchCycles(): Promise<ConnectorCycle[]> {
    return []
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const user = await this.fetch('/users/me')
      return { ok: true, message: `Connected as ${user.name}` }
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Connection failed' }
    }
  }
}
