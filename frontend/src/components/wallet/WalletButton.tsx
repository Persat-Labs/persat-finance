"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/lib/design-system";

export function WalletButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { wallet, publicKey, disconnect, connect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle main button click
  const handleMainClick = useCallback(() => {
    if (connecting) {
      void disconnect();
      return;
    }
    if (publicKey) {
      // Toggle dropdown menu below instead of disconnecting immediately!
      setMenuOpen((prev) => !prev);
    } else if (wallet) {
      connect().catch(() => setVisible(true));
    } else {
      setVisible(true);
    }
  }, [connecting, publicKey, disconnect, wallet, connect, setVisible]);

  // Handle Disconnect & Redirect to Onboarding
  const handleDisconnect = async () => {
    setMenuOpen(false);
    try {
      localStorage.removeItem("persat_onboarding_completed_v1");
    } catch {
      //
    }
    await disconnect();
    window.dispatchEvent(new Event("persat_show_onboarding"));
    if (pathname !== "/") {
      router.push("/");
    }
  };

  const handleCopy = async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      //
    }
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      {publicKey ? (
        <Button
          variant="secondary"
          onClick={handleMainClick}
          title="Wallet options"
          className="flex items-center gap-2 px-4 py-2 text-xs"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <span>
            {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}
          </span>
          <svg
            className={`h-3 w-3 text-white/50 transition-transform ${menuOpen ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={handleMainClick}
          className="px-5 py-2.5 text-xs"
        >
          {connecting ? "Connecting…" : "Connect Wallet"}
        </Button>
      )}

      {/* Disconnect & Wallet Options Dropdown below */}
      {menuOpen && publicKey && (
        <div className="glass sheen absolute right-0 top-full z-50 mt-2.5 w-64 rounded-2xl border border-white/15 bg-black/90 p-4 shadow-2xl backdrop-blur-2xl animate-reveal">
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            <span className="font-ui text-xs uppercase tracking-wider text-white">Connected to Devnet</span>
          </div>

          <div className="py-3">
            <p className="font-mono text-[10px] text-white/40 uppercase">Solana Address</p>
            <div className="mt-1 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-2 font-mono text-xs text-white">
              <span>{publicKey.toBase58().slice(0, 8)}…{publicKey.toBase58().slice(-6)}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="text-amber hover:underline text-[11px]"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div className="border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={handleDisconnect}
              className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 font-ui text-xs uppercase tracking-wider text-red-300 hover:bg-red-500/20 hover:text-white transition flex items-center justify-center gap-2"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
              <span>Disconnect &amp; Exit</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
