import { useCallback } from 'react'
import { useAppStore } from '../store'

declare global {
  interface Window {
    api: import('../types').WindowApi
  }
}

// ponytail: 60s stale window prevents refresh-spam. Bypass with force=true.
let _lastProjectsFetch = 0
const PROJECTS_STALE_MS = 60_000

export function useLinear() {
  const {
    setProjects,
    setIssues,
    openTab,
    setLoading,
    setError,
    setIsSyncing,
    issues,
    expandedProjects,
    toggleProjectExpanded
  } = useAppStore()

  const loadProjects = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      // 1. Serve from cache immediately
      const cached = await window.api.cache.getProjects()
      if (cached && cached.length > 0) {
        setProjects(cached)
        setLoading(false)
        setIsSyncing(true)

        // Auto-load issues for pre-expanded projects from cache
        const currentExpanded = useAppStore.getState().expandedProjects
        for (const projectId of currentExpanded) {
          const cachedIssues = await window.api.cache.getIssues(projectId)
          if (cachedIssues && cachedIssues.length > 0) {
            useAppStore.getState().setIssues(projectId, cachedIssues)
          }
        }
      }

      if (!force && Date.now() - _lastProjectsFetch < PROJECTS_STALE_MS) {
        setIsSyncing(false)
        return
      }
      _lastProjectsFetch = Date.now()

      // 2. Fetch from Linear in background
      const fresh = await window.api.linear.getProjects()
      setProjects(fresh)
      await window.api.cache.saveProjects(fresh)

      // Refresh issues for all expanded projects from API
      const currentExpanded = useAppStore.getState().expandedProjects
      for (const projectId of currentExpanded) {
        try {
          const freshIssues = await window.api.linear.getIssues(projectId)
          useAppStore.getState().setIssues(projectId, freshIssues)
          await window.api.cache.saveIssues(projectId, freshIssues)
        } catch { /* ignore per-project errors */ }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load projects')
    } finally {
      setLoading(false)
      setIsSyncing(false)
    }
  }, [setProjects, setLoading, setError, setIsSyncing])

  const loadIssues = useCallback(
    async (projectId: string) => {
      // 1. Serve from cache if not loaded yet
      if (!issues[projectId]) {
        try {
          const cached = await window.api.cache.getIssues(projectId)
          if (cached && cached.length > 0) {
            setIssues(projectId, cached)
          }
        } catch {
          // ignore cache errors
        }
      }

      // 2. Always fetch fresh from Linear
      setIsSyncing(true)
      try {
        const fresh = await window.api.linear.getIssues(projectId)
        setIssues(projectId, fresh)
        await window.api.cache.saveIssues(projectId, fresh)
      } catch (err: any) {
        setError(err.message || 'Failed to load issues')
      } finally {
        setIsSyncing(false)
      }
    },
    [issues, setIssues, setError, setIsSyncing]
  )

  const selectIssue = useCallback(
    async (issueId: string) => {
      // Find the issue in the loaded issues first (avoid extra API call)
      const allIssues = Object.values(useAppStore.getState().issues).flat()
      const found = allIssues.find((i) => i.id === issueId)
      if (found) {
        openTab(found)
        return
      }
      setLoading(true)
      try {
        const issue = await window.api.linear.getIssue(issueId)
        openTab(issue)
      } catch (err: any) {
        setError(err.message || 'Failed to load issue')
      } finally {
        setLoading(false)
      }
    },
    [openTab, setLoading, setError]
  )

  const handleProjectClick = useCallback(
    async (projectId: string) => {
      toggleProjectExpanded(projectId)
      if (!expandedProjects.has(projectId)) {
        await loadIssues(projectId)
      }
    },
    [toggleProjectExpanded, expandedProjects, loadIssues]
  )

  return { loadProjects, loadIssues, selectIssue, handleProjectClick }
}
