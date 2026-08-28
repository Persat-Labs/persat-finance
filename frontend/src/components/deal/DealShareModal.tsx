"use client";
import { useState, useMemo } from "react";
import { Button, Modal } from "@/lib/design-system";

export interface DealShareModalProps {
  open: boolean;
  onClose: () => void;
  dealUrlId: string;
  principal?: string;
  currency?: string;
  collateralBtc?: string;
  months?: number | string;
  side?: "borrower" | "lender";
  txSignature?: string;
}

export function DealShareModal({
  open,
  onClose,
  dealUrlId,
  principal = "1000",
  currency = "USDC",
  collateralBtc = "0.05",
  months = 12,
  side = "borrower",
  txSignature,
}: DealShareModalProps) {
  const [copied, setCopied] = useState(false);

  const fullUrl = useMemo(() => {
    if (typeof window === "undefined") return `/deal/${dealUrlId}`;
    return `${window.location.origin}/deal/${dealUrlId}`;
  }, [dealUrlId]);

  const shareText = useMemo(() => {
    const roleText = side === "borrower" ? "borrow" : "lend";
    return `I created a private deal proposal on Persat Finance to ${roleText} ${Number(principal).toLocaleString()} ${currency} backed by ${collateralBtc} tBTC collateral for ${months} months. Review, fulfill, or negotiate terms here: ${fullUrl}`;
  }, [side, principal, currency, collateralBtc, months, fullUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback
    }
  };

  const encodedText = encodeURIComponent(shareText);
  const encodedUrl = encodeURIComponent(fullUrl);

  const shareLinks = [
    {
      name: "WhatsApp",
      url: `https://api.whatsapp.com/send?text=${encodedText}`,
      icon: "💬",
      color: "hover:border-emerald-500/60 hover:bg-emerald-500/10",
    },
    {
      name: "Telegram",
      url: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(`Review Persat Finance loan deal: ${principal} ${currency}`)}`,
      icon: "✈️",
      color: "hover:border-sky-500/60 hover:bg-sky-500/10",
    },
    {
      name: "X (Twitter)",
      url: `https://x.com/intent/post?text=${encodedText}`,
      icon: "🐦",
      color: "hover:border-neutral-400/60 hover:bg-neutral-800/50",
    },
    {
      name: "Email",
      url: `mailto:?subject=${encodeURIComponent("Persat Finance Loan Proposal")}&body=${encodedText}`,
      icon: "✉️",
      color: "hover:border-amber/60 hover:bg-amber/10",
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Deal Link Created">
      <div className="space-y-6">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
              ✓
            </span>
            <p className="font-mono text-xs uppercase tracking-wider text-emerald-300">
              Deal Registered On Devnet
            </p>
          </div>
          <p className="mt-2 text-sm text-white/90">
            Terms are cryptographically hashed on-chain. Send this link to your counterparty to review, fulfill, or request changes.
          </p>
        </div>

        {/* Shareable Link Box */}
        <div>
          <label className="eyebrow mb-2 block">Single-Use Private Link</label>
          <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] p-2">
            <input
              type="text"
              readOnly
              value={fullUrl}
              className="w-full bg-transparent px-2 font-mono text-xs text-white/90 outline-none"
            />
            <Button
              variant={copied ? "primary" : "secondary"}
              onClick={handleCopy}
              className="shrink-0 px-4 py-2 text-xs"
            >
              {copied ? "✓ Copied!" : "Copy Link"}
            </Button>
          </div>
        </div>

        {/* Quick Messaging Apps */}
        <div>
          <p className="eyebrow mb-3">Share via Messaging Apps</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {shareLinks.map((item) => (
              <a
                key={item.name}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs font-mono text-white transition-all ${item.color}`}
              >
                <span>{item.icon}</span>
                <span>{item.name}</span>
              </a>
            ))}
          </div>
        </div>

        {/* Primary Action Button */}
        <div className="border-t border-white/10 pt-4 flex flex-wrap gap-3">
          <a href={`/deal/${dealUrlId}`} className="w-full">
            <Button className="w-full py-3.5 text-xs">
              Open Deal Workspace →
            </Button>
          </a>
        </div>

        {txSignature && (
          <p className="text-center font-mono text-[11px] text-white/40">
            Confirmed on-chain:{" "}
            <a
              href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber underline hover:text-white"
            >
              View on Explorer ↗
            </a>
          </p>
        )}
      </div>
    </Modal>
  );
}
