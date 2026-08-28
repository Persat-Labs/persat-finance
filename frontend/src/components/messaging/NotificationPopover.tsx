"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useDirectMessages } from "@/lib/messages/messagesStore";
import { useProtocol } from "@/lib/protocol/hooks";

export function NotificationPopover() {
  const { publicKey } = useProtocol();
  const myWallet = publicKey ? publicKey.toBase58() : null;
  const { unreadMessages, unreadCount, markAsRead } = useDirectMessages(myWallet);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white transition hover:border-amber hover:bg-white/[0.08]"
        title="View Notifications"
      >
        <span className="text-base">💬</span>
        {/* Glowing dot ONLY appears if there is an unread message */}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber" />
          </span>
        )}
      </button>

      {/* WhatsApp / macOS style notification popover */}
      {open && (
        <div className="glass sheen absolute right-0 top-full z-50 mt-3 w-80 sm:w-96 rounded-2xl border border-white/15 bg-black/90 p-4 shadow-2xl backdrop-blur-2xl animate-reveal">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="font-ui-persat text-xs uppercase tracking-wider text-white">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-amber/20 px-2 py-0.5 font-mono text-[10px] text-amber">
                  {unreadCount} new
                </span>
              )}
            </div>
            <Link
              href="/messages"
              onClick={() => setOpen(false)}
              className="font-mono text-[11px] text-amber hover:underline"
            >
              Open Full Inbox →
            </Link>
          </div>

          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
            {unreadMessages.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-xl">✓</p>
                <p className="font-mono text-xs text-white/50 mt-1">All caught up! No unread messages.</p>
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
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/90">
                    {msg.text}
                  </p>
                  {msg.dealProposal && (
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-amber/15 px-2 py-0.5 font-mono text-[10px] text-amber">
                      ⚡ Deal Proposal: {msg.dealProposal.principal} {msg.dealProposal.currency}
                    </div>
                  )}
                </Link>
              ))
            )}
          </div>

          <div className="mt-3 border-t border-white/10 pt-2.5 text-center">
            <Link
              href="/messages"
              onClick={() => setOpen(false)}
              className="font-ui-persat text-xs uppercase tracking-wider text-white/70 hover:text-amber transition"
            >
              View All Conversations
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
