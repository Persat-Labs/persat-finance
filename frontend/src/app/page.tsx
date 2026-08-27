"use client";
import Link from "next/link";
import { useState } from "react";
import { Button, Card } from "@/lib/design-system";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useProtocol } from "@/lib/protocol/hooks";
import { useProfile } from "@/lib/profile/userProfile";
import { MessagesDrawer } from "@/components/messaging/MessagesDrawer";
import { useMarketplaceListings } from "@/lib/marketplace/marketplaceStore";

export default function Home() {
  const { publicKey } = useProtocol();
  const myWallet = publicKey ? publicKey.toBase58() : null;
  const { profile } = useProfile(myWallet);
  const { listings } = useMarketplaceListings();
  const [messagesOpen, setMessagesOpen] = useState(false);

  const realMetrics = [
    ["Protocol Status", "LIVE", "Solana Devnet Cluster"],
    ["Core Programs", "8 / 8", "All PDAs Initialized"],
    ["Open Listings", String(listings.length), "Real Marketplace Offers"],
    ["Custody Model", "0%", "Zero Counterparty Custody"],
  ];

  return (
    <main className="app-shell hud-grid">
      {/* Floating Glass Navbar from waitlist/ */}
      <header className="sticky top-0 z-40 px-4 pt-4 sm:px-8">
        <nav className="glass mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-6 py-2.5 rounded-full border border-white/10 shadow-2xl backdrop-blur-xl">
          <Link
            href="/"
            className="font-brand-persat text-xl uppercase tracking-[.24em] text-white hover:text-amber transition"
          >
            persat
          </Link>

          <div className="hidden items-center gap-7 font-mono text-xs uppercase tracking-widest text-white/70 md:flex">
            <Link href="/deal/new" className="hover:text-amber transition">
              Direct Deal
            </Link>
            <Link href="/marketplace" className="hover:text-amber transition">
              Marketplace
            </Link>
            <Link href="/faucet" className="hover:text-amber transition">
              Faucet
            </Link>
            <Link href="/keeper" className="hover:text-amber transition">
              Keeper
            </Link>
            {myWallet && (
              <Link href={`/profile/${myWallet}`} className="text-amber hover:text-white transition">
                {profile?.username ? `@${profile.username}` : "Profile"}
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            {myWallet && (
              <button
                type="button"
                onClick={() => setMessagesOpen(true)}
                className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white transition hover:border-amber hover:bg-white/[0.08]"
                title="Open Deal Messages"
              >
                <span className="text-base">💬</span>
                <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-amber" />
                </span>
              </button>
            )}
            <WalletButton />
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-16 sm:pt-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber/10 px-4 py-1.5 font-mono text-xs text-amber animate-reveal">
          <span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />
          <span>PERSAT FINANCE // DEVNET BETA</span>
        </div>

        <h1 className="mt-6 max-w-5xl font-display-persat text-4xl uppercase leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-7xl">
          Bitcoin-backed lending, without handing custody to anyone.
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">
          Create a private agreement with someone you know, or discover structured lending terms in the
          marketplace. Every deal settles under mathematically enforced, non-custodial rules on Solana.
        </p>

        {/* Dual Path Cards */}
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {/* Path A */}
          <Card className="animate-reveal [animation-delay:80ms]">
            <p className="eyebrow">Path A // Private Agreement</p>
            <h2 className="mt-3 font-display-persat text-2xl uppercase tracking-wide text-white">
              I Already Have Someone
            </h2>
            <p className="mt-3 min-h-12 text-sm leading-6 text-white/70">
              Create terms and share one single-use private link. Fulfill or negotiate directly via in-app
              messaging. Zero centralized custodian.
            </p>
            <div className="mt-6">
              <Link href="/deal/new">
                <Button className="w-full sm:w-auto">Create a Direct Deal →</Button>
              </Link>
            </div>
          </Card>

          {/* Path B */}
          <Card className="animate-reveal [animation-delay:160ms]">
            <p className="eyebrow">Path B // Public Discovery</p>
            <h2 className="mt-3 font-display-persat text-2xl uppercase tracking-wide text-white">
              Browse The Marketplace
            </h2>
            <p className="mt-3 min-h-12 text-sm leading-6 text-white/70">
              Post or respond to structured amount, rate, duration, and collateral terms. View counterparty
              profiles and initiate private negotiations.
            </p>
            <div className="mt-6">
              <Link href="/marketplace">
                <Button variant="secondary" className="w-full sm:w-auto">
                  Open Marketplace →
                </Button>
              </Link>
            </div>
          </Card>
        </div>

        {/* Real Live Metrics Grid */}
        <div className="mt-16 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {realMetrics.map(([label, value, helper]) => (
            <div key={label} className="glass sheen rounded-[20px] p-6 border border-white/10">
              <p className="font-brand-persat text-3xl text-amber">{value}</p>
              <p className="mt-2 font-mono text-xs uppercase tracking-widest text-white">{label}</p>
              <p className="mt-1 text-xs text-white/50">{helper}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Global In-App Messages Drawer */}
      <MessagesDrawer open={messagesOpen} onClose={() => setMessagesOpen(false)} />
    </main>
  );
}
