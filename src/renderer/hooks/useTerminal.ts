import { useCallback } from 'react'
import { useAppStore } from '../store'

/**
 * Terminal lifecycle helpers for the app-level bottom drawer.
 *
 * A terminal session is created via `terminal.create` (preserving the exact
 * CLAUDE.md / cols / rows / repoName flow) and registered as a DrawerSession.
 * The backend enforces the concurrent-session cap and broadcasts evictions via
 * `terminal.onAnyExit`; App.tsx listens and drops dead sessions from the drawer.
 */
export function useTerminal() {
  const store = useAppStore()

  const openTerminal = useCallback(
    async (cols: number = 80, rows: number = 30, repoName?: string) => {
      const { selectedIssue, drawerSessions, setActiveDrawerSession } = useAppStore.getState()
      if (!selectedIssue) return undefined

      // If a live session already exists for this ticket, just focus it.
      const existing = drawerSessions.find((d) => d.ticketId === selectedIssue.id)
      if (existing) {
        setActiveDrawerSession(existing.sessionId)
        return existing.sessionId
      }

      try {
        const sessionId = await window.api.terminal.create(
          selectedIssue.id,
          selectedIssue,
          cols,
          rows,
          repoName
        )

        useAppStore.getState().addDrawerSession({
          sessionId,
          ticketId: selectedIssue.id,
          label: selectedIssue.identifier || selectedIssue.title.slice(0, 12),
          issue: selectedIssue,
        })

        // Bootstrap a progress entry on exit if none exists yet.
        const unsubExit = window.api.terminal.onExit(sessionId, (code) => {
          const currentProgress = useAppStore.getState().progress[selectedIssue.id]
          if (!currentProgress || currentProgress.percent === 0) {
            window.api.progress
              .update(selectedIssue.id, 10, `Claude session exited with code ${code}`)
              .then((p) => {
                if (p) useAppStore.getState().setProgress(selectedIssue.id, p as any)
              })
              .catch(() => {})
          }
          unsubExit()
        })

        return sessionId
      } catch (err) {
        console.error('Failed to create terminal:', err)
        useAppStore.getState().addNotification('Failed to open terminal')
        return undefined
      }
    },
    []
  )

  // Close the drawer without killing ptys (detach semantics live in the panel).
  const closeTerminal = useCallback(async () => {
    useAppStore.getState().setDrawerOpen(false)
  }, [])

  // Send a command to the current ticket's terminal session, creating one if needed.
  const runCommand = useCallback(async (command: string) => {
    const { selectedIssue, drawerSessions, setActiveDrawerSession } = useAppStore.getState()
    if (!selectedIssue) return
    let session = drawerSessions.find((d) => d.ticketId === selectedIssue.id)
    if (!session) {
      const sid = await openTerminal()
      if (!sid) return
      session = useAppStore.getState().drawerSessions.find((d) => d.sessionId === sid)
    }
    if (session) {
      setActiveDrawerSession(session.sessionId)
      await window.api.terminal.write(session.sessionId, command + '\n')
    }
  }, [openTerminal])

  const killSession = useCallback(async (sessionId: string) => {
    try {
      await window.api.terminal.kill(sessionId)
    } catch {
      // ignore
    }
    // onAnyExit will remove it from the drawer; remove eagerly too for snappiness.
    useAppStore.getState().removeDrawerSession(sessionId)
  }, [])

  return {
    openTerminal,
    closeTerminal,
    killSession,
    runCommand,
    toggleDrawer: store.toggleDrawer,
  }
}
