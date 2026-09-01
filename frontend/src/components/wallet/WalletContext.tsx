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
const SafeWalletProvider = WalletProvider as unknown as ComponentType<{
  wallets: unknown[];
  autoConnect: boolean;
  onError?: (error: Error) => void;
  children: ReactNode;
}>;
const SafeWalletModalProvider = WalletModalProvider as unknown as ComponentType<{
  children: ReactNode;
  className?: string;
  container?: string | HTMLElement | null;
}>;

/**
 * Devnet is the MVP target cluster, not Solana testnet: testnet exists for
 * validator operators and has no Pyth receiver deployed, so the protocol would
 * have no BTC/USD price there. Override with NEXT_PUBLIC_SOLANA_RPC_URL to use
 * a dedicated (non rate-limited) endpoint.
 */
export function PersatWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl("devnet");
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <SafeConnectionProvider endpoint={endpoint}>
      <SafeWalletProvider
        wallets={wallets}
        // Auto-reconnect returning wallets; failures must not block the app shell
        autoConnect={true}
        onError={(err) => {
          // Never throw — wallet errors must not freeze the page on loading
          console.warn("[Persat Wallet Notice]", err?.message ?? String(err));
        }}
      >
        {/* Modal mounts at document body; CSS raises z-index above onboarding */}
        <SafeWalletModalProvider>
          {children}
        </SafeWalletModalProvider>
      </SafeWalletProvider>
    </SafeConnectionProvider>
  );
}
