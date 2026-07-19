import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import path from 'path'
import { shell, BrowserWindow } from 'electron'
import { runClaudeStreaming } from './claudeCli'
import { getDb } from './db'
import { BUILTIN_SKILLS, type BuiltinSkill } from './builtinSkills'

const execFileP = promisify(execFile)

export interface SkillManifest {
  _slug: string
  _dir: string
  name: string
  description: string
  type: 'prompt' | 'command'
  apply_to?: 'terminal' | 'claude_md'
  command?: string
  tags: string[]
  body: string
  installedFromRepo?: string
}

export interface RegistryEntry {
  name: string
  description: string
  repo: string
  author?: string
  tags: string[]
  stars?: number
}

export interface TicketContext {
  ticketId: string
  issue: {
    identifier: string
    title: string
    description?: string
    branch?: string
  }
  repoPath?: string
}

const SLUG_RE = /^[a-zA-Z0-9._-]+$/
const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/jashmehta-qds/devbro-skills/main/registry.json'
const REGISTRY_CACHE_TTL = 10 * 60 * 1000

let registryCache: { at: number; data: RegistryEntry[] } | null = null

export function getSkillsRoot(): string {
  const root = path.join(os.homedir(), '.devbro', 'skills')
  if (!fssync.existsSync(root)) fssync.mkdirSync(root, { recursive: true })
  return root
}

function validSlug(slug: string): boolean {
  if (!slug || slug === '.' || slug === '..' || slug.includes('/') || slug.includes('\\')) return false
  return SLUG_RE.test(slug)
}

export function parseSkillMd(text: string): { frontmatter: any; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { frontmatter: {}, body: text }
  const raw = m[1]
  const body = m[2]
  const fm: any = {}
  const lines = raw.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (!kv) { i++; continue }
    const key = kv[1]
    let val = kv[2].trim()
    if (val === '') {
      const arr: string[] = []
      let j = i + 1
      while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
        const item = lines[j].replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, '')
        arr.push(item)
        j++
      }
      if (arr.length > 0) { fm[key] = arr; i = j; continue }
      fm[key] = ''
      i++
      continue
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim()
      fm[key] = inner === '' ? [] : inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    } else {
      fm[key] = val.replace(/^['"]|['"]$/g, '')
    }
    i++
  }
  return { frontmatter: fm, body }
}

export async function readSkill(slug: string): Promise<SkillManifest | null> {
  if (!validSlug(slug)) return null
  const dir = path.join(getSkillsRoot(), slug)
  const mdPath = path.join(dir, 'SKILL.md')
  let text: string
  try {
    text = await fs.readFile(mdPath, 'utf-8')
  } catch {
    return null
  }
  try {
    const { frontmatter, body } = parseSkillMd(text)
    let installedFromRepo: string | undefined
    try {
      installedFromRepo = (await fs.readFile(path.join(dir, '.devbro-source'), 'utf-8')).trim()
    } catch {}
    return {
      _slug: slug,
      _dir: dir,
      name: String(frontmatter.name ?? slug),
      description: String(frontmatter.description ?? ''),
      type: frontmatter.type === 'command' ? 'command' : 'prompt',
      apply_to: frontmatter.apply_to === 'claude_md' ? 'claude_md' : 'terminal',
      command: frontmatter.command,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      body,
      installedFromRepo,
    }
  } catch {
    return null
  }
}

export async function listSkills(): Promise<SkillManifest[]> {
  const root = getSkillsRoot()
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch {
    return []
  }
  const out: SkillManifest[] = []
  for (const name of entries) {
    if (!validSlug(name)) continue
    const stat = await fs.stat(path.join(root, name)).catch(() => null)
    if (!stat || !stat.isDirectory()) continue
    const m = await readSkill(name)
    if (m) out.push(m)
  }
  return out
}

function slugFromGitUrl(url: string): string {
  const base = url.replace(/\/+$/, '').split('/').pop() || ''
  return base.replace(/\.git$/, '')
}

function serializeBuiltin(b: BuiltinSkill): string {
  const fm = [
    '---',
    `name: ${b.name}`,
    `description: ${b.description}`,
    `type: ${b.type}`,
    b.apply_to ? `apply_to: ${b.apply_to}` : null,
    `tags: [${b.tags.join(', ')}]`,
    '---',
    ''
  ].filter(Boolean).join('\n')
  return fm + '\n' + b.body
}

async function installBuiltin(slug: string): Promise<{ ok: boolean; slug?: string; name?: string; error?: string }> {
  const b = BUILTIN_SKILLS.find((s) => s.slug === slug)
  if (!b) return { ok: false, error: 'unknown builtin' }
  const dir = path.join(getSkillsRoot(), b.slug)
  if (fssync.existsSync(dir)) return { ok: false, error: 'already installed' }
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), serializeBuiltin(b), 'utf-8')
  await fs.writeFile(path.join(dir, '.devbro-source'), `builtin:${b.slug}`, 'utf-8').catch(() => {})
  return { ok: true, slug: b.slug, name: b.name }
}

export async function installFromGit(gitUrl: string): Promise<{ ok: boolean; slug?: string; name?: string; error?: string }> {
  if (typeof gitUrl !== 'string' || !gitUrl.trim()) return { ok: false, error: 'invalid url' }
  const trimmed = gitUrl.trim()
  if (trimmed.startsWith('builtin:')) {
    return installBuiltin(trimmed.slice('builtin:'.length))
  }
  const slug = slugFromGitUrl(trimmed)
  if (!validSlug(slug)) return { ok: false, error: 'invalid slug derived from url' }
  const root = getSkillsRoot()
  const dir = path.join(root, slug)
  if (fssync.existsSync(dir)) return { ok: false, error: 'already installed' }
  try {
    await execFileP('git', ['clone', '--depth', '1', gitUrl, dir], { timeout: 60_000 })
  } catch (err: any) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: err?.stderr?.toString?.() || err?.message || 'git clone failed' }
  }
  if (!fssync.existsSync(path.join(dir, 'SKILL.md'))) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: 'no SKILL.md at repo root' }
  }
  try {
    await fs.writeFile(path.join(dir, '.devbro-source'), gitUrl, 'utf-8')
  } catch {}
  const m = await readSkill(slug)
  if (!m) return { ok: false, error: 'failed to parse SKILL.md' }
  return { ok: true, slug, name: m.name }
}

export async function uninstallSkill(slug: string): Promise<{ ok: boolean; error?: string }> {
  if (!validSlug(slug)) return { ok: false, error: 'invalid slug' }
  const dir = path.join(getSkillsRoot(), slug)
  try {
    await fs.rm(dir, { recursive: true, force: true })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'rm failed' }
  }
}

export async function updateSkill(slug: string): Promise<{ ok: boolean; changed: boolean; error?: string }> {
  if (!validSlug(slug)) return { ok: false, changed: false, error: 'invalid slug' }
  const dir = path.join(getSkillsRoot(), slug)
  try {
    const { stdout } = await execFileP('git', ['-C', dir, 'pull', '--ff-only'], { timeout: 60_000 })
    const changed = !/Already up to date/i.test(stdout)
    return { ok: true, changed }
  } catch (err: any) {
    return { ok: false, changed: false, error: err?.stderr?.toString?.() || err?.message || 'git pull failed' }
  }
}

async function captureGitDiff(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileP('git', ['-C', repoPath, 'diff', 'HEAD'], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })
    const LIMIT = 8 * 1024
    if (stdout.length <= LIMIT) return stdout
    return stdout.slice(0, LIMIT) + '\n… (truncated)'
  } catch {
    return ''
  }
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : ''))
}

export async function applySkill(
  slug: string,
  ctx: TicketContext,
  win: BrowserWindow | null,
): Promise<{ ok: boolean; kind?: string; command?: string; callId?: string; mdPath?: string; error?: string }> {
  const m = await readSkill(slug)
  if (!m) return { ok: false, error: 'skill not found' }

  const baseVars: Record<string, string> = {
    ticket_identifier: ctx.issue?.identifier ?? '',
    ticket_title: ctx.issue?.title ?? '',
    ticket_description: ctx.issue?.description ?? '',
    branch: ctx.issue?.branch ?? '',
    repo_path: ctx.repoPath ?? '',
  }

  const templatesToScan = (m.body || '') + '\n' + (m.command || '')
  const needsDiff = /\{\{\s*git_diff\s*\}\}/.test(templatesToScan)
  const needsDiffPath = /\{\{\s*git_diff_path\s*\}\}/.test(templatesToScan)

  let gitDiff = ''
  if ((needsDiff || needsDiffPath) && ctx.repoPath) {
    gitDiff = await captureGitDiff(ctx.repoPath)
  }
  baseVars.git_diff = gitDiff

  const callId = randomUUID()

  if (needsDiffPath && gitDiff) {
    const p = path.join(os.tmpdir(), `devbro-diff-${callId}.diff`)
    try { await fs.writeFile(p, gitDiff, 'utf-8'); baseVars.git_diff_path = p } catch { baseVars.git_diff_path = '' }
  } else {
    baseVars.git_diff_path = ''
  }

  const db = getDb()
  const recordOutcome = (outcome: string) => {
    try {
      db.prepare('INSERT INTO skill_applications (id, slug, ticket_id, applied_at, outcome) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(), slug, ctx.ticketId || null, Date.now(), outcome
      )
    } catch {}
  }

  if (m.type === 'command') {
    const cmd = substitute(m.command || '', baseVars)
    recordOutcome('ok')
    return { ok: true, kind: 'command', command: cmd }
  }

  const substitutedBody = substitute(m.body || '', baseVars)

  if (m.apply_to === 'claude_md') {
    // ponytail: never touch the repo. Persist to devbro-owned per-ticket extra
    // context — buildContextContent will fold this into the next session's
    // injected prompt.
    const extraDir = path.join(os.homedir(), '.devbro', 'context')
    await fs.mkdir(extraDir, { recursive: true }).catch(() => {})
    const mdPath = path.join(extraDir, `${ctx.ticketId || 'shared'}.md`)
    const header = `\n\n---\n\n# Skill: ${m.name}\n\n`
    try {
      await fs.appendFile(mdPath, header + substitutedBody, 'utf-8')
      recordOutcome('ok')
      return { ok: true, kind: 'claude_md', mdPath }
    } catch (err: any) {
      recordOutcome('error')
      return { ok: false, error: err?.message || 'append failed' }
    }
  }

  runClaudeStreaming({ prompt: substitutedBody, callId, win: win ?? null, model: 'haiku' }).catch(() => {})
  recordOutcome('ok')
  return { ok: true, kind: 'prompt-stream', callId }
}

async function readRegistryUrl(): Promise<string> {
  try {
    const row = getDb().prepare('SELECT value FROM app_config WHERE key = ?').get('skills_registry_url') as any
    if (row?.value) return String(row.value)
  } catch {}
  return DEFAULT_REGISTRY_URL
}

const BUILTIN_REGISTRY_ENTRIES: RegistryEntry[] = BUILTIN_SKILLS.map((b) => ({
  name: b.name,
  description: b.description,
  repo: `builtin:${b.slug}`,
  author: 'devbro',
  tags: b.tags,
}))

function mergeWithBuiltins(remote: RegistryEntry[]): RegistryEntry[] {
  const seen = new Set(remote.map((r) => r.repo))
  return [...remote, ...BUILTIN_REGISTRY_ENTRIES.filter((b) => !seen.has(b.repo))]
}

export async function fetchRegistry(force = false): Promise<{ ok: boolean; skills: RegistryEntry[]; error?: string }> {
  if (!force && registryCache && Date.now() - registryCache.at < REGISTRY_CACHE_TTL) {
    return { ok: true, skills: registryCache.data }
  }
  const url = await readRegistryUrl()
  const diskCachePath = path.join(os.homedir(), '.devbro', 'registry-cache.json')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json: any = await res.json()
    const remote: RegistryEntry[] = Array.isArray(json?.skills) ? json.skills : []
    const skills = mergeWithBuiltins(remote)
    registryCache = { at: Date.now(), data: skills }
    try {
      await fs.mkdir(path.dirname(diskCachePath), { recursive: true })
      await fs.writeFile(diskCachePath, JSON.stringify({ version: 1, skills: remote }), 'utf-8')
    } catch {}
    return { ok: true, skills }
  } catch (err: any) {
    clearTimeout(timer)
    try {
      const disk = JSON.parse(await fs.readFile(diskCachePath, 'utf-8'))
      const remote: RegistryEntry[] = Array.isArray(disk?.skills) ? disk.skills : []
      return { ok: true, skills: mergeWithBuiltins(remote), error: err?.message }
    } catch {
      return { ok: true, skills: BUILTIN_REGISTRY_ENTRIES, error: err?.message || 'fetch failed' }
    }
  }
}

export async function openSkillFolder(slug: string): Promise<{ ok: boolean; error?: string }> {
  if (!validSlug(slug)) return { ok: false, error: 'invalid slug' }
  const dir = path.join(getSkillsRoot(), slug)
  try {
    await shell.openPath(dir)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'open failed' }
  }
}

export async function getSkillBody(slug: string): Promise<string> {
  if (!validSlug(slug)) return ''
  try {
    return await fs.readFile(path.join(getSkillsRoot(), slug, 'SKILL.md'), 'utf-8')
  } catch {
    return ''
  }
}
