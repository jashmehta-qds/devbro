import { useCallback, useRef } from 'react'
import { useAppStore } from '../store'
import type { Terminal } from '@xterm/xterm'

export function useTerminal() {
  const store = useAppStore()
  const xtermRef = useRef<Terminal | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Derive active tab info from store
  const activeTabId = store.activeTabId
  const selectedIssue = store.selectedIssue
  const terminalSessionId = store.terminalSessionId
  const progress = store.progress

  const openTerminal = useCallback(
    async (cols: number = 80, rows: number = 30, repoName?: string) => {
      if (!selectedIssue) return

      // Kill existing session if any
      if (terminalSessionId) {
        try {
          await window.api.terminal.kill(terminalSessionId)
        } catch {
          // ignore
        }
        if (cleanupRef.current) {
          cleanupRef.current()
          cleanupRef.current = null
        }
      }

      try {
        const sessionId = await window.api.terminal.create(
          selectedIssue.id,
          selectedIssue,
          cols,
          rows,
          repoName
        )

        if (activeTabId) {
          store.updateTab(activeTabId, { terminalSessionId: sessionId, terminalOpen: true })
        }

        // Subscribe to terminal exit only
        const unsubExit = window.api.terminal.onExit(sessionId, (code) => {
          const currentProgress = progress[selectedIssue.id]
          if (!currentProgress || currentProgress.percent === 0) {
            window.api.progress
              .update(selectedIssue.id, 10, `Claude session exited with code ${code}`)
              .then((p) => {
                if (p) store.setProgress(selectedIssue.id, p as any)
              })
              .catch(() => {})
          }
          unsubExit()
          cleanupRef.current = null
        })

        cleanupRef.current = () => {
          unsubExit()
        }

        return sessionId
      } catch (err) {
        console.error('Failed to create terminal:', err)
      }
    },
    [selectedIssue, terminalSessionId, progress, activeTabId, store]
  )

  const closeTerminal = useCallback(async () => {
    if (terminalSessionId) {
      try {
        await window.api.terminal.kill(terminalSessionId)
      } catch {
        // ignore
      }
    }
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    if (xtermRef.current) {
      xtermRef.current.clear()
    }
    if (activeTabId) {
      store.updateTab(activeTabId, { terminalSessionId: null, terminalOpen: false })
    }
  }, [terminalSessionId, activeTabId, store])

  const writeToTerminal = useCallback(
    async (data: string) => {
      if (terminalSessionId) {
        await window.api.terminal.write(terminalSessionId, data)
      }
    },
    [terminalSessionId]
  )

  const resizeTerminal = useCallback(
    async (cols: number, rows: number) => {
      if (terminalSessionId) {
        await window.api.terminal.resize(terminalSessionId, cols, rows)
      }
    },
    [terminalSessionId]
  )

  const runCommand = useCallback(
    async (command: string) => {
      let sid = terminalSessionId
      if (!sid) {
        sid = (await openTerminal()) ?? null
      }
      if (sid) {
        await window.api.terminal.write(sid, command + '\n')
      }
    },
    [terminalSessionId, openTerminal]
  )

  return {
    xtermRef,
    openTerminal,
    closeTerminal,
    writeToTerminal,
    resizeTerminal,
    runCommand
  }
}
