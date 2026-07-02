import { Component, ReactNode } from 'react'

interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', this.props.label ?? '', error)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-sm text-red-400 bg-red-950/30 border border-red-900 rounded m-2">
          <div className="font-semibold mb-1">Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.</div>
          <div className="text-red-300/70 text-xs mb-2 font-mono">{this.state.error.message}</div>
          <button onClick={this.reset} className="text-xs bg-red-900 hover:bg-red-800 px-2 py-1 rounded">Reload panel</button>
        </div>
      )
    }
    return this.props.children
  }
}
