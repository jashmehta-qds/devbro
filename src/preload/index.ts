import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  linear: {
    getProjects: () => ipcRenderer.invoke('linear:getProjects'),
    getIssues: (projectId: string) => ipcRenderer.invoke('linear:getIssues', projectId),
    getIssue: (issueId: string) => ipcRenderer.invoke('linear:getIssue', issueId),
    getIssueStates: (issueId: string) => ipcRenderer.invoke('linear:getIssueStates', issueId),
    updateStatus: (issueId: string, stateId: string, fromStateName: string, toStateName: string) =>
      ipcRenderer.invoke('linear:updateStatus', issueId, stateId, fromStateName, toStateName),
    getCycles: () => ipcRenderer.invoke('linear:getCycles'),
    onIssueUpdated: (callback: (issue: any) => void) => {
      const listener = (_event: any, issue: any) => callback(issue)
      ipcRenderer.on('linear:issueUpdated', listener)
      return () => ipcRenderer.removeListener('linear:issueUpdated', listener)
    },
  },

  tabs: {
    setOpen: (tabIds: string[]) => ipcRenderer.invoke('tabs:setOpen', tabIds),
  },

  notes: {
    get: (ticketId: string) => ipcRenderer.invoke('notes:get', ticketId),
    save: (ticketId: string, content: string) => ipcRenderer.invoke('notes:save', ticketId, content)
  },

  checklist: {
    get: (ticketId: string) => ipcRenderer.invoke('checklist:get', ticketId),
    save: (ticketId: string, items: any[]) => ipcRenderer.invoke('checklist:save', ticketId, items)
  },

  skills: {
    list: (ticketId: string) => ipcRenderer.invoke('skills:list', ticketId),
    add: (ticketId: string, name: string, command: string) =>
      ipcRenderer.invoke('skills:add', ticketId, name, command),
    delete: (skillId: string) => ipcRenderer.invoke('skills:delete', skillId)
  },

  progress: {
    get: (ticketId: string) => ipcRenderer.invoke('progress:get', ticketId),
    update: (ticketId: string, percent: number, log?: string) =>
      ipcRenderer.invoke('progress:update', ticketId, percent, log),
    generateManual: (ticketId: string) => ipcRenderer.invoke('progress:generateManual', ticketId),
    onUpdated: (callback: (payload: { ticketId: string; summary: string; newPercent: number }) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('progress:updated', listener)
      return () => ipcRenderer.removeListener('progress:updated', listener)
    },
  },

  eli5: {
    get: (ticketId: string) => ipcRenderer.invoke('eli5:get', ticketId),
    generate: (ticketId: string, title: string, description: string) =>
      ipcRenderer.invoke('eli5:generate', ticketId, title, description)
  },

  projectConfig: {
    getAll: () => ipcRenderer.invoke('projectConfig:getAll'),
    save: (linearProjectId: string, linearProjectName: string, githubRepo: string, defaultBranch: string, localRepo: string) =>
      ipcRenderer.invoke('projectConfig:save', linearProjectId, linearProjectName, githubRepo, defaultBranch, localRepo),
    delete: (linearProjectId: string) => ipcRenderer.invoke('projectConfig:delete', linearProjectId),
  },

  repos: {
    list: () => ipcRenderer.invoke('repos:list'),
  },

  projectRepos: {
    list: (linearProjectId: string) => ipcRenderer.invoke('projectRepos:list', linearProjectId),
    add: (linearProjectId: string, repoName: string) => ipcRenderer.invoke('projectRepos:add', linearProjectId, repoName),
    remove: (repoId: string) => ipcRenderer.invoke('projectRepos:remove', repoId),
    getForProject: (linearProjectId: string) => ipcRenderer.invoke('projectRepos:getForProject', linearProjectId),
  },

  ticketBranch: {
    get: (ticketId: string) => ipcRenderer.invoke('ticketBranch:get', ticketId),
    save: (ticketId: string, branchName: string) => ipcRenderer.invoke('ticketBranch:save', ticketId, branchName),
  },

  terminal: {
    create: (ticketId: string, issueData: any, cols: number, rows: number, repoName?: string) =>
      ipcRenderer.invoke('terminal:create', ticketId, issueData, cols, rows, repoName),
    write: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    kill: (sessionId: string) => ipcRenderer.invoke('terminal:kill', sessionId),
    attach: (sessionId: string) => ipcRenderer.invoke('terminal:attach', sessionId),
    detach: (sessionId: string) => ipcRenderer.invoke('terminal:detach', sessionId),

    onData: (sessionId: string, callback: (data: string) => void) => {
      const channel = `terminal:data:${sessionId}`
      const listener = (_event: any, data: string) => callback(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },

    onExit: (sessionId: string, callback: (code: number) => void) => {
      const channel = `terminal:exit:${sessionId}`
      const listener = (_event: any, code: number) => callback(code)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },

    onAnyExit: (callback: (payload: { sessionId: string; code: number; evicted: boolean }) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('terminal:anyExit', listener)
      return () => ipcRenderer.removeListener('terminal:anyExit', listener)
    }
  },

  cache: {
    getProjects: () => ipcRenderer.invoke('cache:getProjects'),
    saveProjects: (projects: any[]) => ipcRenderer.invoke('cache:saveProjects', projects),
    getIssues: (projectId: string) => ipcRenderer.invoke('cache:getIssues', projectId),
    saveIssues: (projectId: string, issues: any[]) => ipcRenderer.invoke('cache:saveIssues', projectId, issues),
  },

  window: {
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  analytics: {
    getDashboard: () => ipcRenderer.invoke('analytics:getDashboard'),
  },

  git: {
    getBranchInfo: (repoPath: string) => ipcRenderer.invoke('git:getBranchInfo', repoPath),
  },

  project: {
    getDetails: (projectId: string) => ipcRenderer.invoke('project:getDetails', projectId),
    refreshDetails: (projectId: string) => ipcRenderer.invoke('project:refreshDetails', projectId),
  },

  context: {
    refresh: () => ipcRenderer.invoke('context:refresh'),
    preview: (ticketId: string, issueData: any, repoName?: string) =>
      ipcRenderer.invoke('context:preview', ticketId, issueData, repoName),
    refreshForSession: (sessionId: string, ticketId: string, issueData: any) =>
      ipcRenderer.invoke('context:refreshForSession', sessionId, ticketId, issueData),
  },

  projectSkills: {
    list: (projectId: string) => ipcRenderer.invoke('projectSkills:list', projectId),
    add: (projectId: string, name: string, command: string) =>
      ipcRenderer.invoke('projectSkills:add', projectId, name, command),
    delete: (skillId: string) => ipcRenderer.invoke('projectSkills:delete', skillId),
  },

  globalSkills: {
    list: () => ipcRenderer.invoke('globalSkills:list'),
    add: (name: string, command: string) => ipcRenderer.invoke('globalSkills:add', name, command),
    delete: (skillId: string) => ipcRenderer.invoke('globalSkills:delete', skillId),
  },

  standup: {
    generate: () => ipcRenderer.invoke('standup:generate'),
  },

  connector: {
    getAll: () => ipcRenderer.invoke('connector:getAll'),
    getActive: () => ipcRenderer.invoke('connector:getActive'),
    setActive: (type: string, config: Record<string, string>) =>
      ipcRenderer.invoke('connector:setActive', type, config),
    test: (type: string, config: Record<string, string>) =>
      ipcRenderer.invoke('connector:test', type, config),
  },

  appConfig: {
    get: (key: string) => ipcRenderer.invoke('appConfig:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('appConfig:set', key, value),
  },

  memory: {
    onWarn: (callback: (payload: { totalMB: number; limitMB: number }) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('app:memoryWarn', listener)
      return () => ipcRenderer.removeListener('app:memoryWarn', listener)
    },
    onKill: (callback: (payload: { totalMB: number; limitMB: number }) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('app:memoryKill', listener)
      return () => ipcRenderer.removeListener('app:memoryKill', listener)
    },
  },

  ai: {
    onChunk: (callback: (payload: { callId: string; text: string }) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('ai:chunk', listener)
      return () => ipcRenderer.removeListener('ai:chunk', listener)
    },
    onDone: (callback: (payload: { callId: string; output: string; ok: boolean }) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('ai:done', listener)
      return () => ipcRenderer.removeListener('ai:done', listener)
    },
  },
})
