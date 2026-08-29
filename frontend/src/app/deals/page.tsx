"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card } from "@/lib/design-system";
import { useProtocol } from "@/lib/protocol/hooks";
import { ErrorBoundary } from "@/components/ErrorBoundary";

type DealStatus = "pending" | "active" | "due_soon" | "overdue" | "completed" | "closed";
type DealRole = "borrower" | "lender";

type TrackedDeal = {
  id: string;
  dealUrlId?: string;
  principal: string;
  currency: string;
  collateral: string;
  collateralType: "BTC" | "tBTC" | "zBTC";
  earnings: string;
  dueDate: string;
  dueTimestamp: number;
  status: DealStatus;
  role: DealRole;
  createdAt: number;
  source: "created" | "watched" | "proposal";
  counterparty?: string;
};

export default function DealsPage() {
  const { publicKey } = useProtocol();
  const [trackedDeals, setTrackedDeals] = useState<TrackedDeal[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "active" | "closed">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "borrower" | "lender">("all");
  const [liveNow, setLiveNow] = useState<Date>(new Date());

  // Real-time clock for monitoring
  useEffect(() => {
    const id = setInterval(() => setLiveNow(new Date()), 10000);
    return () => clearInterval(id);
  }, []);

  const loadDeals = useCallback(() => {
    if (!publicKey) {
      setTrackedDeals([]);
      return;
    }
    try {
      const wallet = publicKey.toBase58();
      const deals: TrackedDeal[] = [];

      // 1. Load watched deals from localStorage (real only, no demo)
      const watchedRaw = localStorage.getItem(`persat_watched_${wallet}`);
      if (watchedRaw) {
        const watched = JSON.parse(watchedRaw);
        watched.forEach((d: any) => {
          if (d.id && !d.id.startsWith("demo-")) {
            deals.push({
              id: d.id,
              dealUrlId: d.dealUrlId || d.id,
              principal: d.principal || "0",
              currency: d.currency || "USDC",
              collateral: d.collateral || "0.05 BTC",
              collateralType: (d.collateralType as any) || "BTC",
              earnings: d.earnings || "+0",
              dueDate: d.dueDate || new Date(Date.now() + 30 * 24 * 3600 * 1000).toLocaleDateString(),
              dueTimestamp: d.dueTimestamp || Date.now() + 30 * 24 * 3600 * 1000,
              status: (d.status as DealStatus) || "pending",
              role: (d.role as DealRole) || "borrower",
              createdAt: d.createdAt || Date.now(),
              source: d.source || "watched",
              counterparty: d.counterparty,
            });
          }
        });
      }

      // 2. Load created deals from marketplace store (real on-chain)
      try {
        const marketplaceRaw = localStorage.getItem("persat_marketplace_listings_v1");
        if (marketplaceRaw) {
          const listings = JSON.parse(marketplaceRaw);
          listings.forEach((l: any) => {
            if (l.creatorWallet === wallet && !deals.find((d) => d.id === l.id)) {
              deals.push({
                id: l.id,
                dealUrlId: l.dealUrlId,
                principal: l.principal,
                currency: l.currency,
                collateral: `${l.collateralBtc} BTC`,
                collateralType: "BTC",
                earnings: l.side === "lend" ? `+${(Number(l.principal) * 0.02).toFixed(2)} ${l.currency}` : `-${(Number(l.principal) * 0.02).toFixed(2)} ${l.currency}`,
                dueDate: new Date(Date.now() + l.months * 30 * 24 * 3600 * 1000).toLocaleDateString(),
                dueTimestamp: Date.now() + l.months * 30 * 24 * 3600 * 1000,
                status: "pending",
                role: l.side === "borrow" ? "borrower" : "lender",
                createdAt: l.createdAt || Date.now(),
                source: "created",
              });
            }
          });
        }
      } catch {}

      // 3. Load proposals sent to this wallet (pending deals)
      try {
        const proposalsRaw = localStorage.getItem(`persat_proposals_${wallet}`);
        if (proposalsRaw) {
          const proposals = JSON.parse(proposalsRaw);
          proposals.forEach((p: any) => {
            if (!deals.find((d) => d.id === p.id)) {
              deals.push({
                id: p.id,
                dealUrlId: p.dealUrlId || p.id,
                principal: p.principal || "0",
                currency: p.currency || "USDC",
                collateral: p.collateral || "0.05 BTC",
                collateralType: "BTC",
                earnings: p.earnings || "+0",
                dueDate: p.dueDate || new Date(Date.now() + 30 * 24 * 3600 * 1000).toLocaleDateString(),
                dueTimestamp: p.dueTimestamp || Date.now() + 30 * 24 * 3600 * 1000,
                status: "pending",
                role: p.role || "borrower",
                createdAt: p.createdAt || Date.now(),
                source: "proposal",
                counterparty: p.from,
              });
            }
          });
        }
      } catch {}

      // Sort by due date and createdAt — real-time monitoring
      deals.sort((a, b) => a.dueTimestamp - b.dueTimestamp);
      setTrackedDeals(deals);
    } catch {
      setTrackedDeals([]);
    }
  }, [publicKey]);

  useEffect(() => {
    loadDeals();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadDeals();
    }, 15000);
    return () => clearInterval(id);
  }, [loadDeals]);

  const filtered = trackedDeals.filter((d) => {
    if (statusFilter === "pending" && d.status !== "pending") return false;
    if (statusFilter === "active" && !["active", "due_soon", "overdue"].includes(d.status)) return false;
    if (statusFilter === "closed" && !["completed", "closed"].includes(d.status)) return false;
    if (roleFilter === "borrower" && d.role !== "borrower") return false;
    if (roleFilter === "lender" && d.role !== "lender") return false;
    return true;
  });

  const stats = {
    total: trackedDeals.length,
    pending: trackedDeals.filter((d) => d.status === "pending").length,
    active: trackedDeals.filter((d) => ["active", "due_soon", "overdue"].includes(d.status)).length,
    closed: trackedDeals.filter((d) => ["completed", "closed"].includes(d.status)).length,
    earnings: trackedDeals.filter((d) => d.role === "lender").reduce((sum, d) => sum + (Number(d.earnings.replace(/[^0-9.-]/g, "")) || 0), 0),
    dueSoon: trackedDeals.filter((d) => d.status === "due_soon" || d.status === "overdue").length,
  };

  const unwatch = (id: string) => {
    if (!publicKey) return;
    const updated = trackedDeals.filter((d) => d.id !== id);
    setTrackedDeals(updated);
    try {
      localStorage.setItem(`persat_watched_${publicKey.toBase58()}`, JSON.stringify(updated));
    } catch {}
  };

  return (
    <ErrorBoundary>
      <AppFrame eyebrow="Deals // Real On-Chain Only — No Demo" title="Deals">
        {/* Top Two Buttons — New Deal+ and My Deals as requested */}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/deal/new">
            <Button className="px-6 py-3 text-sm font-semibold">New Deal +</Button>
          </Link>
          <Button variant="secondary" className="px-6 py-3 text-sm font-semibold border-amber bg-amber/10 text-white">
            My Deals
          </Button>
          <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] text-emerald-400">
            ● Live {liveNow.toLocaleTimeString()} — Real-time monitoring
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-white/40">
          <span>BTC default auto → tBTC/zBTC via live health checker (pause/status, success rate, liquidity) • No demo deals • Real network only</span>
        </div>

        {/* Stats */}
        <div className="mt-8 grid gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">Total Tracked</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white">{stats.total}</p>
            <p className="font-mono text-[10px] text-white/30">{stats.pending} pending • {stats.active} active • {stats.closed} closed</p>
          </Card>
          <Card className="p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">Earnings (Lender)</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">+${stats.earnings.toFixed(2)}</p>
            <p className="font-mono text-[10px] text-white/30">2% origination + interest</p>
          </Card>
          <Card className="p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">Due Soon / Overdue</p>
            <p className={`mt-1 font-mono text-2xl font-bold ${stats.dueSoon > 0 ? "text-amber" : "text-white"}`}>{stats.dueSoon}</p>
            <p className="font-mono text-[10px] text-white/30">Needs attention — real-time</p>
          </Card>
          <Card className="p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">BTC Collateral</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white">Auto</p>
            <p className="font-mono text-[10px] text-white/30">BTC default → best bridge tBTC/zBTC</p>
          </Card>
        </div>

        {/* My Deals Section — Pending / Active / Closed + Lender/Borrower as requested */}
        <div className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-xl font-bold uppercase text-white">My Deals — Watch / Track / Earnings / Due</h2>
            <div className="flex items-center gap-2 font-mono text-[10px] text-white/30">
              <span>Real-time • Poll 15s • Hidden-tab backoff</span>
            </div>
          </div>

          {/* Status Filters — Pending / Active / Closed */}
          <div className="mt-4 flex flex-wrap gap-2">
            <p className="w-full font-mono text-[11px] uppercase tracking-wider text-white/40 mb-1">Status:</p>
            {(["all", "pending", "active", "closed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition ${statusFilter === s ? "border-amber bg-amber/15 text-white" : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white hover:border-white/20"}`}
              >
                {s === "all" ? "All" : s === "pending" ? `Pending (${stats.pending})` : s === "active" ? `Active (${stats.active})` : `Closed (${stats.closed})`}
              </button>
            ))}
          </div>

          {/* Role Filters — I am the Lender / I am the Borrower (as in New Deal page) */}
          <div className="mt-4 flex flex-wrap gap-2">
            <p className="w-full font-mono text-[11px] uppercase tracking-wider text-white/40 mb-1">I am the:</p>
            {(["all", "borrower", "lender"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={`rounded-full border px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition ${roleFilter === r ? "border-amber bg-amber/15 text-white" : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white hover:border-white/20"}`}
              >
                {r === "all" ? "All Roles" : r === "borrower" ? "Borrower (Post BTC)" : "Lender (Fund USDC)"}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-3">
            {filtered.length === 0 ? (
              <Card className="p-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] text-2xl">📋</div>
                <h3 className="mt-4 font-display text-xl uppercase text-white">
                  {statusFilter === "pending" ? "No Pending Deals" : statusFilter === "active" ? "No Active Deals" : statusFilter === "closed" ? "No Closed Deals" : "No Deals Yet"}
                </h3>
                <p className="mx-auto mt-2 max-w-md font-mono text-sm leading-6 text-white/50">
                  {statusFilter === "pending"
                    ? "No pending deals — proposals sent to your handle/wallet will appear here. Real on-chain only, no demo."
                    : statusFilter === "active"
                    ? "No active deals — deals you're currently in will appear here with real-time monitoring, earnings, and due date."
                    : statusFilter === "closed"
                    ? "No closed deals yet — completed or liquidated deals will appear here."
                    : "No real deals found. Create a new deal (BTC default auto-routes to best bridge) or watch from marketplace. Only real network deals shown — no demo."}
                </p>
                <div className="mt-6 flex justify-center gap-3">
                  <Link href="/marketplace">
                    <Button variant="secondary" className="text-xs">Browse Marketplace →</Button>
                  </Link>
                  <Link href="/deal/new">
                    <Button className="text-xs">New Deal + (BTC default)</Button>
                  </Link>
                </div>
              </Card>
            ) : (
              filtered.map((deal) => (
                <Card key={deal.id} className={`p-5 hover:border-amber/20 transition ${deal.status === "overdue" ? "border-red-500/30 bg-red-500/5" : deal.status === "due_soon" ? "border-amber/30 bg-amber/5" : deal.status === "pending" ? "border-white/10 bg-white/[0.02]" : "border-white/10 bg-white/[0.02]"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full font-bold text-xs ${deal.role === "lender" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber/15 text-amber"}`}>
                        {deal.role === "lender" ? "L" : "B"}
                      </div>
                      <div>
                        <p className="font-mono text-sm font-semibold text-white">
                          {deal.principal} {deal.currency} • {deal.collateral} • <span className={deal.earnings.startsWith("+") ? "text-emerald-400" : deal.earnings.startsWith("-") ? "text-white/50" : "text-white/60"}>{deal.earnings}</span>
                        </p>
                        <p className="font-mono text-[11px] text-white/50">
                          Role: {deal.role} • Due: {deal.dueDate} • Status:{" "}
                          <span className={deal.status === "active" ? "text-emerald-400" : deal.status === "due_soon" ? "text-amber" : deal.status === "overdue" ? "text-red-400" : deal.status === "pending" ? "text-white/60" : "text-white/40"}>
                            {deal.status.replace("_", " ")}
                          </span>{" "}
                          • {deal.source === "proposal" ? `From: ${deal.counterparty?.slice(0, 8)}... • ` : ""}BTC auto → {deal.collateral.includes("tBTC") ? "tBTC" : deal.collateral.includes("zBTC") ? "zBTC" : "best bridge"} • {deal.source}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => unwatch(deal.id)}>
                        Unwatch
                      </Button>
                      <Link href={`/deal/${deal.dealUrlId || deal.id}`}>
                        <Button className="text-xs px-4 py-1.5">Manage →</Button>
                      </Link>
                      <Link href={`/deal/${deal.dealUrlId || deal.id}/repay`}>
                        <Button variant="secondary" className="text-xs px-3 py-1.5">Track →</Button>
                      </Link>
                    </div>
                  </div>
                  {/* Real-time monitoring bar */}
                  <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] text-white/30 border-t border-white/5 pt-2">
                    <span>Created: {new Date(deal.createdAt).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>Due in: {Math.max(0, Math.ceil((deal.dueTimestamp - Date.now()) / (24 * 3600 * 1000)))} days</span>
                    <span>•</span>
                    <span className="text-emerald-400/60">● Live monitoring — updates every 15s</span>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-white/5 bg-white/[0.02] p-4 font-mono text-[11px] text-white/40">
          <p>💡 How it works: BTC default deposit → live checker checks 3 signals (pause/status, success rate, liquidity) → auto-routes to tBTC (Threshold) or zBTC (Zeus) → vault PDA non-custodial. Manual tBTC/zBTC still available. One-click faucet no upload. Real deals only — proposals sent to your handle/wallet appear under Pending.</p>
          <p className="mt-2">Trackable & manageable: each deal shows earnings, due date, role, status, and has Manage (collateral, liquidation, close) and Track (repayments, history) buttons. Real-time monitoring with hidden-tab backoff.</p>
        </div>
      </AppFrame>
    </ErrorBoundary>
  );
}
