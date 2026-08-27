"use client";
import type { ReactNode } from "react";

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-md transition-all animate-reveal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="glass sheen w-full max-w-lg rounded-[24px] border border-white/15 p-6 sm:p-8 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display-persat text-2xl uppercase tracking-wide text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white/70 hover:border-amber hover:text-white transition"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
