import { app, BrowserWindow } from 'electron'
import { killAllTerminals } from './pty'

// Hard cap on combined working-set memory across all Electron processes
// (main + renderer + GPU + utility). When exceeded, we kill all ptys, tell
// the renderer we're going down, then quit + force-exit so the dev server
// doesn't keep dragging the machine to its knees.
const DEFAULT_LIMIT_MB = 12 * 1024 // 12 GB
const WARN_FRACTION = 0.8           // notify at 80% of limit
const CHECK_INTERVAL_MS = 10_000

let pollTimer: ReturnType<typeof setInterval> | null = null
let warned = false

function totalWorkingSetMB(): number {
  // getAppMetrics().memory.workingSetSize is in KB.
  let kb = 0
  for (const m of app.getAppMetrics()) {
    kb += m.memory?.workingSetSize ?? 0
  }
  return Math.round(kb / 1024)
}

export function startMemoryWatchdog(win: BrowserWindow, limitMB: number = DEFAULT_LIMIT_MB): void {
  if (pollTimer) return
  console.log(`[watchdog] Memory limit: ${limitMB} MB (warn at ${Math.round(limitMB * WARN_FRACTION)} MB)`)

  pollTimer = setInterval(() => {
    let totalMB: number
    try { totalMB = totalWorkingSetMB() } catch { return }

    if (totalMB >= limitMB) {
      console.error(`[watchdog] Memory ${totalMB} MB ≥ limit ${limitMB} MB — killing terminals and quitting`)
      try { killAllTerminals() } catch {}
      if (!win.isDestroyed()) {
        try { win.webContents.send('app:memoryKill', { totalMB, limitMB }) } catch {}
      }
      // Give the renderer ~250ms to see the notification, then hard exit so
      // the npm/electron-vite parent process actually goes down too.
      setTimeout(() => {
        try { app.quit() } catch {}
        setTimeout(() => process.exit(137), 500)
      }, 250)
      return
    }

    const warnThreshold = limitMB * WARN_FRACTION
    if (totalMB >= warnThreshold && !warned) {
      warned = true
      console.warn(`[watchdog] Memory ${totalMB} MB ≥ ${Math.round(warnThreshold)} MB (80% of cap)`)
      if (!win.isDestroyed()) {
        try { win.webContents.send('app:memoryWarn', { totalMB, limitMB }) } catch {}
      }
    } else if (totalMB < warnThreshold * 0.9) {
      // Reset warning once we drop back comfortably below the warn line
      warned = false
    }
  }, CHECK_INTERVAL_MS)
}

export function stopMemoryWatchdog(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
