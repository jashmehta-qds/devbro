import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import { app } from 'electron'
import fs from 'fs'

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    const userDataPath = app.getPath('userData')
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true })
    }
    const dbPath = path.join(userDataPath, 'dev-dashboard.db')

    // If new DB doesn't exist yet, check for old location (app was renamed dev-dashboard → devbro)
    // and copy it over so existing notes/data are preserved
    if (!fs.existsSync(dbPath)) {
      const oldUserDataPath = path.join(path.dirname(userDataPath), 'dev-dashboard')
      const oldDbPath = path.join(oldUserDataPath, 'dev-dashboard.db')
      if (fs.existsSync(oldDbPath)) {
        try {
          fs.copyFileSync(oldDbPath, dbPath)
          // Also copy WAL/SHM if present so we don't lose uncommitted data
          if (fs.existsSync(oldDbPath + '-wal')) fs.copyFileSync(oldDbPath + '-wal', dbPath + '-wal')
          if (fs.existsSync(oldDbPath + '-shm')) fs.copyFileSync(oldDbPath + '-shm', dbPath + '-shm')
          console.log('[db] Migrated database from dev-dashboard to devbro userData')
        } catch (e) {
          console.error('[db] Failed to migrate old database:', e)
        }
      }
    }

    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    migrate(db)
  }
  return db
}

const MIGRATIONS: Array<{ v: number; sql: string }> = [
  {
    v: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_ticket_id ON notes(ticket_id);
    `,
  },
  {
    v: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS checklists (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        items TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checklists_ticket_id ON checklists(ticket_id);
    `,
  },
  {
    v: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skills_ticket_id ON skills(ticket_id);
    `,
  },
  {
    v: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS progress (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        percent INTEGER NOT NULL DEFAULT 0,
        log TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_progress_ticket_id ON progress(ticket_id);
    `,
  },
  {
    v: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS eli5_cache (
        ticket_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    v: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS project_configs (
        linear_project_id TEXT PRIMARY KEY,
        linear_project_name TEXT NOT NULL,
        github_repo TEXT NOT NULL DEFAULT '',
        default_branch TEXT NOT NULL DEFAULT 'main',
        local_repo TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    v: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS ticket_branches (
        ticket_id TEXT PRIMARY KEY,
        branch_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    v: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS ticket_claude_sessions (
        ticket_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    v: 9,
    sql: `
      CREATE TABLE IF NOT EXISTS project_repos (
        id TEXT PRIMARY KEY,
        linear_project_id TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_repos_project_id ON project_repos(linear_project_id);
    `,
  },
  {
    v: 10,
    sql: `
      CREATE TABLE IF NOT EXISTS project_skills (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_skills_project ON project_skills(project_id);
    `,
  },
  {
    v: 11,
    sql: `
      CREATE TABLE IF NOT EXISTS global_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    v: 12,
    sql: `
      CREATE TABLE IF NOT EXISTS projects_cache (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
    `,
  },
  {
    v: 13,
    sql: `
      CREATE TABLE IF NOT EXISTS issues_cache (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_issues_cache_project ON issues_cache(project_id);
    `,
  },
  {
    v: 14,
    sql: `
      CREATE TABLE IF NOT EXISTS project_details_cache (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
    `,
  },
  {
    v: 15,
    sql: `
      CREATE TABLE IF NOT EXISTS time_sessions (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        notes TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_time_sessions_ticket ON time_sessions(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_time_sessions_started ON time_sessions(started_at);
    `,
  },
  {
    v: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS status_changes (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        changed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_status_changes_ticket ON status_changes(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_status_changes_date ON status_changes(changed_at);
    `,
  },
  {
    v: 17,
    sql: `
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    v: 18,
    sql: `
      CREATE TABLE IF NOT EXISTS connectors (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}'
      );
    `,
  },
  {
    v: 19,
    sql: '', // handled specially in migrate() via columnExists(); sql field unused for this version
  },
  {
    v: 20,
    sql: '', // handled specially — adds columns to time_sessions via columnExists
  },
]

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some(col => col.name === column)
}

function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)`)
  const row = db.prepare('SELECT COALESCE(MAX(version),0) as v FROM _schema_version').get() as { v: number }
  const current = row.v

  for (const m of MIGRATIONS.filter(m => m.v > current)) {
    if (m.v === 19) {
      db.transaction(() => {
        if (!columnExists(db, 'project_configs', 'local_repo')) {
          db.exec(`ALTER TABLE project_configs ADD COLUMN local_repo TEXT NOT NULL DEFAULT ''`)
        }
        db.prepare('INSERT OR IGNORE INTO _schema_version VALUES (?)').run(m.v)
      })()
    } else if (m.v === 20) {
      db.transaction(() => {
        if (!columnExists(db, 'time_sessions', 'git_start_sha')) {
          db.exec(`ALTER TABLE time_sessions ADD COLUMN git_start_sha TEXT`)
        }
        if (!columnExists(db, 'time_sessions', 'exit_code')) {
          db.exec(`ALTER TABLE time_sessions ADD COLUMN exit_code INTEGER`)
        }
        if (!columnExists(db, 'time_sessions', 'summary')) {
          db.exec(`ALTER TABLE time_sessions ADD COLUMN summary TEXT`)
        }
        db.prepare('INSERT OR IGNORE INTO _schema_version VALUES (?)').run(m.v)
      })()
    } else {
      db.transaction(() => {
        db.exec(m.sql)
        db.prepare('INSERT OR IGNORE INTO _schema_version VALUES (?)').run(m.v)
      })()
    }
  }

  const existing = db.prepare('SELECT id FROM connectors WHERE id = ?').get('linear')
  if (!existing && process.env.LINEAR_API_KEY) {
    db.prepare('INSERT INTO connectors (id, enabled, config) VALUES (?, 1, ?)').run(
      'linear',
      JSON.stringify({ api_key: process.env.LINEAR_API_KEY, team_id: process.env.LINEAR_TEAM_ID || '' })
    )
  }

  const sample = db.prepare('SELECT data FROM project_details_cache LIMIT 1').get() as any
  if (sample) {
    const parsed = JSON.parse(sample.data)
    if (!Array.isArray(parsed.members)) {
      db.exec('DELETE FROM project_details_cache')
    }
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
  }
}

/** Returns the configured work directory, expanded. Default: ~/Work */
export function getWorkDir(): string {
  try {
    const row = getDb().prepare('SELECT value FROM app_config WHERE key = ?').get('work_dir') as any
    if (row?.value) {
      return row.value.replace(/^~/, os.homedir())
    }
  } catch {}
  return path.join(os.homedir(), 'Work')
}
