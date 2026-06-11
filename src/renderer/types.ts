export interface LinearProject {
  id: string
  name: string
  description?: string
  color?: string
  icon?: string
  state?: string
  progress?: number
  targetDate?: string | null
}

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description?: string
  priority: number
  priorityLabel: string
  state: {
    id: string
    name: string
    color: string
    type: string
  }
  assignee?: {
    id: string
    name: string
    email: string
    avatarUrl?: string
  }
  project?: {
    id: string
    name: string
    description?: string
  }
  parent?: {
    id: string
    identifier: string
    title: string
  }
  createdAt: string
  updatedAt: string
  url: string
  labels?: Array<{
    id: string
    name: string
    color: string
  }>
}

export interface Note {
  id: string
  ticket_id: string
  content: string
  updated_at: number
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Checklist {
  id: string
  ticket_id: string
  items: ChecklistItem[]
  updated_at: number
}

export interface Skill {
  id: string
  ticket_id: string
  name: string
  command: string
  created_at: number
}

export interface Progress {
  id: string
  ticket_id: string
  percent: number
  log: string
  updated_at: number
}

export interface ELI5Cache {
  ticket_id: string
  content: string
  created_at: number
}

export interface ProjectConfig {
  linear_project_id: string
  linear_project_name: string
  github_repo: string
  default_branch: string
  local_repo: string
  updated_at: number
}

export interface TicketBranch {
  ticket_id: string
  branch_name: string
  updated_at: number
}

export interface TerminalSession {
  id: string
  ticketId: string
  cols: number
  rows: number
}

export type TabType = 'detail' | 'notes' | 'skills' | 'progress'

export interface IssueTab {
  id: string
  issue: LinearIssue
  terminalSessionId: string | null
  terminalOpen: boolean
  activeSection: TabType
}

export interface AppState {
  projects: LinearProject[]
  issues: Record<string, LinearIssue[]>
  selectedProjectId: string | null
  selectedIssue: LinearIssue | null
  expandedProjects: Set<string>
  activeTab: TabType
  terminalOpen: boolean
  terminalSessionId: string | null
  loading: boolean
  error: string | null
  notes: Record<string, Note>
  checklists: Record<string, Checklist>
  skills: Record<string, Skill[]>
  progress: Record<string, Progress>
  eli5Cache: Record<string, string>
  projectConfigs: ProjectConfig[]
  ticketBranches: Record<string, string>
  settingsOpen: boolean
}

export interface IssueState {
  id: string
  name: string
  color: string
  type: string
}

export interface TimeSessionEntry {
  ticketId: string
  title: string
  durationMs: number
  startedAt: number
}

export interface DayEntry {
  date: string
  totalMs: number
  ticketCount: number
}

export interface InProgressEntry {
  ticketId: string
  title: string
  percent: number
}

export interface StatusChangeEntry {
  ticketId: string
  title: string
  fromState: string | null
  toState: string
  changedAt: number
}

export interface ProjectDeadlineEntry {
  id: string
  name: string
  targetDate: string
  progress: number
  state: string | null
  color?: string | null
}

export interface AnalyticsDashboard {
  today: { sessions: TimeSessionEntry[]; totalMs: number; ticketCount: number }
  week: { byDay: DayEntry[]; totalMs: number }
  inProgress: InProgressEntry[]
  recentStatusChanges: StatusChangeEntry[]
  projectDeadlines: ProjectDeadlineEntry[]
}

export interface GitBranchInfo {
  branch: string | null
  isDirty: boolean
  aheadBy: number
  behindBy: number
}

export interface ProjectMilestone {
  id: string
  name: string
  description: string | null
  targetDate: string | null
  sortOrder: number
}

export interface ProjectMember {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

export interface ProjectDetails {
  id: string
  name: string
  description: string | null   // short summary line
  content: string | null        // full markdown body document
  state: string | null
  progress: number
  startDate: string | null
  targetDate: string | null
  url: string | null
  updatedAt: string | null
  lead: ProjectMember | null
  members: ProjectMember[]
  issueStateCounts: Record<string, number>
  totalIssues: number
  milestones: ProjectMilestone[]
}

export interface WindowApi {
  linear: {
    getProjects: () => Promise<LinearProject[]>
    getIssues: (projectId: string) => Promise<LinearIssue[]>
    getIssue: (issueId: string) => Promise<LinearIssue>
    getIssueStates: (issueId: string) => Promise<IssueState[]>
    updateStatus: (issueId: string, stateId: string, fromStateName: string, toStateName: string) => Promise<void>
    onIssueUpdated: (callback: (issue: LinearIssue) => void) => () => void
  }
  tabs: {
    setOpen: (tabIds: string[]) => Promise<void>
  }
  notes: {
    get: (ticketId: string) => Promise<Note | null>
    save: (ticketId: string, content: string) => Promise<Note>
  }
  checklist: {
    get: (ticketId: string) => Promise<Checklist | null>
    save: (ticketId: string, items: ChecklistItem[]) => Promise<Checklist>
  }
  skills: {
    list: (ticketId: string) => Promise<Skill[]>
    add: (ticketId: string, name: string, command: string) => Promise<Skill>
    delete: (skillId: string) => Promise<void>
  }
  progress: {
    get: (ticketId: string) => Promise<Progress | null>
    update: (ticketId: string, percent: number, log?: string) => Promise<Progress>
    onUpdated: (callback: (payload: { ticketId: string; summary: string; newPercent: number }) => void) => () => void
  }
  eli5: {
    get: (ticketId: string) => Promise<string | null>
    generate: (ticketId: string, title: string, description: string) => Promise<string>
  }
  projectConfig: {
    getAll: () => Promise<ProjectConfig[]>
    save: (linearProjectId: string, linearProjectName: string, githubRepo: string, defaultBranch: string, localRepo: string) => Promise<ProjectConfig>
    delete: (linearProjectId: string) => Promise<void>
  }
  repos: {
    list: () => Promise<string[]>
  }
  projectRepos: {
    list: (linearProjectId: string) => Promise<any[]>
    add: (linearProjectId: string, repoName: string) => Promise<any>
    remove: (repoId: string) => Promise<void>
    getForProject: (linearProjectId: string) => Promise<string[]>
  }
  ticketBranch: {
    get: (ticketId: string) => Promise<string | null>
    save: (ticketId: string, branchName: string) => Promise<void>
  }
  terminal: {
    create: (ticketId: string, issueData: any, cols: number, rows: number, repoName?: string) => Promise<string>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    kill: (sessionId: string) => Promise<void>
    attach: (sessionId: string) => Promise<void>
    detach: (sessionId: string) => Promise<void>
    onData: (sessionId: string, callback: (data: string) => void) => () => void
    onExit: (sessionId: string, callback: (code: number) => void) => () => void
    onAnyExit: (callback: (payload: { sessionId: string; code: number; evicted: boolean }) => void) => () => void
  }
  cache: {
    getProjects: () => Promise<LinearProject[]>
    saveProjects: (projects: LinearProject[]) => Promise<void>
    getIssues: (projectId: string) => Promise<LinearIssue[]>
    saveIssues: (projectId: string, issues: LinearIssue[]) => Promise<void>
  }
  analytics: {
    getDashboard: () => Promise<AnalyticsDashboard>
  }
  git: {
    getBranchInfo: (repoPath: string) => Promise<GitBranchInfo>
  }
  project: {
    getDetails: (projectId: string) => Promise<ProjectDetails>
    refreshDetails: (projectId: string) => Promise<ProjectDetails>
  }
  context: {
    refresh: () => Promise<void>
    preview: (ticketId: string, issueData: any, repoName?: string) => Promise<string>
    refreshForSession: (sessionId: string, ticketId: string, issueData: any) => Promise<{ ok: boolean; path?: string; error?: string }>
  }
  projectSkills: {
    list: (projectId: string) => Promise<Array<{ id: string; project_id: string; name: string; command: string; created_at: number }>>
    add: (projectId: string, name: string, command: string) => Promise<{ id: string; project_id: string; name: string; command: string; created_at: number }>
    delete: (skillId: string) => Promise<void>
  }
  globalSkills: {
    list: () => Promise<Array<{ id: string; name: string; command: string; created_at: number }>>
    add: (name: string, command: string) => Promise<{ id: string; name: string; command: string; created_at: number }>
    delete: (skillId: string) => Promise<void>
  }
  window: {
    toggleMaximize: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  standup: {
    generate: () => Promise<{ standup: string; raw: string; usedAI: boolean }>
  }
  connector: {
    getAll: () => Promise<Array<{ id: string; enabled: boolean; config: Record<string, string> }>>
    getActive: () => Promise<{ id: string; config: Record<string, string> }>
    setActive: (type: string, config: Record<string, string>) => Promise<void>
    test: (type: string, config: Record<string, string>) => Promise<{ ok: boolean; message: string }>
  }
  appConfig: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<void>
  }
}
