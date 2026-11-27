import React, { Component, ErrorInfo, ReactNode } from 'react'
import { Flame, RefreshCw, Home } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoHome = () => {
    window.location.href = '/'
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#17120f] text-[#ebe0d9] flex items-center justify-center p-6 font-['Geist',sans-serif]">
          <div className="max-w-md w-full p-8 rounded-3xl bg-[#201b17] border border-[#ff8a00]/30 shadow-[0_20px_50px_rgba(255,138,0,0.2)] text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#ff8a00]/15 border border-[#ff8a00]/40 flex items-center justify-center mx-auto mb-4 text-[#ff8a00]">
              <Flame className="w-7 h-7" />
            </div>
            <h2 className="font-['Space_Grotesk'] text-xl font-bold mb-2">
              Something went unexpected
            </h2>
            <p className="text-xs text-[#ddc1ae] mb-6 leading-relaxed">
              Persat encountered a temporary interface state. Your funds and wallet sessions remain completely safe and non-custodial.
            </p>
            {this.state.error && (
              <div className="p-3 rounded-xl bg-[#120d0a] border border-[#564334]/40 text-left font-mono text-[11px] text-[#ffaa45] mb-6 overflow-x-auto max-h-32">
                {this.state.error.message}
              </div>
            )}
            <div className="flex items-center gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="px-5 py-2.5 rounded-full bg-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold hover:bg-[#ffaa45] transition-colors flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reload Page</span>
              </button>
              <button
                onClick={this.handleGoHome}
                className="px-5 py-2.5 rounded-full bg-[#241f1a] text-[#ebe0d9] font-['Space_Grotesk'] text-xs font-bold border border-[#564334]/40 hover:bg-[#2f2924] transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Go to Home</span>
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
