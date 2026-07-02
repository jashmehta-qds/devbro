import { create } from 'zustand'
import type {
  LinearProject,
  LinearIssue,
  Note,
  Checklist,
  Skill,
  Progress,
  TabType,
  ProjectConfig,
  IssueTab,
  ProjectDetails
} from './types'

const MAX_TABS = 8

function saveTabs(tabs: IssueTab[], activeTabId: string | null) {
  try {
    localStorage.setItem(
      'dev-dashboard-tabs',
      JSON.stringify({
        tabs: tabs.map((t) => ({ id: t.id, issue: t.issue, activeSection: t.activeSection })),
        activeTabId
      })
    )
  } catch { /* ignore */ }
}

function loadTabsFromStorage(): { tabs: IssueTab[]; activeTabId: string | null } {
  try {
    const raw = localStorage.getItem('dev-dashboard-tabs')
    if (!raw) return { tabs: [], activeTabId: null }
    const parsed = JSON.parse(raw)
    const tabs: IssueTab[] = (parsed.tabs || []).map((t: any) => ({
      id: t.id,
      issue: t.issue,
      terminalSessionId: null,
      terminalOpen: false,
      activeSection: t.activeSection || 'detail'
    }))
    return { tabs, activeTabId: parsed.activeTabId || null }
  } catch {
    return { tabs: [], activeTabId: null }
  }
}

// Compute all derived values from tabs + activeTabId.
// Called in every action that changes either — keeps derived state always fresh.
function derived(tabs: IssueTab[], activeTabId: string | null) {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  return {
    selectedIssue: activeTab?.issue ?? null,
    activeTab: (activeTab?.activeSection ?? 'detail') as TabType,
    terminalOpen: activeTab?.terminalOpen ?? false,
    terminalSessionId: activeTab?.terminalSessionId ?? null,
  }
}

const stored = loadTabsFromStorage()
const initialDerived = derived(stored.tabs, stored.activeTabId)

const RECENT_KEY = 'dev-dashboard-recent-issues'
const MAX_RECENT = 20

function loadRecentIssueIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string').slice(0, MAX_RECENT)
    return []
  } catch {
    return []
  }
}

function saveRecentIssueIds(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch { /* ignore */ }
}

const EXPANDED_KEY = 'dev-dashboard-expanded-projects'

function loadExpandedFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveExpandedToStorage(set: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...set]))
  } catch { /* ignore */ }
}

interface AppState {
  // Linear data
  projects: LinearProject[]
  issues: Record<string, LinearIssue[]>
  selectedProjectId: string | null
  expandedProjects: Set<string>

  // Tabs
  tabs: IssueTab[]
  activeTabId: string | null

  // Derived from active tab (kept in sync by every action — NOT computed getters)
  selectedIssue: LinearIssue | null
  activeTab: TabType
  terminalOpen: boolean
  terminalSessionId: string | null

  // Project tabs (separate from issue tabs) — also used for Settings/Dashboard tabs
  projectTabs: Array<{ id: string; name: string; color?: string; tabType?: 'project' | 'settings' | 'dashboard' | 'help' }>
  activeProjectTabId: string | null
  openProjectTab: (project: import('./types').LinearProject) => void
  closeProjectTab: (projectId: string) => void
  focusProjectTab: (projectId: string) => void
  openSettingsTab: () => void
  openDashboardTab: () => void
  openHelpTab: () => void

  // UI state
  loading: boolean
  error: string | null
  isSyncing: boolean
  fromCache: boolean
  commandPaletteOpen: boolean
  settingsOpen: boolean
  dashboardOpen: boolean
  helpOpen: boolean
  standupOpen: boolean
  activeProjectId: string | null
  projectDetails: Record<string, ProjectDetails>

  // Local data
  notes: Record<string, Note>
  checklists: Record<string, Checklist>
  skills: Record<string, Skill[]>
  progress: Record<string, Progress>
  eli5Cache: Record<string, string>
  eli5Loading: Record<string, boolean>
  projectConfigs: ProjectConfig[]
  ticketBranches: Record<string, string>

  // Recent issues (persisted to localStorage)
  recentIssueIds: string[]

  // Notifications (transient toast stack)
  notifications: Array<{ id: string; message: string }>
  addNotification: (message: string) => void
  dismissNotification: (id: string) => void

  // Actions
  setProjects: (projects: LinearProject[]) => void
  setIssues: (projectId: string, issues: LinearIssue[]) => void
  setSelectedProjectId: (id: string | null) => void
  toggleProjectExpanded: (projectId: string) => void

  // Tab actions
  openTab: (issue: LinearIssue) => void
  closeTab: (issueId: string) => void
  focusTab: (issueId: string) => void
  updateTab: (issueId: string, patch: Partial<IssueTab>) => void

  // Backward compat setters
  setSelectedIssue: (issue: LinearIssue | null) => void
  setActiveTab: (tab: TabType) => void
  setTerminalOpen: (open: boolean) => void
  setTerminalSessionId: (id: string | null) => void

  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setIsSyncing: (v: boolean) => void
  setFromCache: (v: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  setStandupOpen: (open: boolean) => void
  setNote: (ticketId: string, note: Note) => void
  setChecklist: (ticketId: string, checklist: Checklist) => void
  setSkills: (ticketId: string, skills: Skill[]) => void
  setProgress: (ticketId: string, progress: Progress) => void
  setEli5: (ticketId: string, content: string) => void
  setEli5Loading: (ticketId: string, loading: boolean) => void
  setProjectConfigs: (configs: ProjectConfig[]) => void
  setTicketBranch: (ticketId: string, branch: string) => void
  setSettingsOpen: (open: boolean) => void
  setDashboardOpen: (open: boolean) => void
  setActiveProjectId: (id: string | null) => void
  setProjectDetails: (projectId: string, details: ProjectDetails) => void
  addRecentIssue: (id: string) => void
}

export const useAppStore = create<AppState>()((set, get) => ({
  projects: [],
  issues: {},
  selectedProjectId: null,
  expandedProjects: loadExpandedFromStorage(),

  tabs: stored.tabs,
  activeTabId: stored.activeTabId,

  // Derived — initialised from persisted tabs, kept in sync by every mutating action
  ...initialDerived,

  projectTabs: [],
  activeProjectTabId: null,

  openProjectTab: (project) =>
    set((state) => {
      const exists = state.projectTabs.find((t) => t.id === project.id)
      if (exists) return { activeProjectTabId: project.id, activeProjectId: project.id, settingsOpen: false, dashboardOpen: false, helpOpen: false }
      return {
        projectTabs: [...state.projectTabs, { id: project.id, name: project.name, color: project.color, tabType: 'project' as const }],
        activeProjectTabId: project.id,
        activeProjectId: project.id,
        settingsOpen: false,
        dashboardOpen: false,
        helpOpen: false,
      }
    }),

  openSettingsTab: () =>
    set((state) => {
      const exists = state.projectTabs.find((t) => t.id === '__settings__')
      if (exists) return { activeTabId: null, activeProjectTabId: '__settings__', settingsOpen: true, dashboardOpen: false, helpOpen: false, activeProjectId: null }
      return {
        projectTabs: [...state.projectTabs, { id: '__settings__', name: 'Settings', tabType: 'settings' as const }],
        activeTabId: null,
        activeProjectTabId: '__settings__',
        settingsOpen: true,
        dashboardOpen: false,
        helpOpen: false,
        activeProjectId: null,
      }
    }),

  openDashboardTab: () =>
    set((state) => {
      const exists = state.projectTabs.find((t) => t.id === '__dashboard__')
      if (exists) return { activeTabId: null, activeProjectTabId: '__dashboard__', dashboardOpen: true, settingsOpen: false, helpOpen: false, activeProjectId: null }
      return {
        projectTabs: [...state.projectTabs, { id: '__dashboard__', name: 'Analytics', tabType: 'dashboard' as const }],
        activeTabId: null,
        activeProjectTabId: '__dashboard__',
        dashboardOpen: true,
        settingsOpen: false,
        helpOpen: false,
        activeProjectId: null,
      }
    }),

  openHelpTab: () =>
    set((state) => {
      const exists = state.projectTabs.find((t) => t.id === '__help__')
      if (exists) return { activeTabId: null, activeProjectTabId: '__help__', helpOpen: true, settingsOpen: false, dashboardOpen: false, activeProjectId: null }
      return {
        projectTabs: [...state.projectTabs, { id: '__help__', name: 'Help', tabType: 'help' as const }],
        activeTabId: null,
        activeProjectTabId: '__help__',
        helpOpen: true,
        settingsOpen: false,
        dashboardOpen: false,
        activeProjectId: null,
      }
    }),

  closeProjectTab: (projectId) =>
    set((state) => {
      const newTabs = state.projectTabs.filter((t) => t.id !== projectId)
      const newActiveProjectTabId =
        state.activeProjectTabId === projectId
          ? newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null
          : state.activeProjectTabId
      const closingTab = state.projectTabs.find((t) => t.id === projectId)
      const nextTab = newTabs.find((t) => t.id === newActiveProjectTabId)
      return {
        projectTabs: newTabs,
        activeProjectTabId: newActiveProjectTabId,
        activeProjectId: nextTab?.tabType === 'project' ? newActiveProjectTabId : null,
        settingsOpen: nextTab?.tabType === 'settings' ? true : closingTab?.tabType === 'settings' ? false : state.settingsOpen,
        dashboardOpen: nextTab?.tabType === 'dashboard' ? true : closingTab?.tabType === 'dashboard' ? false : state.dashboardOpen,
        helpOpen: nextTab?.tabType === 'help' ? true : closingTab?.tabType === 'help' ? false : state.helpOpen,
      }
    }),

  focusProjectTab: (projectId) =>
    set((state) => {
      const tab = state.projectTabs.find((t) => t.id === projectId)
      return {
        activeTabId: null,
        activeProjectTabId: projectId,
        activeProjectId: tab?.tabType === 'project' ? projectId : null,
        settingsOpen: tab?.tabType === 'settings',
        dashboardOpen: tab?.tabType === 'dashboard',
        helpOpen: tab?.tabType === 'help',
      }
    }),

  loading: false,
  error: null,
  isSyncing: false,
  fromCache: false,
  commandPaletteOpen: false,
  settingsOpen: false,
  dashboardOpen: false,
  helpOpen: false,
  standupOpen: false,
  activeProjectId: null,
  projectDetails: {},

  notes: {},
  checklists: {},
  skills: {},
  progress: {},
  eli5Cache: {},
  eli5Loading: {},
  projectConfigs: [],
  ticketBranches: {},
  recentIssueIds: loadRecentIssueIds(),
  notifications: [],

  addNotification: (message) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((state) => ({ notifications: [{ id, message }, ...state.notifications] }))
    setTimeout(() => {
      set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) }))
    }, 4000)
  },

  dismissNotification: (id) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),

  setProjects: (projects) => set({ projects }),
  setIssues: (projectId, issues) =>
    set((state) => ({ issues: { ...state.issues, [projectId]: issues } })),
  setSelectedProjectId: (id) => set({ selectedProjectId: id }),
  toggleProjectExpanded: (projectId) =>
    set((state) => {
      const next = new Set(state.expandedProjects)
      next.has(projectId) ? next.delete(projectId) : next.add(projectId)
      saveExpandedToStorage(next)
      return { expandedProjects: next }
    }),

  openTab: (issue) => {
    set((state) => {
      const existing = state.tabs.find((t) => t.id === issue.id)
      if (existing) {
        saveTabs(state.tabs, issue.id)
        return { activeTabId: issue.id, activeProjectTabId: null, settingsOpen: false, dashboardOpen: false, helpOpen: false, activeProjectId: null, ...derived(state.tabs, issue.id) }
      }
      if (state.tabs.length >= MAX_TABS) return {}
      const newTab: IssueTab = {
        id: issue.id, issue,
        terminalSessionId: null, terminalOpen: false, activeSection: 'detail'
      }
      const newTabs = [...state.tabs, newTab]
      saveTabs(newTabs, issue.id)
      return { tabs: newTabs, activeTabId: issue.id, activeProjectTabId: null, settingsOpen: false, dashboardOpen: false, helpOpen: false, activeProjectId: null, ...derived(newTabs, issue.id) }
    })
    get().addRecentIssue(issue.id)
  },

  closeTab: (issueId) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === issueId)
      if (idx === -1) return {}
      const closedTab = state.tabs[idx]
      // Kill the pty for this tab so we don't orphan a Claude subprocess.
      if (closedTab.terminalSessionId) {
        window.api.terminal.kill(closedTab.terminalSessionId).catch(() => {})
      }
      const newTabs = state.tabs.filter((t) => t.id !== issueId)
      let newActiveTabId = state.activeTabId
      if (state.activeTabId === issueId) {
        newActiveTabId = newTabs.length === 0 ? null
          : idx > 0 ? newTabs[idx - 1].id
          : newTabs[0].id
      }
      saveTabs(newTabs, newActiveTabId)
      return { tabs: newTabs, activeTabId: newActiveTabId, ...derived(newTabs, newActiveTabId) }
    }),

  focusTab: (issueId) =>
    set((state) => {
      saveTabs(state.tabs, issueId)
      return { activeTabId: issueId, activeProjectTabId: null, settingsOpen: false, dashboardOpen: false, helpOpen: false, activeProjectId: null, ...derived(state.tabs, issueId) }
    }),

  updateTab: (issueId, patch) =>
    set((state) => {
      const newTabs = state.tabs.map((t) => t.id === issueId ? { ...t, ...patch } : t)
      saveTabs(newTabs, state.activeTabId)
      return { tabs: newTabs, ...derived(newTabs, state.activeTabId) }
    }),

  setSelectedIssue: (issue) => { if (issue) get().openTab(issue) },
  setActiveTab: (tab) => { const { activeTabId } = get(); if (activeTabId) get().updateTab(activeTabId, { activeSection: tab }) },
  setTerminalOpen: (open) => { const { activeTabId } = get(); if (activeTabId) get().updateTab(activeTabId, { terminalOpen: open }) },
  setTerminalSessionId: (id) => { const { activeTabId } = get(); if (activeTabId) get().updateTab(activeTabId, { terminalSessionId: id }) },

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setIsSyncing: (isSyncing) => set({ isSyncing }),
  setFromCache: (fromCache) => set({ fromCache }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setStandupOpen: (standupOpen) => set({ standupOpen }),
  setNote: (ticketId, note) => set((state) => ({ notes: { ...state.notes, [ticketId]: note } })),
  setChecklist: (ticketId, checklist) => set((state) => ({ checklists: { ...state.checklists, [ticketId]: checklist } })),
  setSkills: (ticketId, skills) => set((state) => ({ skills: { ...state.skills, [ticketId]: skills } })),
  setProgress: (ticketId, progress) => set((state) => ({ progress: { ...state.progress, [ticketId]: progress } })),
  setEli5: (ticketId, content) => set((state) => ({ eli5Cache: { ...state.eli5Cache, [ticketId]: content } })),
  setEli5Loading: (ticketId, loading) => set((state) => ({ eli5Loading: { ...state.eli5Loading, [ticketId]: loading } })),
  setProjectConfigs: (configs) => set({ projectConfigs: configs }),
  setTicketBranch: (ticketId, branch) => set((state) => ({ ticketBranches: { ...state.ticketBranches, [ticketId]: branch } })),
  setSettingsOpen: (open) => { if (open) get().openSettingsTab(); else get().closeProjectTab('__settings__') },
  setDashboardOpen: (open) => { if (open) get().openDashboardTab(); else get().closeProjectTab('__dashboard__') },
  setActiveProjectId: (id) => set({ activeProjectId: id, activeProjectTabId: id, dashboardOpen: false, settingsOpen: false, helpOpen: false }),
  setProjectDetails: (projectId, details) => set((state) => ({ projectDetails: { ...state.projectDetails, [projectId]: details } })),
  addRecentIssue: (id) => set((state) => {
    const next = [id, ...state.recentIssueIds.filter((x) => x !== id)].slice(0, MAX_RECENT)
    saveRecentIssueIds(next)
    return { recentIssueIds: next }
  }),
}))
