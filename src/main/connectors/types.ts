export interface ConnectorIssue {
  id: string
  identifier: string
  title: string
  description?: string
  priority: number
  priorityLabel: string
  state: { id: string; name: string; color: string; type: string }
  assignee?: { id: string; name: string; email: string; avatarUrl?: string }
  project?: { id: string; name: string; description?: string }
  parent?: { id: string; identifier: string; title: string }
  createdAt: string
  updatedAt: string
  url: string
  labels?: Array<{ id: string; name: string; color: string }>
  cycleId?: string | null
  milestoneId?: string | null
}

export interface ConnectorCycle {
  id: string
  number: number
  name: string | null
  isCurrent: boolean
  isNext: boolean
  startsAt: string
  endsAt: string
}

export interface ConnectorProject {
  id: string
  name: string
  description?: string
  color?: string
  state?: string
  progress?: number
  targetDate?: string | null
}

export interface ConnectorState {
  id: string
  name: string
  color: string
  type: string
}

export interface ConnectorProjectDetails {
  id: string
  name: string
  description: string | null
  content: string | null
  state: string | null
  progress: number
  startDate: string | null
  targetDate: string | null
  url: string | null
  updatedAt: string | null
  lead: { id: string; name: string; email: string; avatarUrl: string | null } | null
  members: Array<{ id: string; name: string; email: string; avatarUrl: string | null }>
  issueStateCounts: Record<string, number>
  totalIssues: number
  milestones: Array<{ id: string; name: string; description: string | null; targetDate: string | null; sortOrder: number }>
}

export interface Connector {
  type: string
  fetchProjects(): Promise<ConnectorProject[]>
  fetchIssues(projectId: string): Promise<ConnectorIssue[]>
  fetchIssue(id: string): Promise<ConnectorIssue>
  fetchIssueStates(issueId: string): Promise<ConnectorState[]>
  fetchProjectDetails(projectId: string): Promise<ConnectorProjectDetails>
  updateIssueState(issueId: string, stateId: string): Promise<void>
  testConnection(): Promise<{ ok: boolean; message: string }>
  fetchCycles?(): Promise<ConnectorCycle[]>
}
