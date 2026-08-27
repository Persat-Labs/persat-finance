"use client";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/lib/design-system";
import { useCallback } from "react";

export function WalletButton() {
  const { wallet, publicKey, disconnect, connect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  const handleClick = useCallback(() => {
    if (publicKey) {
      disconnect();
    } else if (wallet && !connecting) {
      connect().catch(() => setVisible(true));
    } else {
      setVisible(true);
    }
  }, [publicKey, disconnect, wallet, connecting, connect, setVisible]);

  const label = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : connecting
    ? "Connecting…"
    : "Connect wallet";

  return (
    <Button onClick={handleClick} disabled={connecting}>
      {label}
    </Button>
  );
}
