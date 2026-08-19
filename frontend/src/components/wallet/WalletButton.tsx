"use client";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/lib/design-system";
export function WalletButton() { const { publicKey, disconnect } = useWallet(); const { setVisible } = useWalletModal(); const label = publicKey ? `${publicKey.toBase58().slice(0,4)}…${publicKey.toBase58().slice(-4)}` : "Connect wallet"; return <Button onClick={() => publicKey ? disconnect() : setVisible(true)}>{label}</Button>; }
