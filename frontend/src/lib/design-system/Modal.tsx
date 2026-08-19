"use client";
import type { ReactNode } from "react";
export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
 if (!open) return null;
 return <div className="fixed inset-0 z-50 grid place-items-center bg-ink/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
   <div className="panel w-full max-w-lg p-6"><div className="mb-6 flex items-center justify-between"><h2 className="font-display text-xl uppercase tracking-wide">{title}</h2><button onClick={onClose} className="min-h-12 min-w-12 border border-amber/30 font-mono text-amber" aria-label="Close">×</button></div>{children}</div>
 </div>;
}
