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

/** Reject demo / fake / seed rows — real network or user-initiated only. */
function isUnrealDealId(id: unknown): boolean {
  if (typeof id !== "string" || !id.trim()) return true;
  const s = id.trim().toLowerCase();
  return (
    s.startsWith("demo") ||
    s.startsWith("fake") ||
    s.startsWith("sample") ||
    s.startsWith("mock") ||
    s.startsWith("seed") ||
    s.includes("demo-") ||
    s === "demo-1" ||
    s === "demo-2"
  );
}

function isRealDeal(d: Partial<TrackedDeal> & { id?: string }): boolean {
  if (!d?.id || isUnrealDealId(d.id)) return false;
  if (d.dealUrlId && isUnrealDealId(d.dealUrlId)) return false;
  // Must have some principal signal
  const p = String(d.principal ?? "").replace(/[^0-9.]/g, "");
  if (!p || Number(p) <= 0) return false;
  return true;
}

const MARKETPLACE_KEYS = ["persat_marketplace_listings_live_v2", "persat_marketplace_listings_v1"];

function purgeDemoFromStorage(wallet: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (wallet) {
      const key = `persat_watched_${wallet}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const cleaned = arr.filter((d: any) => d && !isUnrealDealId(d.id) && !isUnrealDealId(d.dealUrlId));
          localStorage.setItem(key, JSON.stringify(cleaned));
        }
      }
      const propKey = `persat_proposals_${wallet}`;
      const propRaw = localStorage.getItem(propKey);
      if (propRaw) {
        const arr = JSON.parse(propRaw);
        if (Array.isArray(arr)) {
          localStorage.setItem(propKey, JSON.stringify(arr.filter((d: any) => d && !isUnrealDealId(d.id))));
        }
      }
    }
    for (const mk of MARKETPLACE_KEYS) {
      const raw = localStorage.getItem(mk);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        localStorage.setItem(mk, JSON.stringify(arr.filter((l: any) => l && !isUnrealDealId(l.id) && !isUnrealDealId(l.dealUrlId) && !isUnrealDealId(l.dealId))));
      }
    }
  } catch {}
}

export default function DealsPage() {
  const { publicKey } = useProtocol();
  const [trackedDeals, setTrackedDeals] = useState<TrackedDeal[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "active" | "closed">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "borrower" | "lender">("all");
  const [liveNow, setLiveNow] = useState<Date>(new Date());

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
      purgeDemoFromStorage(wallet);
      const deals: TrackedDeal[] = [];
      const seen = new Set<string>();

      const pushDeal = (d: TrackedDeal) => {
        if (!isRealDeal(d)) return;
        const key = d.dealUrlId || d.id;
        if (seen.has(key) || seen.has(d.id)) return;
        seen.add(key);
        seen.add(d.id);
        deals.push(d);
      };

      // 1. Watched deals (user-initiated watch from marketplace — no demo)
      try {
        const watchedRaw = localStorage.getItem(`persat_watched_${wallet}`);
        if (watchedRaw) {
          const watched = JSON.parse(watchedRaw);
          if (Array.isArray(watched)) {
            watched.forEach((d: any) => {
              pushDeal({
                id: d.id,
                dealUrlId: d.dealUrlId || d.id,
                principal: String(d.principal ?? "0"),
                currency: d.currency || "USDC",
                collateral: d.collateral || `${d.collateralBtc || "0"} BTC`,
                collateralType: (d.collateralType as any) || "BTC",
                earnings: d.earnings || "+0",
                dueDate: d.dueDate || new Date(d.dueTimestamp || Date.now()).toLocaleDateString(),
                dueTimestamp: Number(d.dueTimestamp) || Date.now() + 30 * 24 * 3600 * 1000,
                status: (d.status as DealStatus) || "pending",
                role: (d.role as DealRole) || "borrower",
                createdAt: Number(d.createdAt) || Date.now(),
                source: d.source || "watched",
                counterparty: d.counterparty,
              });
            });
          }
        }
      } catch {}

      // 2. Listings this wallet created (marketplace store — real propose flow)
      for (const mk of MARKETPLACE_KEYS) {
        try {
          const marketplaceRaw = localStorage.getItem(mk);
          if (!marketplaceRaw) continue;
          const listings = JSON.parse(marketplaceRaw);
          if (!Array.isArray(listings)) continue;
          listings.forEach((l: any) => {
            if (l.creatorWallet !== wallet) return;
            const principalNum = Number(String(l.principal).replace(/,/g, "")) || 0;
            if (principalNum <= 0) return;
            const months = Number(l.months) || 12;
            pushDeal({
              id: l.id,
              dealUrlId: l.dealUrlId || l.id,
              principal: String(l.principal),
              currency: l.currency || "USDC",
              collateral: `${l.collateralBtc || "0"} BTC`,
              collateralType: "BTC",
              earnings:
                l.side === "lend"
                  ? `+${(principalNum * ((Number(l.rateBps) || 820) / 10000) * (months / 12)).toFixed(2)} ${l.currency || "USDC"}`
                  : `-${(principalNum * 0.02).toFixed(2)} ${l.currency || "USDC"}`,
              dueDate: new Date(Date.now() + months * 30 * 24 * 3600 * 1000).toLocaleDateString(),
              dueTimestamp: Date.now() + months * 30 * 24 * 3600 * 1000,
              status: "pending",
              role: l.side === "borrow" ? "borrower" : "lender",
              createdAt: Number(l.createdAt) || Date.now(),
              source: "created",
            });
          });
        } catch {}
      }

      // 3. Private proposals sent to this wallet
      try {
        const proposalsRaw = localStorage.getItem(`persat_proposals_${wallet}`);
        if (proposalsRaw) {
          const proposals = JSON.parse(proposalsRaw);
          if (Array.isArray(proposals)) {
            proposals.forEach((p: any) => {
              pushDeal({
                id: p.id,
                dealUrlId: p.dealUrlId || p.id,
                principal: String(p.principal || "0"),
                currency: p.currency || "USDC",
                collateral: p.collateral || "0 BTC",
                collateralType: "BTC",
                earnings: p.earnings || "+0",
                dueDate: p.dueDate || new Date(Date.now() + 30 * 24 * 3600 * 1000).toLocaleDateString(),
                dueTimestamp: Number(p.dueTimestamp) || Date.now() + 30 * 24 * 3600 * 1000,
                status: "pending",
                role: p.role || "borrower",
                createdAt: Number(p.createdAt) || Date.now(),
                source: "proposal",
                counterparty: p.from,
              });
            });
          }
        }
      } catch {}

      // Live status: due_soon / overdue from dueTimestamp
      const now = Date.now();
      for (const d of deals) {
        if (d.status === "completed" || d.status === "closed" || d.status === "pending") continue;
        const days = (d.dueTimestamp - now) / (24 * 3600 * 1000);
        if (days < 0) d.status = "overdue";
        else if (days <= 7) d.status = "due_soon";
      }

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
    earnings: trackedDeals
      .filter((d) => d.role === "lender")
      .reduce((sum, d) => sum + (Number(String(d.earnings).replace(/[^0-9.-]/g, "")) || 0), 0),
    dueSoon: trackedDeals.filter((d) => d.status === "due_soon" || d.status === "overdue").length,
  };

  const unwatch = (id: string) => {
    if (!publicKey) return;
    const updated = trackedDeals.filter((d) => d.id !== id);
    setTrackedDeals(updated);
    try {
      const wallet = publicKey.toBase58();
      const raw = localStorage.getItem(`persat_watched_${wallet}`);
      const watched = raw ? JSON.parse(raw) : [];
      if (Array.isArray(watched)) {
        localStorage.setItem(
          `persat_watched_${wallet}`,
          JSON.stringify(watched.filter((d: any) => d.id !== id && d.dealUrlId !== id)),
        );
      }
    } catch {}
  };

  return (
    <ErrorBoundary>
      <AppFrame eyebrow="Deals // Real Network Only — No Demo" title="My Deals — Watch / Track / Earnings / Due">
        {/* Top actions: New Deal+ and My Deals */}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/deal/new">
            <Button className="px-6 py-3 text-sm font-semibold">New Deal +</Button>
          </Link>
          <Button variant="secondary" className="px-6 py-3 text-sm font-semibold border-amber bg-amber/10 text-white">
            My Deals
          </Button>
          <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] text-emerald-400">
            ● Live {liveNow.toLocaleTimeString()} — Real-time
          </span>
        </div>

        <div className="mt-6">
          <h2 className="font-display text-xl font-bold uppercase text-white">Tracked Deals & Earnings</h2>
          <p className="mt-1 font-mono text-sm text-white/50">
            Watch deals, see earnings, due dates, role, status — BTC default auto-routing
          </p>
        </div>

        {/* Stats */}
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">Total Tracked</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white">{stats.total}</p>
            <p className="font-mono text-[10px] text-white/30">
              {stats.pending} pending • {stats.active} active • {stats.closed} closed
            </p>
          </Card>
          <Card className="p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">Earnings (Lender)</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">+${stats.earnings.toFixed(2)}</p>
            <p className="font-mono text-[10px] text-white/30">Interest on real deals only</p>
          </Card>
          <Card className="p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">Due Soon / Overdue</p>
            <p className={`mt-1 font-mono text-2xl font-bold ${stats.dueSoon > 0 ? "text-amber" : "text-white"}`}>{stats.dueSoon}</p>
            <p className="font-mono text-[10px] text-white/30">Needs attention</p>
          </Card>
          <Card className="p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">BTC Collateral</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white">Auto</p>
            <p className="font-mono text-[10px] text-white/30">BTC → best bridge tBTC/zBTC</p>
          </Card>
        </div>

        {/* Filters */}
        <div className="mt-8">
          <div className="flex flex-wrap gap-2">
            <p className="w-full font-mono text-[11px] uppercase tracking-wider text-white/40 mb-1">Status:</p>
            {(["all", "pending", "active", "closed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition ${
                  statusFilter === s
                    ? "border-amber bg-amber/15 text-white"
                    : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white hover:border-white/20"
                }`}
              >
                {s === "all"
                  ? "All"
                  : s === "pending"
                    ? `Pending (${stats.pending})`
                    : s === "active"
                      ? `Active (${stats.active})`
                      : `Closed (${stats.closed})`}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <p className="w-full font-mono text-[11px] uppercase tracking-wider text-white/40 mb-1">I am the:</p>
            {(["all", "borrower", "lender"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`rounded-full border px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition ${
                  roleFilter === r
                    ? "border-amber bg-amber/15 text-white"
                    : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white hover:border-white/20"
                }`}
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
                  {statusFilter === "pending"
                    ? "No Pending Deals"
                    : statusFilter === "active"
                      ? "No Active Deals"
                      : statusFilter === "closed"
                        ? "No Closed Deals"
                        : "No Deals Yet"}
                </h3>
                <p className="mx-auto mt-2 max-w-md font-mono text-sm leading-6 text-white/50">
                  {!publicKey
                    ? "Connect your wallet to see deals you created, watched, or received. Demo deals are never shown."
                    : "No real deals found. Create a deal or watch one from the marketplace. Only network / user-initiated deals appear here — nothing fake."}
                </p>
                <div className="mt-6 flex justify-center gap-3">
                  <Link href="/marketplace">
                    <Button variant="secondary" className="text-xs">
                      Browse Marketplace
                    </Button>
                  </Link>
                  <Link href="/deal/new">
                    <Button className="text-xs">New Deal +</Button>
                  </Link>
                </div>
              </Card>
            ) : (
              filtered.map((deal) => (
                <Card
                  key={deal.id}
                  className={`p-5 hover:border-amber/20 transition ${
                    deal.status === "overdue"
                      ? "border-red-500/30 bg-red-500/5"
                      : deal.status === "due_soon"
                        ? "border-amber/30 bg-amber/5"
                        : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full font-bold text-xs ${
                          deal.role === "lender" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber/15 text-amber"
                        }`}
                      >
                        {deal.role === "lender" ? "L" : "B"}
                      </div>
                      <div>
                        <p className="font-mono text-sm font-semibold text-white">
                          {deal.principal} {deal.currency} • {deal.collateral} •{" "}
                          <span
                            className={
                              String(deal.earnings).startsWith("+")
                                ? "text-emerald-400"
                                : String(deal.earnings).startsWith("-")
                                  ? "text-white/50"
                                  : "text-white/60"
                            }
                          >
                            {deal.earnings}
                          </span>
                        </p>
                        <p className="font-mono text-[11px] text-white/50">
                          Role: {deal.role} • Due: {deal.dueDate} • Status:{" "}
                          <span
                            className={
                              deal.status === "active"
                                ? "text-emerald-400"
                                : deal.status === "due_soon"
                                  ? "text-amber"
                                  : deal.status === "overdue"
                                    ? "text-red-400"
                                    : deal.status === "pending"
                                      ? "text-white/60"
                                      : "text-white/40"
                            }
                          >
                            {deal.status.replace("_", " ")}
                          </span>
                          {" • "}
                          BTC auto →{" "}
                          {deal.collateral.includes("tBTC")
                            ? "tBTC"
                            : deal.collateral.includes("zBTC")
                              ? "zBTC"
                              : "best bridge"}
                          {deal.source === "proposal" && deal.counterparty
                            ? ` • From: ${deal.counterparty.slice(0, 8)}…`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {deal.source === "watched" && (
                        <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => unwatch(deal.id)}>
                          Unwatch
                        </Button>
                      )}
                      <Link href={`/deal/${deal.dealUrlId || deal.id}`}>
                        <Button className="text-xs px-4 py-1.5">Manage →</Button>
                      </Link>
                      <Link href={`/deal/${deal.dealUrlId || deal.id}/repay`}>
                        <Button variant="secondary" className="text-xs px-3 py-1.5">
                          Track →
                        </Button>
                      </Link>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] text-white/30 border-t border-white/5 pt-2">
                    <span>Created: {new Date(deal.createdAt).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>Due in: {Math.max(0, Math.ceil((deal.dueTimestamp - Date.now()) / (24 * 3600 * 1000)))} days</span>
                    <span>•</span>
                    <span className="text-emerald-400/60">● Live monitoring</span>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-white/5 bg-white/[0.02] p-4 font-mono text-[11px] text-white/40">
          <p>
            💡 BTC default: you deposit BTC, system auto-selects tBTC/zBTC via live health (pause/status, success rate,
            liquidity). Manual tBTC/zBTC still available. Auto-faucet: one click, no bundle upload needed.
          </p>
          <p className="mt-2">
            Only real deals appear here — created by you on-chain, watched from marketplace, or proposed to your
            handle/wallet. No demo or seed data.
          </p>
        </div>
      </AppFrame>
    </ErrorBoundary>
  );
}
