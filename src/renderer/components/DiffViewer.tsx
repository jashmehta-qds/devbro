import React, { useEffect, useState, useCallback } from 'react'
import { useWorkDir, repoPath as buildRepoPath } from '../hooks/useWorkDir'
import { EmptyState, ErrorState, Spinner } from './ui'

const DIFF_TOO_LARGE_BYTES = 2 * 1024 * 1024 // 2MB — render file list only beyond this

interface FileDiff {
  filename: string
  hunks: Hunk[]
  additions: number
  deletions: number
}

interface Hunk {
  header: string
  lines: DiffLine[]
}

interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk'
  content: string
}

function parseDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = []
  if (!raw.trim()) return files

  const fileParts = raw.split(/^diff --git /m).filter(Boolean)
  for (const part of fileParts) {
    const lines = part.split('\n')
    // extract filename from first line: "a/foo b/foo"
    const headerLine = lines[0] || ''
    const match = headerLine.match(/ b\/(.+)$/)
    const filename = match ? match[1] : headerLine.split(' ')[0]

    const hunks: Hunk[] = []
    let currentHunk: Hunk | null = null
    let additions = 0
    let deletions = 0

    for (const line of lines.slice(1)) {
      if (line.startsWith('@@')) {
        currentHunk = { header: line, lines: [] }
        hunks.push(currentHunk)
      } else if (currentHunk) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentHunk.lines.push({ type: 'add', content: line.slice(1) })
          additions++
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentHunk.lines.push({ type: 'del', content: line.slice(1) })
          deletions++
        } else if (!line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('\\')) {
          currentHunk.lines.push({ type: 'ctx', content: line.slice(1) })
        }
      }
    }

    if (hunks.length > 0 || filename) {
      files.push({ filename, hunks, additions, deletions })
    }
  }
  return files
}

function FileAccordion({ file, listOnly = false }: { file: FileDiff; listOnly?: boolean }) {
  const [open, setOpen] = useState(!listOnly)
  return (
    <div className="rounded-lg border border-border overflow-hidden mb-3">
      <button
        onClick={() => !listOnly && setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface hover:bg-surface2 transition-colors text-left"
      >
        <span className="font-mono text-xs text-gray-200 truncate">{file.filename}</span>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {file.additions > 0 && (
            <span className="text-[11px] font-mono text-emerald-400">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-[11px] font-mono text-red-400">-{file.deletions}</span>
          )}
          {!listOnly && (
            <svg
              className={`w-3 h-3 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      </button>
      {open && !listOnly && (
        <div className="overflow-x-auto">
          <pre className="text-[11px] font-mono leading-5">
            {file.hunks.map((hunk, hi) => (
              <React.Fragment key={hi}>
                <div className="px-3 py-0.5 text-purple-400 bg-purple-500/5 border-b border-gray-800/60">
                  {hunk.header}
                </div>
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className={
                      line.type === 'add' ? 'bg-emerald-500/10 text-emerald-300 px-3' :
                      line.type === 'del' ? 'bg-red-500/10 text-red-300 px-3' :
                      'text-gray-500 px-3'
                    }
                  >
                    <span className="select-none mr-2 opacity-50">
                      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                    </span>
                    {line.content || ' '}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}

export function DiffViewer({ ticketId, projectRepos }: {
  ticketId: string
  projectRepos: string[]
}) {
  const [mode, setMode] = useState<'uncommitted' | 'session'>('uncommitted')
  const [perRepo, setPerRepo] = useState<Array<{ repo: string; diff: string; error?: string }>>([])
  const [loading, setLoading] = useState(false)
  const [sessionSha, setSessionSha] = useState<string | null>(null)
  const workDir = useWorkDir()

  useEffect(() => {
    window.api.activity.getForTicket(ticketId).then((events: any[]) => {
      const sessions = events.filter(e => e.type === 'session' && e.data?.gitStartSha)
      if (sessions.length > 0) setSessionSha(sessions[0].data.gitStartSha)
      else setSessionSha(null)
    }).catch(() => setSessionSha(null))
  }, [ticketId])

  const fetchDiff = useCallback(async () => {
    if (projectRepos.length === 0) { setPerRepo([]); return }
    setLoading(true)
    const fromSha = mode === 'session' ? (sessionSha ?? undefined) : undefined
    const results = await Promise.all(projectRepos.map(async (repo) => {
      try {
        const raw = await window.api.git.getDiff(buildRepoPath(workDir, repo), fromSha)
        return { repo, diff: raw }
      } catch (e: any) {
        return { repo, diff: '', error: e?.message || 'Failed to load diff' }
      }
    }))
    setPerRepo(results)
    setLoading(false)
  }, [projectRepos.join(','), mode, sessionSha, workDir])

  useEffect(() => { fetchDiff() }, [fetchDiff])

  if (projectRepos.length === 0) {
    return <EmptyState title="Not a repo" hint="No repo is linked to this ticket's project. Link one in the project view." />
  }

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Mode toggle */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center bg-gray-900 border border-gray-800 rounded-md overflow-hidden">
          {(['uncommitted', 'session'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={m === 'session' && !sessionSha}
              className={`h-6 px-2.5 text-[11px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === m ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {m === 'uncommitted' ? 'Uncommitted' : 'Since session start'}
            </button>
          ))}
        </div>
        <button
          onClick={fetchDiff}
          disabled={loading}
          className="ml-auto text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 20l4-4m0 0a9 9 0 0112.7 0M20 4l-4 4m0 0a9 9 0 00-12.7 0" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-10"><Spinner size={18} /></div>
        )}
        {!loading && perRepo.every((r) => !r.error && parseDiff(r.diff).length === 0) && (
          <EmptyState
            title="No changes"
            hint={mode === 'session' ? 'Nothing changed since the last session started.' : 'Working trees are clean.'}
            icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" /></svg>}
          />
        )}
        {!loading && perRepo.map(({ repo, diff, error }) => {
          const files = parseDiff(diff)
          const tooLarge = diff.length > DIFF_TOO_LARGE_BYTES
          if (!error && files.length === 0) return null
          return (
            <div key={repo}>
              <div className="flex items-baseline gap-2 mb-2 sticky top-0 bg-gray-950/95 backdrop-blur py-1 z-10">
                <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-gray-400">{repo}</span>
                {!error && (
                  <span className="text-[10px] font-mono text-gray-600">{files.length} file{files.length === 1 ? '' : 's'}</span>
                )}
              </div>
              {error && <ErrorState message={error} onRetry={fetchDiff} />}
              {!error && tooLarge && (
                <div className="mb-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
                  Diff is large ({(diff.length / (1024 * 1024)).toFixed(1)}MB) — file list only.
                </div>
              )}
              {!error && files.map((file, i) => (
                <FileAccordion key={i} file={file} listOnly={tooLarge} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
