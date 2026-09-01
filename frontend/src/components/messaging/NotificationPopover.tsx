"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useDirectMessages } from "@/lib/messages/messagesStore";
import { useProtocol } from "@/lib/protocol/hooks";

/**
 * Bell + dropdown. Portaled to document.body with fixed coords so the
 * rounded glass header never clips the panel (overflow/radius crop).
 */
export function NotificationPopover() {
  const { publicKey } = useProtocol();
  const myWallet = publicKey ? publicKey.toBase58() : null;
  const { unreadMessages, unreadCount, markAsRead } = useDirectMessages(myWallet);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const placePanel = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(384, window.innerWidth - 24);
    // Prefer align to button right; clamp so panel stays fully on-screen
    let right = window.innerWidth - r.right;
    right = Math.max(12, Math.min(right, window.innerWidth - width - 12));
    const top = r.bottom + 10;
    setCoords({ top, right });
  }, []);

  useEffect(() => {
    if (!open) return;
    placePanel();
    const onScroll = () => placePanel();
    const onResize = () => placePanel();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, placePanel]);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      const t = event.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const panelWidth = "min(24rem, calc(100vw - 1.5rem))";

  const panel =
    open && coords && mounted
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Notifications"
            className="fixed z-[90] rounded-2xl border border-white/15 bg-black/95 p-4 shadow-2xl backdrop-blur-2xl animate-reveal"
            style={{
              top: coords.top,
              right: coords.right,
              width: panelWidth,
              maxHeight: "min(28rem, calc(100vh - 5rem))",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-ui-persat text-xs uppercase tracking-wider text-white">
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-amber/20 px-2 py-0.5 font-mono text-[10px] text-amber">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <Link
                href="/messages"
                onClick={() => setOpen(false)}
                className="shrink-0 font-mono text-[11px] text-amber hover:underline whitespace-nowrap"
              >
                Open Full Inbox →
              </Link>
            </div>

            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {unreadMessages.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-xl">✓</p>
                  <p className="mt-1 font-mono text-xs text-white/50">
                    All caught up! No unread messages.
                  </p>
                </div>
              ) : (
                unreadMessages.map((msg) => (
                  <Link
                    key={msg.id}
                    href={`/messages?partner=${msg.senderWallet}`}
                    onClick={() => {
                      markAsRead(msg.senderWallet);
                      setOpen(false);
                    }}
                    className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-amber hover:bg-white/[0.06]"
                  >
                    <div className="flex items-center justify-between font-mono text-[11px] text-amber">
                      <span>@{msg.senderHandle}</span>
                      <span className="text-[10px] text-white/40">
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/90">{msg.text}</p>
                    {msg.dealProposal && (
                      <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-amber/15 px-2 py-0.5 font-mono text-[10px] text-amber">
                        ⚡ Deal Proposal: {msg.dealProposal.principal} {msg.dealProposal.currency}
                      </div>
                    )}
                  </Link>
                ))
              )}
            </div>

            <div className="mt-3 shrink-0 border-t border-white/10 pt-2.5 text-center">
              <Link
                href="/messages"
                onClick={() => setOpen(false)}
                className="font-ui-persat text-xs uppercase tracking-wider text-white/70 transition hover:text-amber"
              >
                View All Conversations
              </Link>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white transition hover:border-amber hover:bg-white/[0.08]"
        title="View Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="text-base">💬</span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber" />
          </span>
        )}
      </button>
      {panel}
    </div>
  );
}
