"use client";
import { useEffect, useState } from "react";

export function IframeNotice() {
  const [inIframe, setInIframe] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.self !== window.top) {
        setInIframe(true);
      }
    } catch {
      setInIframe(true);
    }
  }, []);

  if (!inIframe || dismissed) return null;

  return (
    <aside aria-label="Preview notice" className="border-b border-amber/30 bg-surface px-4 py-2.5 text-xs text-orange-50">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 font-mono">
        <div className="flex items-center gap-2">
          <span className="text-amber">⚡ PREVIEW NOTICE:</span>
          <span>Web3 wallet extensions (Phantom/Solflare) block popups in preview iframes. Open directly in a new tab:</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={typeof window !== "undefined" ? window.location.href : "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-amber/50 bg-amber/10 px-3 py-1 text-[11px] uppercase tracking-wider text-amber hover:bg-amber/20 hover:text-white"
          >
            Open in new tab ↗
          </a>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-orange-50/60 hover:text-orange-50"
            aria-label="Dismiss notice"
          >
            ✕
          </button>
        </div>
      </div>
    </aside>
  );
}
