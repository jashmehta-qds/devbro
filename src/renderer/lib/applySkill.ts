import { useAppStore } from '../store'
import type { TicketContext } from '../types'

// Applies an installed skill and routes the result based on kind.
// Terminal writes go to the active session; if none, the caller-supplied
// runCommand fallback auto-opens and writes. Prompt-stream opens the output
// modal via store; claude_md surfaces a toast.
export async function applySkillAndRoute(
  slug: string,
  ctx: TicketContext,
  runCommand?: (cmd: string) => Promise<void>,
): Promise<void> {
  const store = useAppStore.getState()
  try {
    const res = await window.api.skillPkg.apply(slug, ctx)
    if (!res.ok) {
      store.addNotification(`Skill apply failed: ${res.error ?? 'unknown'}`)
      return
    }
    if (res.kind === 'command' && res.command) {
      const sid = store.terminalSessionId
      if (sid) await window.api.terminal.write(sid, res.command + '\n')
      else if (runCommand) await runCommand(res.command)
      else store.addNotification('Open a terminal to run this skill')
    } else if (res.kind === 'prompt-stream' && res.callId) {
      store.openSkillOutput({ callId: res.callId, slug })
    } else if (res.kind === 'claude_md') {
      store.addNotification('Skill added to CLAUDE.md — will apply on next launch')
    }
  } catch (err: any) {
    store.addNotification(`Skill apply failed: ${err?.message ?? err}`)
  }
}
