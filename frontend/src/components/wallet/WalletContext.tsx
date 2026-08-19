"use client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { clusterApiUrl } from "@solana/web3.js";
import { useMemo, type ComponentType, type ReactNode } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";

// The mobile adapter transitively resolves React Native's React 19 declarations.
// Casting only isolates that upstream declaration mismatch; the runtime remains React 18/Next 14.
const SafeConnectionProvider = ConnectionProvider as unknown as ComponentType<{ endpoint: string; children: ReactNode }>;
const SafeWalletProvider = WalletProvider as unknown as ComponentType<{ wallets: unknown[]; autoConnect: boolean; children: ReactNode }>;
const SafeWalletModalProvider = WalletModalProvider as unknown as ComponentType<{ children: ReactNode }>;

/** Devnet is intentional during development. Production configuration must supply NEXT_PUBLIC_SOLANA_RPC_URL. */
export function PersatWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl("devnet");
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return <SafeConnectionProvider endpoint={endpoint}><SafeWalletProvider wallets={wallets} autoConnect={false}><SafeWalletModalProvider>{children}</SafeWalletModalProvider></SafeWalletProvider></SafeConnectionProvider>;
}
