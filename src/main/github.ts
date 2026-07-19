import { execSync } from 'child_process'
import { getDb } from './db'

const GH_API = 'https://api.github.com'

function getPat(): string {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get('github_pat') as any
  if (!row?.value) throw new Error('GitHub PAT not configured')
  return row.value
}

async function ghFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const pat = getPat()
  return fetch(`${GH_API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  })
}

export async function testAuth(): Promise<{ ok: boolean; user?: string }> {
  try {
    const res = await ghFetch('/user')
    if (!res.ok) return { ok: false }
    const data = await res.json() as any
    return { ok: true, user: data.login }
  } catch {
    return { ok: false }
  }
}

export function getRepoFromRemote(repoPath: string): { owner: string; name: string } | null {
  try {
    const expanded = repoPath.replace(/^~/, process.env.HOME || require('os').homedir())
    const raw = execSync('git remote get-url origin', { cwd: expanded, timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    // Only GitHub remotes
    if (!raw.includes('github.com')) return null
    // SSH: git@github.com:owner/repo.git
    const sshMatch = raw.match(/git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (sshMatch) return { owner: sshMatch[1], name: sshMatch[2] }
    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = raw.match(/https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (httpsMatch) return { owner: httpsMatch[1], name: httpsMatch[2] }
    return null
  } catch {
    return null
  }
}

export async function findPrForBranch(
  owner: string,
  name: string,
  branch: string
): Promise<{ number: number; url: string; state: string; title: string; headRef: string; mergedAt: string | null; headSha: string } | null> {
  try {
    // Try head filter first
    const res = await ghFetch(`/repos/${owner}/${name}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=all&per_page=1`)
    if (!res.ok) return null
    const prs = await res.json() as any[]
    if (prs.length > 0) {
      const pr = prs[0]
      return {
        number: pr.number,
        url: pr.html_url,
        state: pr.state,
        title: pr.title,
        headRef: pr.head?.ref,
        mergedAt: pr.merged_at ?? null,
        headSha: pr.head?.sha ?? '',
      }
    }
    return null
  } catch {
    return null
  }
}

export async function getPrChecks(
  owner: string,
  name: string,
  headSha: string
): Promise<{ status: 'passing' | 'failing' | 'pending' | 'none'; total: number; passed: number }> {
  if (!headSha) return { status: 'none', total: 0, passed: 0 }
  try {
    const res = await ghFetch(`/repos/${owner}/${name}/commits/${headSha}/check-runs?per_page=100`)
    if (!res.ok) return { status: 'none', total: 0, passed: 0 }
    const data = await res.json() as any
    const runs: any[] = data.check_runs ?? []
    if (runs.length === 0) return { status: 'none', total: 0, passed: 0 }
    const total = runs.length
    const passed = runs.filter(r => r.conclusion === 'success' || r.conclusion === 'skipped').length
    const failed = runs.filter(r => r.conclusion === 'failure' || r.conclusion === 'cancelled' || r.conclusion === 'timed_out').length
    const pending = runs.filter(r => r.status !== 'completed').length
    let status: 'passing' | 'failing' | 'pending'
    if (failed > 0) status = 'failing'
    else if (pending > 0) status = 'pending'
    else status = 'passing'
    return { status, total, passed }
  } catch {
    return { status: 'none', total: 0, passed: 0 }
  }
}

export async function createPr(
  owner: string,
  name: string,
  opts: { title: string; body: string; head: string; base: string }
): Promise<{ number: number; url: string }> {
  const res = await ghFetch(`/repos/${owner}/${name}/pulls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: opts.title, body: opts.body, head: opts.head, base: opts.base }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err?.message || `GitHub API error ${res.status}`)
  }
  const pr = await res.json() as any
  return { number: pr.number, url: pr.html_url }
}
