"use client";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/lib/design-system";
import { useCallback, useEffect } from "react";

export function WalletButton() {
  const { wallet, publicKey, disconnect, connect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  // If connecting hangs for more than 25 seconds (e.g. extension prompt ignored), reset state
  useEffect(() => {
    if (!connecting) return;
    const timer = setTimeout(() => {
      void disconnect();
    }, 25000);
    return () => clearTimeout(timer);
  }, [connecting, disconnect]);

  const handleClick = useCallback(() => {
    if (connecting) {
      void disconnect();
      return;
    }
    if (publicKey) {
      void disconnect();
    } else if (wallet) {
      connect().catch(() => setVisible(true));
    } else {
      setVisible(true);
    }
  }, [connecting, publicKey, disconnect, wallet, connect, setVisible]);

  const label = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : connecting
    ? "Connecting… (Click to cancel)"
    : "Connect wallet";

  return (
    <div className="relative inline-block">
      <Button onClick={handleClick} title={connecting ? "Click to cancel connection" : undefined}>
        {label}
      </Button>
      {connecting && (
        <p className="absolute right-0 top-full z-50 mt-1.5 whitespace-nowrap rounded border border-amber/30 bg-surface px-2.5 py-1 font-mono text-[10px] text-amber shadow-panel">
          👉 Click Phantom icon in Chrome toolbar to approve
        </p>
      )}
    </div>
  );
}
