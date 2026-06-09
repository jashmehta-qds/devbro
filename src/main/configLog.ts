import fs from 'fs'
import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'

const CONFIG_DIR = path.join(os.homedir(), '.dev-dashboard')
const CONFIG_FILE = path.join(CONFIG_DIR, 'global-context.md')

export function writeGlobalConfigFile(db: Database.Database): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })

  const projects = db.prepare('SELECT * FROM project_configs ORDER BY linear_project_name').all() as any[]
  const branches = db.prepare('SELECT * FROM ticket_branches ORDER BY updated_at DESC LIMIT 50').all() as any[]

  const lines: string[] = [
    '# Dev Dashboard — Global Configuration',
    '',
    `> Last updated: ${new Date().toISOString()}`,
    '',
    '## Project Mappings',
    '',
  ]

  if (projects.length === 0) {
    lines.push('_No project mappings configured yet._')
  } else {
    for (const p of projects) {
      const repos = db.prepare('SELECT repo_name FROM project_repos WHERE linear_project_id = ? ORDER BY created_at ASC').all(p.linear_project_id) as any[]
      lines.push(`### ${p.linear_project_name}`)
      if (repos.length > 0) {
        lines.push(`- Local Repos:`)
        for (const r of repos) {
          lines.push(`  - ${path.join(os.homedir(), 'Work', r.repo_name)}`)
        }
      } else if (p.local_repo) {
        lines.push(`- Local Repo: ${path.join(os.homedir(), 'Work', p.local_repo)}`)
      }
      if (p.github_repo) lines.push(`- GitHub: ${p.github_repo}`)
      lines.push(`- Default Branch: ${p.default_branch || 'main'}`)

      // Add description and milestones from cache if available
      const detailsRow = db.prepare('SELECT data FROM project_details_cache WHERE id = ?').get(p.linear_project_id) as any
      if (detailsRow) {
        const details = JSON.parse(detailsRow.data)
        if (details.description) {
          lines.push(`- Summary: ${details.description}`)
        }
        if (details.content) {
          lines.push(`- Description:`)
          lines.push(details.content.split('\n').map((l: string) => `  ${l}`).join('\n'))
        }
        if (details.state) {
          lines.push(`- State: ${details.state}`)
        }
        if (details.targetDate) {
          lines.push(`- Target Date: ${details.targetDate}`)
        }
        if (details.milestones?.length > 0) {
          lines.push(`- Milestones:`)
          for (const m of details.milestones) {
            const dateStr = m.targetDate ? ` (due: ${m.targetDate})` : ''
            lines.push(`  - ${m.name}${dateStr}`)
            if (m.description) lines.push(`    ${m.description}`)
          }
        }
      }

      lines.push('')
    }
  }

  lines.push('## Recent Ticket Branches', '')
  if (branches.length === 0) {
    lines.push('_No branches tracked yet._')
  } else {
    for (const b of branches) {
      lines.push(`- ${b.ticket_id}: \`${b.branch_name}\``)
    }
  }

  lines.push('')
  fs.writeFileSync(CONFIG_FILE, lines.join('\n'), 'utf-8')
}

export { CONFIG_FILE }
