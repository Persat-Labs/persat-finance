import type { Metadata } from "next";
import "./globals.css";
import { PersatWalletProvider } from "@/components/wallet/WalletContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "Persat Finance — What If You Could Lend to Anyone?",
  description:
    "Infrastructure for a world where anyone can lend to anyone, secured by digital assets and enforced by smart contracts — starting with Bitcoin. Trust-minimized peer-to-peer credit on Solana.",
  keywords: [
    "peer-to-peer lending",
    "trust-minimized",
    "collateral-backed credit",
    "Bitcoin",
    "DeFi",
    "Solana",
    "lending infrastructure",
  ],
  applicationName: "Persat Finance",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/persatlogo.png", type: "image/png" },
    ],
    apple: [{ url: "/persatlogo.png", sizes: "180x180", type: "image/png" }],
    shortcut: "/favicon.ico",
  },
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
