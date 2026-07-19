import { useEffect, useState } from 'react'

let cached: string | null = null
const listeners = new Set<(v: string) => void>()

function fetchOnce() {
  if (cached) return
  window.api.workDir.get().then((v) => {
    cached = v || '~/Work'
    listeners.forEach((l) => l(cached!))
  }).catch(() => {})
}

// ponytail: single fetch, module-scoped cache. Refetch by reload; work dir rarely changes at runtime.
export function useWorkDir(): string {
  const [v, setV] = useState<string>(cached ?? '~/Work')
  useEffect(() => {
    if (cached) { setV(cached); return }
    listeners.add(setV)
    fetchOnce()
    return () => { listeners.delete(setV) }
  }, [])
  return v
}

export function repoPath(workDir: string, repoName: string): string {
  return `${workDir.replace(/\/$/, '')}/${repoName}`
}
