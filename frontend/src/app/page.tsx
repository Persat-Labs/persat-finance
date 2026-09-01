"use client";
import Link from "next/link";
import { useState } from "react";
import { Button, Card } from "@/lib/design-system";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useProtocol } from "@/lib/protocol/hooks";
import { useProfile } from "@/lib/profile/userProfile";
import { NotificationPopover } from "@/components/messaging/NotificationPopover";
import { BottomNav } from "@/components/navigation/BottomNav";
import { useUserRealBalances } from "@/lib/protocol/userBalance";
import { OnboardingFlow, useOnboarding } from "@/components/onboarding/OnboardingFlow";
import { FundWalletModal } from "@/components/wallet/FundWalletModal";
import { useBtcPrice } from "@/lib/protocol/oracle";

export default function Home() {
  const { connection, publicKey } = useProtocol();
  const myWallet = publicKey ? publicKey.toBase58() : null;
  const { profile } = useProfile(myWallet);
  const userBalances = useUserRealBalances(connection, publicKey);
  const { price: btcPrice } = useBtcPrice();

  const { gateReady, showOnboarding, openOnboarding, closeOnboarding } = useOnboarding();
  const [fundingOpen, setFundingOpen] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);

  const userDisplayName = profile?.displayName
    ? profile.displayName
    : publicKey
    ? `User ${publicKey.toBase58().slice(0, 4)}`
    : "Trader";

  // Gate: wait for wallet autoConnect, then either onboarding-only OR dashboard.
  // Never paint dashboard under onboarding (no tab bar flash on mobile).
  if (!gateReady) {
    return (
      <main className="app-shell flex min-h-screen items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/persatlogo.png" alt="Persat Finance" className="h-14 w-14 object-contain" />
          <span className="font-brand-persat text-sm uppercase tracking-[.3em] text-white/50">persat</span>
        </div>
      </main>
    );
  }

  if (showOnboarding) {
    return (
      <main className="app-shell min-h-screen bg-black">
        <OnboardingFlow onComplete={closeOnboarding} onOpenFunding={() => setFundingOpen(true)} />
        <FundWalletModal open={fundingOpen} onClose={() => setFundingOpen(false)} />
      </main>
    );
  }

  return (
    <main className="app-shell hud-grid min-h-screen pb-24 md:pb-12">
      <header className="sticky top-0 z-40 overflow-visible px-4 pt-3 sm:px-8">
        <nav className="glass mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 overflow-visible px-6 py-2 rounded-full border border-white/10 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <Link href="/" className="font-brand-persat text-xl uppercase tracking-[.24em] text-white hover:text-amber transition">
              persat
            </Link>
            <span className="hidden sm:inline-block rounded-full border border-amber/30 bg-amber/10 px-2.5 py-0.5 font-mono text-[10px] text-amber">
              Devnet Beta • BTC Default Auto
            </span>
          </div>

          <div className="hidden items-center gap-7 font-ui text-xs uppercase tracking-wider text-white/70 md:flex">
            <Link href="/deals" className="hover:text-amber transition">
              My Deals
            </Link>
            <Link href="/deal/new" className="hover:text-amber transition">
              New Deal
            </Link>
            <Link href="/marketplace" className="hover:text-amber transition">
              Marketplace
            </Link>
            <Link href="/messages" className="hover:text-amber transition">
              Messages
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
                onClick={() => setFundingOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 px-3.5 py-1.5 font-ui text-[11px] uppercase tracking-wider text-amber hover:bg-amber/20 transition"
              >
                <span>⚡</span>
                <span>Test Funds</span>
              </button>
            )}
            {myWallet && <NotificationPopover />}
            <WalletButton />
          </div>
        </nav>
      </header>

      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-8 sm:pt-8 space-y-8 animate-reveal">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/40 bg-gradient-to-br from-amber/20 to-orange/30 font-bold text-lg text-white shadow-[0_0_15px_rgba(255,171,0,0.25)]">
              {userDisplayName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
                Hello, {userDisplayName} 👋
              </h1>
              <p className="font-mono text-xs text-white/50">
                {publicKey
                  ? `Wallet: ${publicKey.toBase58().slice(0, 6)}…${publicKey.toBase58().slice(-4)} • BTC default auto → tBTC/zBTC via live health`
                  : "Connect wallet — one-click test funds, BTC default auto-routing"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/deals">
              <Button variant="secondary" className="text-xs px-4 py-2">
                My Deals →
              </Button>
            </Link>
            <Button variant="secondary" onClick={() => setFundingOpen(true)} className="text-xs px-4 py-2">
              ⚡ Claim Test Funds
            </Button>
            <button type="button" onClick={openOnboarding} className="font-ui text-xs uppercase tracking-wider text-white/40 hover:text-amber px-2 transition">
              Guide *
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          <div className="fintech-card-orange relative overflow-hidden p-6 sm:p-8 text-white">
            <div className="relative z-10 flex items-start justify-between">
              <div>
                <p className="font-ui text-xs uppercase tracking-widest text-white/80 font-semibold">Total Portfolio Value</p>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="font-mono text-3xl sm:text-4xl font-bold tracking-tight text-white">
                    {publicKey ? (balanceVisible ? `$${userBalances.totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "******") : "$0.00"}
                  </span>
                  {publicKey && (
                    <button type="button" onClick={() => setBalanceVisible(!balanceVisible)} className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/15 transition">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d={balanceVisible ? "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" : "m2 2 20 20"} />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  )}
                </div>
                <p className="mt-1 font-mono text-[11px] text-white/70">
                  {btcPrice ? `BTC $${btcPrice.price.toLocaleString()} • ` : ""}Available + Locked • Auto tBTC/zBTC
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur-md">
                <span className="font-mono text-xs font-bold">BTC</span>
              </div>
            </div>

            <div className="relative z-10 mt-8 pt-4 border-t border-white/20 grid grid-cols-3 gap-4">
              <div>
                <p className="font-ui text-[11px] uppercase tracking-wider text-white/70">Available</p>
                <p className="font-mono text-base font-semibold">{publicKey ? (balanceVisible ? `${userBalances.availableBtc.toFixed(4)} BTC` : "****") : "0.0000 BTC"}</p>
                <p className="font-mono text-[10px] text-white/50">tBTC + zBTC in wallet</p>
              </div>
              <div>
                <p className="font-ui text-[11px] uppercase tracking-wider text-white/70">Locked Collateral</p>
                <p className="font-mono text-base font-semibold">{publicKey ? (balanceVisible ? `${userBalances.lockedCollateralBtc.toFixed(4)} BTC` : "****") : "0.0000 BTC"}</p>
                <p className="font-mono text-[10px] text-white/50">Vault PDA non-custodial</p>
              </div>
              <div>
                <p className="font-ui text-[11px] uppercase tracking-wider text-white/70">Gas</p>
                <p className="font-mono text-base font-semibold">{publicKey ? (balanceVisible ? `${userBalances.solBalance.toFixed(3)} SOL` : "****") : "0.000 SOL"}</p>
                <p className="font-mono text-[10px] text-white/50">For transactions</p>
              </div>
            </div>

            <svg className="absolute -bottom-2 right-0 w-3/4 opacity-25 pointer-events-none" viewBox="0 0 300 100" fill="none">
              <path d="M0 80 Q 60 20, 120 60 T 240 30 T 300 10" stroke="white" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>

          <Card className="p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <p className="eyebrow">Wallet Tokens — Available / Locked / Total</p>
                <Link href="/faucet" className="font-mono text-[11px] text-amber hover:text-white">Faucet →</Link>
              </div>

              <div className="mt-4 space-y-2">
                {publicKey ? (
                  userBalances.tokenList.map((token) => (
                    <div key={token.symbol} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-3 hover:border-white/10 transition">
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ${token.symbol === "BTC" ? "bg-orange-500/20 text-orange-400" : token.symbol.includes("BTC") ? "bg-amber/15 text-amber" : token.symbol === "SOL" ? "bg-purple-500/15 text-purple-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                          {token.symbol.slice(0, 3)}
                        </div>
                        <div>
                          <p className="font-mono text-xs font-semibold text-white">{token.symbol}</p>
                          <p className="font-mono text-[10px] text-white/40">{token.symbol === "BTC" ? "Auto → tBTC/zBTC" : token.symbol === "tBTC" ? "Threshold" : token.symbol === "zBTC" ? "Zeus" : token.symbol === "SOL" ? "Gas" : "$1 stable"}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xs font-semibold text-white">
                          {balanceVisible ? `${token.balance.toFixed(token.symbol === "SOL" ? 3 : token.symbol.includes("BTC") || token.symbol === "BTC" ? 4 : 2)} ${token.symbol}` : "****"}
                        </p>
                        <p className="font-mono text-[10px] text-white/40">{balanceVisible ? `$${token.usdValue.toFixed(2)}` : "****"} {token.locked ? `• ${token.locked.toFixed(4)} locked` : ""}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center">
                    <p className="font-mono text-xs text-white/50">Connect wallet to see real token balances</p>
                    <p className="mt-1 font-mono text-[11px] text-white/30">BTC default auto-converts via live bridge health • One-click faucet no upload</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3 font-mono text-[11px] text-white/50 flex items-center justify-between">
              <span>Devnet • One-click faucet • BTC default</span>
              <span className="text-emerald-400 font-semibold">● Non-Custodial</span>
            </div>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
              <div>
                <p className="eyebrow">Portfolio Overview</p>
                <h2 className="mt-1 font-display text-2xl font-bold uppercase text-white">Balance & Locked Summary</h2>
              </div>
              <Link href="/deals">
                <Button variant="secondary" className="text-xs">My Deals →</Button>
              </Link>
            </div>

            <div className="mt-5 flex items-baseline gap-3">
              <span className="font-mono text-3xl sm:text-4xl font-bold text-white">${userBalances.totalUsdValue > 0 ? userBalances.totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "0.00"}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-xs text-emerald-400 border border-emerald-500/30">100% Non-Custodial</span>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 font-mono text-xs">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <p className="text-white/50">Available Balance</p>
                <p className="mt-1 text-lg font-bold text-white">${(userBalances.usdcBalance + userBalances.usdtBalance).toFixed(2)}</p>
                <p className="text-[10px] text-white/30">USDC + USDT spendable</p>
              </div>
              <div className="rounded-xl border border-amber/20 bg-amber/5 p-4">
                <p className="text-white/50">Locked Collateral</p>
                <p className="mt-1 text-lg font-bold text-amber">{userBalances.lockedCollateralBtc.toFixed(4)} BTC</p>
                <p className="text-[10px] text-white/30">In vault PDA, non-custodial</p>
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <Link href="/deal/new" className="flex-1">
                <Button className="w-full text-xs">New Deal (BTC default) →</Button>
              </Link>
              <Link href="/faucet" className="flex-1">
                <Button variant="secondary" className="w-full text-xs">Claim Test Funds</Button>
              </Link>
            </div>
          </Card>

          <Card className="p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <p className="eyebrow">Quick Actions</p>
              <h2 className="mt-1 font-display text-2xl font-bold uppercase text-white">BTC Default Auto</h2>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <Link href="/deals" className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-amber/30 bg-amber/10 p-4 text-center hover:bg-amber/15 transition">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber/20 text-amber text-lg">📋</span>
                  <span className="font-ui text-xs uppercase tracking-wider text-white">My Deals</span>
                  <span className="font-mono text-[10px] text-white/40">Track earnings & due</span>
                </Link>
                <Link href="/deal/new" className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center hover:border-amber hover:bg-white/[0.06] transition">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 text-lg">⚡</span>
                  <span className="font-ui text-xs uppercase tracking-wider text-white">New Deal</span>
                  <span className="font-mono text-[10px] text-white/40">BTC auto → tBTC/zBTC</span>
                </Link>
                <Link href="/marketplace" className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center hover:border-amber hover:bg-white/[0.06] transition">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 text-lg">🛒</span>
                  <span className="font-ui text-xs uppercase tracking-wider text-white">Marketplace</span>
                  <span className="font-mono text-[10px] text-white/40">Watch to track</span>
                </Link>
                <button type="button" onClick={() => setFundingOpen(true)} className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center hover:border-amber hover:bg-white/[0.06] transition">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/15 text-purple-400 text-lg">⚡</span>
                  <span className="font-ui text-xs uppercase tracking-wider text-white">Test Funds</span>
                  <span className="font-mono text-[10px] text-white/40">One click, no upload</span>
                </button>
              </div>
            </div>

            <p className="mt-6 text-center font-mono text-[11px] text-white/40 border-t border-white/10 pt-4">BTC default auto-routes via live health (pause/status, success rate, liquidity) • Non-custodial vault PDA</p>
          </Card>
        </div>
      </section>

      <BottomNav hidden={false} />

      <FundWalletModal open={fundingOpen} onClose={() => setFundingOpen(false)} />
    </main>
  );
}
