"use client";
import React from "react";

type Props = { children: React.ReactNode; fallback?: React.ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[Persat ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="mx-auto max-w-xl rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <h2 className="font-display text-xl uppercase text-white">Something went wrong</h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            The app hit an unexpected error but your funds remain safe on-chain — no custody. Try refreshing. If it persists, check devnet RPC status.
          </p>
          <p className="mt-3 font-mono text-xs text-red-300 break-all">{this.state.error?.message.slice(0, 300)}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-6 rounded-full border border-white/20 px-5 py-2 font-mono text-xs uppercase tracking-wider text-white hover:bg-white/10"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
