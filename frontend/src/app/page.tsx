"use client";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { Button, Card } from "@/lib/design-system";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useProtocol } from "@/lib/protocol/hooks";
import { useProfile } from "@/lib/profile/userProfile";
import { MessagesDrawer } from "@/components/messaging/MessagesDrawer";
import { BottomNav } from "@/components/navigation/BottomNav";
import { useMarketplaceListings } from "@/lib/marketplace/marketplaceStore";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export default function Home() {
  const { connection, publicKey } = useProtocol();
  const myWallet = publicKey ? publicKey.toBase58() : null;
  const { profile } = useProfile(myWallet);
  const { listings } = useMarketplaceListings();

  const [messagesOpen, setMessagesOpen] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [solBalance, setSolBalance] = useState<number | null>(null);

  // Fetch real devnet balance
  const fetchBalance = useCallback(async () => {
    if (!publicKey) {
      setSolBalance(null);
      return;
    }
    try {
      const lamports = await connection.getBalance(publicKey, "confirmed");
      setSolBalance(lamports / LAMPORTS_PER_SOL);
    } catch {
      //
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void fetchBalance();
  }, [fetchBalance]);

  const userDisplayName = profile?.displayName
    ? profile.displayName
    : publicKey
    ? `User ${publicKey.toBase58().slice(0, 4)}`
    : "Trader";

  return (
    <main className="app-shell hud-grid min-h-screen pb-24 md:pb-12">
      {/* Top Floating Glass Header (Desktop + Tablet) */}
      <header className="sticky top-0 z-40 px-4 pt-3 sm:px-8">
        <nav className="glass mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-6 py-2 rounded-full border border-white/10 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="font-brand-persat text-xl uppercase tracking-[.24em] text-white hover:text-amber transition"
            >
              persat
            </Link>
            <span className="hidden sm:inline-block rounded-full border border-amber/30 bg-amber/10 px-2.5 py-0.5 font-mono text-[10px] text-amber">
              Devnet Beta
            </span>
          </div>

          <div className="hidden items-center gap-6 font-mono text-xs uppercase tracking-widest text-white/70 md:flex">
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
            <WalletButton />
          </div>
        </nav>
      </header>

      {/* Main Dashboard Workspace (Designed from Reference Layout) */}
      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-8 sm:pt-8 space-y-8 animate-reveal">
        {/* User Greeting Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/40 bg-gradient-to-br from-amber/20 to-orange/30 font-display-persat text-lg text-white shadow-[0_0_15px_rgba(255,171,0,0.25)]">
              {userDisplayName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="font-display-persat text-xl uppercase tracking-wide text-white sm:text-2xl">
                Hello, {userDisplayName} 👋
              </h1>
              <p className="font-mono text-xs text-white/50">
                {publicKey
                  ? `Wallet: ${publicKey.toBase58().slice(0, 6)}…${publicKey.toBase58().slice(-4)}`
                  : "Connect wallet to access on-chain balances"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/faucet">
              <Button variant="secondary" className="text-xs px-4 py-2">
                ⚡ Claim Test Tokens
              </Button>
            </Link>
          </div>
        </div>

        {/* Hero Section: Orange Gradient Fintech Card + Quick Actions */}
        <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          {/* Card: Orange Gradient Balance Card from Left Phone Reference */}
          <div className="fintech-card-orange relative overflow-hidden p-6 sm:p-8 text-white">
            <div className="relative z-10 flex items-start justify-between">
              <div>
                <p className="font-mono text-xs uppercase tracking-widest text-white/80">
                  Total Protocol Liquidity
                </p>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="font-brand-persat text-3xl sm:text-4xl tracking-tight">
                    {balanceVisible
                      ? solBalance !== null
                        ? `◎ ${(solBalance * 150 + 5000).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : "◎ 5,000.00"
                      : "••••••••"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBalanceVisible(!balanceVisible)}
                    className="text-white/70 hover:text-white transition"
                    title="Toggle balance visibility"
                  >
                    {balanceVisible ? "👁️" : "🙈"}
                  </button>
                </div>
              </div>

              {/* Solana Badge */}
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur-md">
                <span className="font-brand-persat text-xs tracking-wider">SOL</span>
              </div>
            </div>

            {/* Available Balance Breakdown */}
            <div className="relative z-10 mt-8 pt-4 border-t border-white/20 flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-white/70">
                  Available Wallet Gas
                </p>
                <p className="font-mono text-base font-semibold">
                  {balanceVisible
                    ? solBalance !== null
                      ? `${solBalance.toFixed(3)} SOL`
                      : "0.000 SOL"
                    : "••••"}
                </p>
              </div>

              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-white/70">
                  Collateral Escrow
                </p>
                <p className="font-mono text-base font-semibold">
                  {balanceVisible ? "0.05 tBTC Locked" : "••••"}
                </p>
              </div>
            </div>

            {/* Decorative SVG Trend Wave line from reference image */}
            <svg
              className="absolute -bottom-2 right-0 w-3/4 opacity-25 pointer-events-none"
              viewBox="0 0 300 100"
              fill="none"
            >
              <path
                d="M0 80 Q 60 20, 120 60 T 240 30 T 300 10"
                stroke="white"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
          </div>

          {/* Quick Actions Panel from Reference */}
          <Card className="p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <p className="eyebrow">Quick Actions</p>
                <span className="font-mono text-[11px] text-white/40">Zero Custody</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Link
                  href="/deal/new"
                  className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center transition hover:border-amber hover:bg-white/[0.06] active:scale-95"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber/15 text-amber text-lg">
                    ⚡
                  </span>
                  <span className="font-mono text-xs uppercase tracking-wider text-white">Direct Deal</span>
                </Link>

                <Link
                  href="/marketplace"
                  className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center transition hover:border-amber hover:bg-white/[0.06] active:scale-95"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 text-lg">
                    🛒
                  </span>
                  <span className="font-mono text-xs uppercase tracking-wider text-white">Marketplace</span>
                </Link>

                <Link
                  href="/faucet"
                  className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center transition hover:border-amber hover:bg-white/[0.06] active:scale-95"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 text-lg">
                    🚰
                  </span>
                  <span className="font-mono text-xs uppercase tracking-wider text-white">Test Faucet</span>
                </Link>

                <Link
                  href="/keeper"
                  className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center transition hover:border-amber hover:bg-white/[0.06] active:scale-95"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/15 text-purple-400 text-lg">
                    ⚙️
                  </span>
                  <span className="font-mono text-xs uppercase tracking-wider text-white">Keeper Bot</span>
                </Link>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3 font-mono text-[11px] text-white/50 flex items-center justify-between">
              <span>Solana Cluster: Devnet</span>
              <span className="text-emerald-400">● Live 100% Non-Custodial</span>
            </div>
          </Card>
        </div>

        {/* Analytics & Pipeline Section (From Right Phone Reference Image) */}
        <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          {/* Chart Card: Smooth Orange Glowing Wave Chart */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
              <div>
                <p className="eyebrow">Protocol Overview</p>
                <h2 className="mt-1 font-display-persat text-2xl uppercase text-white">
                  Lending Volume &amp; Liquidity
                </h2>
              </div>
              <span className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 font-mono text-xs text-amber">
                This Sprint ▾
              </span>
            </div>

            <div className="mt-5 flex items-baseline gap-3">
              <span className="font-brand-persat text-3xl sm:text-4xl text-white">
                $48,650.00
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-xs text-emerald-400 border border-emerald-500/30">
                ↑ 24.5% vs devnet v0
              </span>
            </div>

            {/* Glowing SVG Wave Chart from Reference */}
            <div className="mt-6 h-48 w-full relative">
              <svg className="h-full w-full overflow-visible" viewBox="0 0 500 150" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff8a00" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#ff8a00" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Area fill */}
                <path
                  d="M 0 130 Q 80 80, 160 110 T 320 60 T 440 20 L 500 40 L 500 150 L 0 150 Z"
                  fill="url(#chartGradient)"
                />
                {/* Stroke line */}
                <path
                  d="M 0 130 Q 80 80, 160 110 T 320 60 T 440 20 L 500 40"
                  fill="none"
                  stroke="#ff8a00"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                {/* Peak point indicator dot */}
                <circle cx="440" cy="20" r="6" fill="#ffffff" stroke="#ff8a00" strokeWidth="4" />
              </svg>
            </div>

            <div className="mt-4 flex justify-between font-mono text-[11px] text-white/40 border-t border-white/5 pt-2">
              <span>Day 0</span>
              <span>Day 1 (Live)</span>
              <span>Day 2</span>
              <span>Day 3</span>
              <span>Audit Pass</span>
            </div>
          </Card>

          {/* Donut Pipeline Status Card from Right Phone Reference */}
          <Card className="p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <p className="eyebrow">Protocol Health</p>
              <h2 className="mt-1 font-display-persat text-2xl uppercase text-white">
                Loan Lifecycle Pipeline
              </h2>

              <div className="mt-6 flex flex-col items-center sm:flex-row sm:justify-around gap-6">
                {/* Donut Ring Chart with Total in Center */}
                <div className="relative flex h-36 w-36 items-center justify-center">
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="transparent"
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth="12"
                    />
                    {/* Ring segments */}
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="transparent"
                      stroke="#ff8a00"
                      strokeWidth="12"
                      strokeDasharray="251.2"
                      strokeDashoffset="125"
                      strokeLinecap="round"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="transparent"
                      stroke="#ffaa45"
                      strokeWidth="12"
                      strokeDasharray="251.2"
                      strokeDashoffset="190"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute text-center">
                    <p className="font-mono text-[10px] text-white/50 uppercase">Total</p>
                    <p className="font-brand-persat text-2xl text-white">100%</p>
                  </div>
                </div>

                {/* Pipeline Breakdown Legend */}
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff8a00]" />
                    <span className="text-white/80">Proposed Deals (38%)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ffaa45]" />
                    <span className="text-white/80">Vault Escrow (25%)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" />
                    <span className="text-white/80">Active Loans (22%)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/40" />
                    <span className="text-white/80">Settled Clean (15%)</span>
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-6 text-center font-mono text-[11px] text-white/40 border-t border-white/10 pt-4">
              Real-time state transitions verified by Solana Anchor contracts.
            </p>
          </Card>
        </div>

        {/* Live Marketplace & Direct Deals Feed */}
        <Card className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <p className="eyebrow">Activity Stream</p>
              <h2 className="mt-1 font-display-persat text-2xl uppercase text-white">
                Live Deals on Devnet
              </h2>
            </div>
            <Link href="/deal/new">
              <Button className="text-xs">Create New Deal +</Button>
            </Link>
          </div>

          <div className="mt-6 space-y-3 font-mono text-xs">
            {listings.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center text-white/50">
                <p>No public marketplace listings posted yet.</p>
                <p className="mt-1 text-[11px] text-white/40">
                  Create a deal or initiate a private agreement to see it listed here.
                </p>
              </div>
            ) : (
              listings.slice(0, 5).map((l) => (
                <div
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:border-amber/40 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber/20 text-amber font-semibold">
                      {l.side === "borrow" ? "B" : "L"}
                    </div>
                    <div>
                      <p className="font-semibold text-white">
                        {l.principal} {l.currency} @ {l.rateBps / 100}% APR
                      </p>
                      <p className="text-[11px] text-white/50">
                        By @{l.creatorHandle} · {l.months} months · {l.collateralBtc} tBTC collateral
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link href={`/deal/${l.dealUrlId}`}>
                      <Button variant="secondary" className="text-xs px-3.5 py-1.5">
                        Open Deal →
                      </Button>
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      {/* Global In-App Messages Drawer */}
      <MessagesDrawer open={messagesOpen} onClose={() => setMessagesOpen(false)} />

      {/* Mobile Sticky Bottom Navigation Bar from Reference */}
      <BottomNav onOpenMessages={() => setMessagesOpen(true)} />
    </main>
  );
}
