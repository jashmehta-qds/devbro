import { spawn } from 'child_process'
import { BrowserWindow } from 'electron'

export function runClaudeStreaming(opts: {
  prompt: string
  callId: string
  win?: BrowserWindow | null
  model?: 'haiku' | 'sonnet' | 'opus'
  cwd?: string
}): Promise<{ ok: boolean; output: string; exitCode: number | null }> {
  const { prompt, callId, win, model = 'haiku', cwd } = opts
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    const claudeEnv = { ...process.env }
    delete claudeEnv.ANTHROPIC_API_KEY

    const child = spawn(shell, ['-l', '-c', `claude --model ${model}`], {
      env: claudeEnv,
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
    })

    let output = ''

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      if (win && !win.isDestroyed()) {
        win.webContents.send('ai:chunk', { callId, text })
      }
    })

    child.stdin.write(prompt)
    child.stdin.end()

    child.on('close', (code) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('ai:done', { callId, output: output.trim(), ok: code === 0 })
      }
      resolve({ ok: code === 0, output: output.trim(), exitCode: code })
    })

    child.on('error', () => {
      resolve({ ok: false, output: '', exitCode: null })
    })
  })
}
