import React from 'react'

interface ProgressBarProps {
  percent: number
  showLabel?: boolean
  className?: string
}

export function ProgressBar({ percent, showLabel = true, className = '' }: ProgressBarProps) {
  const clampedPercent = Math.min(100, Math.max(0, percent))

  const getColor = () => {
    if (clampedPercent === 100) return 'bg-green-500'
    if (clampedPercent > 0) return 'bg-indigo-500'
    return 'bg-gray-700'
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${getColor()}`}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-gray-400 w-10 text-right">{clampedPercent}%</span>
      )}
    </div>
  )
}

interface ProgressDotProps {
  percent: number
}

export function ProgressDot({ percent }: ProgressDotProps) {
  if (percent === 100) return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
  if (percent > 0) return <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
  return <span className="w-2 h-2 rounded-full bg-gray-600 inline-block" />
}
