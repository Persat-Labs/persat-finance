"use client";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/lib/design-system";
import { useCallback, useEffect } from "react";

export function WalletButton() {
  const { wallet, publicKey, disconnect, connect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  // If connecting hangs for more than 25 seconds, reset state
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

  return (
    <div className="relative inline-block">
      {publicKey ? (
        <Button
          variant="secondary"
          onClick={handleClick}
          title="Click to disconnect"
          className="flex items-center gap-2 px-4 py-2 text-xs"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <span>
            {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}
          </span>
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={handleClick}
          title={connecting ? "Click to cancel connection" : undefined}
          className="px-5 py-2.5 text-xs"
        >
          {connecting ? "Connecting…" : "Connect Wallet"}
        </Button>
      )}

      {connecting && (
        <p className="absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-full border border-amber/40 bg-black/90 px-3 py-1 font-mono text-[10px] text-amber shadow-2xl backdrop-blur-md">
          👉 Click Phantom in browser toolbar to approve
        </p>
      )}
    </div>
  );
}
