import React from 'react'
import { useAppStore } from '../store'

/** Small inline spinner. Size in px via `size`. */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin text-accent ${className}`}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

/** Centered loading block with a spinner and optional label. */
export function Loading({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-10 text-gray-500 ${className}`}>
      <Spinner size={20} />
      <span className="text-xs">{label}</span>
    </div>
  )
}

const DefaultEmptyIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
)

/** Empty state: icon + title + hint. */
export function EmptyState({
  title,
  hint,
  icon,
  className = '',
}: {
  title: string
  hint?: string
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-10 px-4 text-center ${className}`}>
      <span className="text-gray-700">{icon ?? DefaultEmptyIcon}</span>
      <p className="text-sm text-gray-400">{title}</p>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

/** Error state: message + optional retry button. */
export function ErrorState({
  message,
  onRetry,
  className = '',
}: {
  message: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-10 px-4 text-center ${className}`}>
      <span className="text-red-400">
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0l-6.93 12a2 2 0 001.74 3z" />
        </svg>
      </span>
      <p className="text-sm text-red-400 max-w-sm">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-surface2 border border-border text-xs text-gray-300 hover:text-gray-100 hover:border-gray-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Retry
        </button>
      )}
    </div>
  )
}

/** Global toast stack — reads the notifications slice from the store. */
export function Toasts() {
  const notifications = useAppStore((s) => s.notifications)
  const dismissNotification = useAppStore((s) => s.dismissNotification)
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2 flex flex-col items-end pointer-events-none">
      {notifications.map((n) => (
        <div
          key={n.id}
          onClick={() => dismissNotification(n.id)}
          className="pointer-events-auto bg-surface2 border border-border text-gray-200 text-xs px-3 py-2 rounded-lg shadow-elev cursor-pointer hover:bg-surface transition-colors max-w-xs animate-fade-in"
        >
          {n.message}
        </div>
      ))}
    </div>
  )
}
