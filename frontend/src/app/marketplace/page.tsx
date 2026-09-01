"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useState, useMemo, useEffect } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card } from "@/lib/design-system";
import { MarketplaceFilters } from "@/components/marketplace/MarketplaceFilters";
import { MessagesDrawer } from "@/components/messaging/MessagesDrawer";
import { useMarketplaceListings } from "@/lib/marketplace/marketplaceStore";
import { useBtcPrice } from "@/lib/protocol/oracle";
import { useBridgeHealth } from "@/lib/protocol/bridge";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useProtocol } from "@/lib/protocol/hooks";

export default function Marketplace() {
  const { listings, loading, error, reloadListings } = useMarketplaceListings();
  const { price } = useBtcPrice();
  const { health } = useBridgeHealth();
  const { publicKey } = useProtocol();
  const [activePartner, setActivePartner] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [watched, setWatched] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!publicKey) return;
    try {
      const stored = localStorage.getItem(`persat_watched_${publicKey.toBase58()}`);
      if (stored) {
        const parsed = JSON.parse(stored) as { id: string }[];
        setWatched(new Set(parsed.map((p) => p.id)));
      }
    } catch {}
  }, [publicKey]);

  const handleMessage = (wallet: string) => {
    setActivePartner(wallet);
    setDrawerOpen(true);
  };

  const toggleWatch = (listingId: string) => {
    if (!publicKey) return;
    // Never watch demo/fake ids
    const lid = listingId.toLowerCase();
    if (lid.startsWith("demo") || lid.includes("demo-") || lid.startsWith("fake") || lid.startsWith("sample")) return;

    const newWatched = new Set(watched);
    if (newWatched.has(listingId)) {
      newWatched.delete(listingId);
    } else {
      newWatched.add(listingId);
    }
    setWatched(newWatched);
    // Persist for /deals tracking — real listings only
    try {
      const listing = listings.find((l) => l.id === listingId);
      const stored = localStorage.getItem(`persat_watched_${publicKey.toBase58()}`);
      let watchedDeals: any[] = stored ? JSON.parse(stored) : [];
      // Strip any legacy demo rows
      watchedDeals = watchedDeals.filter(
        (d: any) => d?.id && !String(d.id).toLowerCase().startsWith("demo") && !String(d.id).toLowerCase().includes("demo-"),
      );
      if (newWatched.has(listingId) && listing) {
        if (!watchedDeals.find((d: any) => d.id === listingId)) {
          const principalNum = Number(String(listing.principal).replace(/,/g, "")) || 0;
          const months = Number(listing.months) || 12;
          const dueTs = Date.now() + months * 30 * 24 * 3600 * 1000;
          watchedDeals.push({
            id: listing.id,
            dealUrlId: listing.dealUrlId || listing.id,
            principal: listing.principal,
            currency: listing.currency,
            collateral: `${listing.collateralBtc} BTC`,
            collateralType: "BTC",
            earnings:
              listing.side === "lend"
                ? `+${(principalNum * ((listing.rateBps || 820) / 10000) * (months / 12)).toFixed(2)} ${listing.currency}`
                : `-${(principalNum * 0.02).toFixed(2)} ${listing.currency}`,
            dueDate: new Date(dueTs).toLocaleDateString(),
            dueTimestamp: dueTs,
            status: "pending",
            role: listing.side === "borrow" ? "lender" : "borrower",
            createdAt: listing.createdAt || Date.now(),
            source: "watched",
            counterparty: listing.creatorWallet,
          });
        }
      } else {
        watchedDeals = watchedDeals.filter((d: any) => d.id !== listingId);
      }
      localStorage.setItem(`persat_watched_${publicKey.toBase58()}`, JSON.stringify(watchedDeals));
    } catch {}
  };

  const visibleListings = useMemo(() => listings.slice(0, visibleCount), [listings, visibleCount]);

  return (
    <ErrorBoundary>
      <AppFrame eyebrow="Marketplace // BTC Default Auto → tBTC/zBTC" title="Open Listings — Watch, Track Earnings & Due Date">
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-3">
            <Link href="/deal/new">
              <Button>+ Post Public Listing (BTC default)</Button>
            </Link>
            <Link href="/deal/new">
              <Button variant="secondary">Create Direct Deal</Button>
            </Link>
            <Button variant="secondary" onClick={() => void reloadListings()} className="text-xs">
              ↻ Refresh
            </Button>
            <Link href="/">
              <Button variant="secondary" className="text-xs">My Tracked Deals →</Button>
            </Link>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-white/60">
              {price ? `BTC $${price.price.toLocaleString()} ${price.isStale ? "⚠ stale" : "✓"}` : "BTC price loading..."}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-white/60">
              {health ? `${health.bridges.filter((b) => b.available).length}/${health.bridges.length} bridges auto` : "Bridges..."}
            </span>
            <span className="rounded-full border border-amber/20 bg-amber/10 px-3 py-1 text-amber">{listings.length} live • BTC default</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-amber/20 bg-amber/5 p-3 font-mono text-[11px] text-white/60">
          <p><span className="text-amber">New:</span> BTC is default deposit — system auto-converts to tBTC/zBTC via live health (pause/status, success rate, liquidity). You can still manually select tBTC/zBTC if you already hold them. Watch deals to track earnings & due date on home page. One-click faucet — no bundle upload needed.</p>
        </div>

        <MarketplaceFilters />

        {error && (
          <div className="mt-6 rounded-xl border border-amber/30 bg-amber/10 p-4 font-mono text-xs text-amber">
            Marketplace sync degraded — showing cached listings. {error.slice(0, 120)}
          </div>
        )}

        <div className="mt-8 space-y-4">
          {loading && listings.length === 0 ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="glass sheen rounded-[22px] p-6 animate-pulse">
                  <div className="shimmer-box h-4 w-32 mb-3" />
                  <div className="shimmer-box h-6 w-64" />
                </div>
              ))}
            </div>
          ) : listings.length === 0 ? (
            <Card className="p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] text-2xl text-amber">📋</div>
              <h3 className="mt-4 font-display-persat text-xl uppercase text-white">No Open Listings Yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/60">
                No unconfirmed public deals. Create a deal without counterparty to publish — BTC default auto-routes to best bridge. Watch to track earnings & due date.
              </p>
              <div className="mt-6">
                <Link href="/deal/new">
                  <Button className="px-6">Post First Public Deal (BTC) →</Button>
                </Link>
              </div>
            </Card>
          ) : (
            <>
              {visibleListings.map((listing) => {
                const earnings = listing.side === "lend" ? `+${(Number(listing.principal) * 0.02).toFixed(2)} ${listing.currency}` : `-${(Number(listing.principal) * 0.02).toFixed(2)} ${listing.currency} cost`;
                const dueDate = new Date(Date.now() + listing.months * 30 * 24 * 3600 * 1000).toLocaleDateString();
                const isWatched = watched.has(listing.id);
                return (
                  <Card key={listing.id} className={`p-6 hover:border-amber/20 transition ${isWatched ? "border-amber/30 bg-amber/[0.02]" : ""}`}>
                    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${listing.side === "lend" ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border border-amber/30 bg-amber/10 text-amber"}`}>
                            {listing.side === "lend" ? "● Seeking to Lend" : "● Seeking to Borrow"}
                          </span>
                          <Link href={`/profile/${listing.creatorHandle}`} className="font-mono text-xs font-semibold text-white hover:text-amber transition">
                            @{listing.creatorHandle}
                          </Link>
                          <span className="font-mono text-[10px] text-white/40">({listing.reputation}% Trust) • {listing.source} • BTC auto</span>
                          {isWatched && <span className="rounded-full bg-amber/20 px-2 py-0.5 font-mono text-[10px] text-amber">★ Watching</span>}
                        </div>
                        <div className="flex flex-wrap items-baseline gap-4 pt-1">
                          <p className="font-brand-persat text-2xl text-white">{listing.principal} {listing.currency}</p>
                          <p className="font-mono text-xs text-white/60">Collateral: <span className="font-semibold text-white">{listing.collateralBtc} BTC</span> auto tBTC/zBTC</p>
                          <p className="font-mono text-xs text-white/60">Rate: <span className="font-semibold text-amber">{listing.rateBps / 100}% APR</span></p>
                          <p className="font-mono text-xs text-white/60">Term: <span className="text-white">{listing.months}m</span></p>
                          <p className="font-mono text-xs text-emerald-400">Earnings: {earnings}</p>
                          <p className="font-mono text-xs text-white/50">Due: {dueDate}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => toggleWatch(listing.id)}>
                          {isWatched ? "★ Watching" : "☆ Watch"}
                        </Button>
                        <Link href={`/profile/${listing.creatorHandle}`}><Button variant="secondary" className="text-xs px-4">Profile</Button></Link>
                        <Button variant="secondary" onClick={() => handleMessage(listing.creatorWallet)} className="text-xs px-4">💬 Negotiate</Button>
                        <Link href={`/deal/${listing.dealUrlId}`}><Button className="text-xs px-5">Fulfill Deal →</Button></Link>
                      </div>
                    </div>
                  </Card>
                );
              })}
              {listings.length > visibleCount && (
                <div className="flex justify-center pt-4">
                  <Button variant="secondary" onClick={() => setVisibleCount((c) => c + 20)} className="text-xs px-6">
                    Load {Math.min(20, listings.length - visibleCount)} more — {listings.length - visibleCount} remaining
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <MessagesDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} initialPartner={activePartner} />
      </AppFrame>
    </ErrorBoundary>
  );
}
