import type { Metadata } from "next";
import "./globals.css";
import { PersatWalletProvider } from "@/components/wallet/WalletContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "Persat Finance — Non-custodial Bitcoin-backed Lending",
  description: "Non-custodial Bitcoin-backed lending infrastructure on Solana. Private deals + open marketplace, single Pyth BTC/USD oracle, tBTC/zBTC only, USDC/USDT.",
  keywords: ["Bitcoin", "DeFi", "Solana", "tBTC", "zBTC", "lending", "non-custodial"],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <PersatWalletProvider>{children}</PersatWalletProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
