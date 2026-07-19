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
const CLOSED_TABS_MAX = 20

let saveTabsTimeout: ReturnType<typeof setTimeout> | null = null

function debounceTabsSave(tabs: IssueTab[]) {
  if (saveTabsTimeout) clearTimeout(saveTabsTimeout)
  saveTabsTimeout = setTimeout(() => {
    window.api.tabs.save(tabs.map((t) => ({ id: t.id, issueData: t.issue, pinned: t.pinned }))).catch(() => {})
  }, 250)
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

const initialDerived = derived([], null)

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

// A live terminal session shown in the app-level bottom drawer.
export interface DrawerSession {
  sessionId: string
  ticketId: string
  label: string            // ticket identifier (or title fallback) for the tab strip
  issue: LinearIssue
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
  closedTabsStack: IssueTab[]

  // Derived from active tab (kept in sync by every action — NOT computed getters)
  selectedIssue: LinearIssue | null
  activeTab: TabType
  terminalOpen: boolean
  terminalSessionId: string | null

  // Project tabs (separate from issue tabs) — also used for Settings/Dashboard tabs
  projectTabs: Array<{ id: string; name: string; color?: string; tabType?: 'project' | 'settings' | 'dashboard' | 'help' | 'skills' }>
  activeProjectTabId: string | null
  openProjectTab: (project: import('./types').LinearProject) => void
  closeProjectTab: (projectId: string) => void
  focusProjectTab: (projectId: string) => void
  openSettingsTab: () => void
  openDashboardTab: () => void
  openHelpTab: () => void
  openSkillsTab: () => void

  // UI state
  loading: boolean
  error: string | null
  isSyncing: boolean
  fromCache: boolean
  commandPaletteOpen: boolean
  settingsOpen: boolean
  dashboardOpen: boolean
  helpOpen: boolean
  skillsOpen: boolean
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

  // Skill output modal (for prompt-stream skills)
  skillOutput: { callId: string; slug: string } | null
  openSkillOutput: (payload: { callId: string; slug: string }) => void
  closeSkillOutput: () => void

  // App-level terminal drawer (bottom, full width). Independent of per-tab state.
  drawerOpen: boolean
  drawerSessions: DrawerSession[]
  activeDrawerSessionId: string | null
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
  addDrawerSession: (s: DrawerSession) => void
  removeDrawerSession: (sessionId: string) => void
  setActiveDrawerSession: (sessionId: string | null) => void

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
  togglePinTab: (issueId: string) => void
  reopenLastClosed: () => void
  initTabs: () => Promise<void>

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

  tabs: [],
  activeTabId: null,
  closedTabsStack: [],

  // Derived — initialised from empty tabs, will be hydrated on mount
  ...initialDerived,

  projectTabs: [],
  activeProjectTabId: null,

  openProjectTab: (project) =>
    set((state) => {
      const exists = state.projectTabs.find((t) => t.id === project.id)
      if (exists) return { activeProjectTabId: project.id, activeProjectId: project.id, settingsOpen: false, dashboardOpen: false, helpOpen: false, skillsOpen: false }
      return {
        projectTabs: [...state.projectTabs, { id: project.id, name: project.name, color: project.color, tabType: 'project' as const }],
        activeProjectTabId: project.id,
        activeProjectId: project.id,
        settingsOpen: false,
        dashboardOpen: false,
        helpOpen: false,
        skillsOpen: false,
      }
    }),

  openSettingsTab: () =>
    set((state) => {
      const exists = state.projectTabs.find((t) => t.id === '__settings__')
      if (exists) return { activeTabId: null, activeProjectTabId: '__settings__', settingsOpen: true, dashboardOpen: false, helpOpen: false, skillsOpen: false, activeProjectId: null }
      return {
        projectTabs: [...state.projectTabs, { id: '__settings__', name: 'Settings', tabType: 'settings' as const }],
        activeTabId: null,
        activeProjectTabId: '__settings__',
        settingsOpen: true,
        dashboardOpen: false,
        helpOpen: false,
        skillsOpen: false,
        activeProjectId: null,
      }
    }),

  openDashboardTab: () =>
    set((state) => {
      const exists = state.projectTabs.find((t) => t.id === '__dashboard__')
      if (exists) return { activeTabId: null, activeProjectTabId: '__dashboard__', dashboardOpen: true, settingsOpen: false, helpOpen: false, skillsOpen: false, activeProjectId: null }
      return {
        projectTabs: [...state.projectTabs, { id: '__dashboard__', name: 'Analytics', tabType: 'dashboard' as const }],
        activeTabId: null,
        activeProjectTabId: '__dashboard__',
        dashboardOpen: true,
        settingsOpen: false,
        helpOpen: false,
        skillsOpen: false,
        activeProjectId: null,
      }
    }),

  openHelpTab: () =>
    set((state) => {
      const exists = state.projectTabs.find((t) => t.id === '__help__')
      if (exists) return { activeTabId: null, activeProjectTabId: '__help__', helpOpen: true, settingsOpen: false, dashboardOpen: false, skillsOpen: false, activeProjectId: null }
      return {
        projectTabs: [...state.projectTabs, { id: '__help__', name: 'Help', tabType: 'help' as const }],
        activeTabId: null,
        activeProjectTabId: '__help__',
        helpOpen: true,
        settingsOpen: false,
        dashboardOpen: false,
        skillsOpen: false,
        activeProjectId: null,
      }
    }),

  openSkillsTab: () =>
    set((state) => {
      const exists = state.projectTabs.find((t) => t.id === '__skills__')
      if (exists) return { activeTabId: null, activeProjectTabId: '__skills__', skillsOpen: true, settingsOpen: false, dashboardOpen: false, helpOpen: false, activeProjectId: null }
      return {
        projectTabs: [...state.projectTabs, { id: '__skills__', name: 'Skills', tabType: 'skills' as const }],
        activeTabId: null,
        activeProjectTabId: '__skills__',
        skillsOpen: true,
        settingsOpen: false,
        dashboardOpen: false,
        helpOpen: false,
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
        skillsOpen: nextTab?.tabType === 'skills' ? true : closingTab?.tabType === 'skills' ? false : state.skillsOpen,
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
        skillsOpen: tab?.tabType === 'skills',
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
  skillsOpen: false,
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

  skillOutput: null,
  openSkillOutput: (payload) => set({ skillOutput: payload }),
  closeSkillOutput: () => set({ skillOutput: null }),

  drawerOpen: false,
  drawerSessions: [],
  activeDrawerSessionId: null,

  setDrawerOpen: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),
  addDrawerSession: (s) =>
    set((state) => {
      const exists = state.drawerSessions.some((d) => d.sessionId === s.sessionId)
      const drawerSessions = exists ? state.drawerSessions : [...state.drawerSessions, s]
      return { drawerSessions, activeDrawerSessionId: s.sessionId, drawerOpen: true }
    }),
  removeDrawerSession: (sessionId) =>
    set((state) => {
      const idx = state.drawerSessions.findIndex((d) => d.sessionId === sessionId)
      if (idx === -1) return {}
      const drawerSessions = state.drawerSessions.filter((d) => d.sessionId !== sessionId)
      let activeDrawerSessionId = state.activeDrawerSessionId
      if (activeDrawerSessionId === sessionId) {
        activeDrawerSessionId = drawerSessions.length === 0 ? null
          : (drawerSessions[idx - 1]?.sessionId ?? drawerSessions[0].sessionId)
      }
      return {
        drawerSessions,
        activeDrawerSessionId,
        drawerOpen: drawerSessions.length === 0 ? false : state.drawerOpen,
      }
    }),
  setActiveDrawerSession: (sessionId) => set({ activeDrawerSessionId: sessionId, drawerOpen: true }),

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
        debounceTabsSave(state.tabs)
        return { activeTabId: issue.id, activeProjectTabId: null, settingsOpen: false, dashboardOpen: false, helpOpen: false, skillsOpen: false, activeProjectId: null, ...derived(state.tabs, issue.id) }
      }
      if (state.tabs.length >= MAX_TABS) return {}
      const newTab: IssueTab = {
        id: issue.id, issue,
        terminalSessionId: null, terminalOpen: false, activeSection: 'detail', pinned: false
      }
      const newTabs = [...state.tabs, newTab]
      debounceTabsSave(newTabs)
      return { tabs: newTabs, activeTabId: issue.id, activeProjectTabId: null, settingsOpen: false, dashboardOpen: false, helpOpen: false, skillsOpen: false, activeProjectId: null, ...derived(newTabs, issue.id) }
    })
    get().addRecentIssue(issue.id)
  },

  closeTab: (issueId) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === issueId)
      if (idx === -1) return {}
      // Kill any live drawer terminal session for this ticket so we don't orphan a Claude subprocess.
      for (const d of state.drawerSessions) {
        if (d.ticketId === issueId) {
          window.api.terminal.kill(d.sessionId).catch(() => {})
        }
      }
      const closedTab = state.tabs[idx]
      const newTabs = state.tabs.filter((t) => t.id !== issueId)
      let newActiveTabId = state.activeTabId
      if (state.activeTabId === issueId) {
        newActiveTabId = newTabs.length === 0 ? null
          : idx > 0 ? newTabs[idx - 1].id
          : newTabs[0].id
      }
      const newClosed = [closedTab, ...state.closedTabsStack].slice(0, CLOSED_TABS_MAX)
      debounceTabsSave(newTabs)
      return { tabs: newTabs, activeTabId: newActiveTabId, closedTabsStack: newClosed, ...derived(newTabs, newActiveTabId) }
    }),

  focusTab: (issueId) =>
    set((state) => {
      debounceTabsSave(state.tabs)
      return { activeTabId: issueId, activeProjectTabId: null, settingsOpen: false, dashboardOpen: false, helpOpen: false, skillsOpen: false, activeProjectId: null, ...derived(state.tabs, issueId) }
    }),

  updateTab: (issueId, patch) =>
    set((state) => {
      const newTabs = state.tabs.map((t) => t.id === issueId ? { ...t, ...patch } : t)
      debounceTabsSave(newTabs)
      return { tabs: newTabs, ...derived(newTabs, state.activeTabId) }
    }),

  togglePinTab: (issueId) =>
    set((state) => {
      const newTabs = state.tabs.map((t) => t.id === issueId ? { ...t, pinned: !t.pinned } : t)
      // Sort: pinned first, then by original order
      const sorted = newTabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
      debounceTabsSave(sorted)
      return { tabs: sorted }
    }),

  reopenLastClosed: () =>
    set((state) => {
      if (state.closedTabsStack.length === 0) return {}
      const [toReopen, ...rest] = state.closedTabsStack
      const newTabs = [...state.tabs, toReopen]
      debounceTabsSave(newTabs)
      return { tabs: newTabs, activeTabId: toReopen.id, closedTabsStack: rest, activeProjectTabId: null, settingsOpen: false, dashboardOpen: false, helpOpen: false, skillsOpen: false, activeProjectId: null, ...derived(newTabs, toReopen.id) }
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
  setActiveProjectId: (id) => set({ activeProjectId: id, activeProjectTabId: id, dashboardOpen: false, settingsOpen: false, helpOpen: false, skillsOpen: false }),
  setProjectDetails: (projectId, details) => set((state) => ({ projectDetails: { ...state.projectDetails, [projectId]: details } })),
  addRecentIssue: (id) => set((state) => {
    const next = [id, ...state.recentIssueIds.filter((x) => x !== id)].slice(0, MAX_RECENT)
    saveRecentIssueIds(next)
    return { recentIssueIds: next }
  }),

  initTabs: async () => {
    try {
      const loaded = await window.api.tabs.load()
      const tabs: IssueTab[] = loaded.map((t: any) => ({
        id: t.id,
        issue: t.issueData,
        terminalSessionId: null,
        terminalOpen: false,
        activeSection: 'detail' as TabType,
        pinned: t.pinned || false
      }))
      const firstId = tabs.length > 0 ? tabs[0].id : null
      set({ tabs, activeTabId: firstId, ...derived(tabs, firstId) })
    } catch {
      // Silently fail if tabs loading isn't ready yet
    }
  },
}))
