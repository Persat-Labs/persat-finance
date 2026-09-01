"use client";
/**
 * Protocol ops / admin surface — works WITHOUT backend or database (Mode W).
 * Data sources: wallet adapter, Pyth Hermes (direct), protocol config, localStorage.
 * On-chain mutations still require operator wallet signatures (not this UI alone).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card } from "@/lib/design-system";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useProtocol } from "@/lib/protocol/hooks";
import { useBtcPrice } from "@/lib/protocol/oracle";
import { useUserRealBalances } from "@/lib/protocol/userBalance";
import {
  CLUSTER,
  DEFAULT_RPC,
  MINTS,
  OPERATOR,
  PROGRAM_IDS,
  PYTH,
  TREASURY,
  explorerAddress,
} from "@/lib/protocol/config";
import { BottomNav } from "@/components/navigation/BottomNav";

const OPS_LOG_KEY = "persat_admin_ops_log_v1";
const PRICE_HIST_KEY = "persat_admin_btc_hist_v1";
const MAX_HIST = 48;

type OpsLogEntry = { id: string; at: string; label: string; detail?: string };

type PricePoint = { t: number; p: number };

function readLog(): OpsLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(OPS_LOG_KEY) || "[]") as OpsLogEntry[];
  } catch {
    return [];
  }
}

function writeLog(entries: OpsLogEntry[]) {
  try {
    localStorage.setItem(OPS_LOG_KEY, JSON.stringify(entries.slice(0, 40)));
  } catch {
    //
  }
}

function readHist(): PricePoint[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PRICE_HIST_KEY) || "[]") as PricePoint[];
  } catch {
    return [];
  }
}

function writeHist(pts: PricePoint[]) {
  try {
    localStorage.setItem(PRICE_HIST_KEY, JSON.stringify(pts.slice(-MAX_HIST)));
  } catch {
    //
  }
}

function Sparkline({
  points,
  width = 420,
  height = 120,
  stroke = "#FF8A00",
}: {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-[120px] items-center justify-center font-mono text-[11px] text-white/30">
        Collecting BTC samples…
      </div>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p - min) / span) * (height - 16) - 8;
      return `${x},${y}`;
    })
    .join(" ");
  const area = `0,${height} ${coords} ${width},${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[120px] w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#sparkFill)" />
      <polyline points={coords} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MiniBar({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-28 items-end gap-2">
      {values.map((v, i) => (
        <div key={labels[i] || i} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t-md bg-gradient-to-t from-amber/40 to-orange-500/80"
            style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
            title={`${labels[i]}: ${v}`}
          />
          <span className="font-mono text-[9px] text-white/40">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

const GOV_ACTIONS = [
  { name: "Asset whitelist change", policy: "2-of-3 + 24h timelock" },
  { name: "Oracle feed / staleness", policy: "2-of-3 + 24h timelock" },
  { name: "Fee parameter change", policy: "2-of-3 + 24h timelock" },
  { name: "Emergency pause", policy: "1-of-3 · no timelock" },
];

const PROGRAM_ROWS = Object.entries(PROGRAM_IDS).map(([k, v]) => ({
  key: k,
  id: v.toBase58(),
}));

export function AdminOpsDashboard() {
  const { connection, publicKey, isOperator } = useProtocol();
  const { price, loading: priceLoading, error: priceError, isFailClosed, refresh } = useBtcPrice(12_000);
  const balances = useUserRealBalances(connection, publicKey);

  const [log, setLog] = useState<OpsLogEntry[]>([]);
  const [hist, setHist] = useState<PricePoint[]>([]);
  const [mounted, setMounted] = useState(false);
  const [range, setRange] = useState<"session" | "all">("session");

  useEffect(() => {
    setMounted(true);
    setLog(readLog());
    setHist(readHist());
  }, []);

  // Append live BTC samples for sparkline (client-only history)
  useEffect(() => {
    if (!price?.price) return;
    setHist((prev) => {
      const next = [...prev, { t: Date.now(), p: price.price }].slice(-MAX_HIST);
      writeHist(next);
      return next;
    });
  }, [price?.price, price?.publishTime]);

  const pushLog = useCallback((label: string, detail?: string) => {
    const entry: OpsLogEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      label,
      detail,
    };
    setLog((prev) => {
      const next = [entry, ...prev].slice(0, 40);
      writeLog(next);
      return next;
    });
  }, []);

  const walletShort = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : "—";

  const sparkPoints = useMemo(() => hist.map((h) => h.p), [hist]);
  const sparkDelta = useMemo(() => {
    if (sparkPoints.length < 2) return null;
    const a = sparkPoints[0];
    const b = sparkPoints[sparkPoints.length - 1];
    return ((b - a) / a) * 100;
  }, [sparkPoints]);

  const portfolioUsd = balances.totalUsdValue;
  const btcCard = price?.price ?? 0;

  // Local “activity intensity” bars from log counts by hour bucket (demo-friendly without indexer)
  const activityBars = useMemo(() => {
    const labels = ["−4h", "−3h", "−2h", "−1h", "now"];
    const now = Date.now();
    const buckets = [0, 0, 0, 0, 0];
    for (const e of log) {
      const age = now - new Date(e.at).getTime();
      const h = Math.floor(age / 3_600_000);
      if (h >= 0 && h < 5) buckets[4 - h] += 1;
    }
    // Ensure visible baseline for empty state
    if (buckets.every((b) => b === 0)) return { values: [1, 2, 1, 3, 2], labels };
    return { values: buckets.map((b) => b + 1), labels };
  }, [log]);

  if (!mounted) {
    return (
      <main className="app-shell min-h-screen bg-black pb-24">
        <div className="mx-auto max-w-7xl px-4 pt-8 font-mono text-xs text-white/40">Loading ops shell…</div>
      </main>
    );
  }

  return (
    <main className="app-shell hud-grid min-h-screen bg-black pb-28 md:pb-12">
      {/* Top bar — reference-style chrome */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-black/80 px-3 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="font-brand-persat text-lg uppercase tracking-[.2em] text-white hover:text-amber">
              persat
            </Link>
            <span className="rounded-full border border-amber/30 bg-amber/10 px-2.5 py-0.5 font-mono text-[10px] text-amber">
              Ops · {CLUSTER}
            </span>
            <span className="hidden rounded-full border border-white/10 px-2.5 py-0.5 font-mono text-[10px] text-white/50 sm:inline">
              Mode W · no DB required
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-1 py-1 md:flex">
              {[
                { href: "/", label: "Home" },
                { href: "/deals", label: "Deals" },
                { href: "/marketplace", label: "Market" },
                { href: "/keeper", label: "Keeper" },
                { href: "/faucet", label: "Faucet" },
                { href: "/admin", label: "Admin", active: true },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
                    l.active ? "bg-amber/20 text-amber" : "text-white/50 hover:text-white"
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] text-white/70">
              {walletShort}
              {isOperator && <span className="ml-2 text-emerald-400">· operator</span>}
            </div>
            <WalletButton />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[56px_1fr]">
        {/* Side rail */}
        <aside className="hidden flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] py-4 lg:flex">
          {[
            { href: "/admin", icon: "▣", title: "Admin" },
            { href: "/", icon: "⌂", title: "Home" },
            { href: "/deals", icon: "☰", title: "Deals" },
            { href: "/marketplace", icon: "◈", title: "Market" },
            { href: "/keeper", icon: "⚡", title: "Keeper" },
            { href: "/faucet", icon: "💧", title: "Faucet" },
            { href: "/known-limitations", icon: "ⓘ", title: "Limits" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={item.title}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 text-sm text-white/50 transition hover:border-amber/40 hover:text-amber"
            >
              {item.icon}
            </Link>
          ))}
        </aside>

        <div className="space-y-4">
          {/* Banner */}
          <div className="rounded-2xl border border-amber/20 bg-amber/5 px-4 py-3 font-mono text-[11px] leading-5 text-white/70">
            <span className="text-amber">No backend / DB required.</span> Live oracle via Hermes when API is down.
            Governance and keeper actions still need the correct wallet signature on-chain. Local ops log is browser-only.
          </div>

          {/* Row 1: Evaluation + Recent ops + Quick actions */}
          <div className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr_0.55fr]">
            {/* Evaluation */}
            <Card className="relative overflow-hidden p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="eyebrow">Evaluation · total assets (wallet)</p>
                  <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-white sm:text-4xl">
                    ${portfolioUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {sparkDelta != null && (
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                          sparkDelta >= 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {sparkDelta >= 0 ? "+" : ""}
                        {sparkDelta.toFixed(2)}% session
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-white/50">
                      {priceLoading ? "oracle…" : price ? `BTC $${price.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "oracle offline"}
                    </span>
                    {isFailClosed && (
                      <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-300">
                        fail-closed
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={range}
                    onChange={(e) => setRange(e.target.value as "session" | "all")}
                    className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] text-white/70"
                  >
                    <option value="session">Session</option>
                    <option value="all">Stored hist</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      void refresh();
                      pushLog("Oracle refresh", price ? `$${price.price.toFixed(2)}` : "unavailable");
                    }}
                    className="rounded-lg border border-white/10 px-2 py-1 font-mono text-[10px] text-amber hover:bg-white/5"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <Sparkline points={sparkPoints} />
              </div>
              {priceError && <p className="mt-2 font-mono text-[10px] text-red-300/80">{priceError}</p>}
              <p className="mt-2 font-mono text-[10px] text-white/30">
                Chart = local BTC samples this browser · Portfolio = connected wallet balances (not protocol TVL)
              </p>
            </Card>

            {/* Recent operations */}
            <Card className="flex flex-col p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Recent operations</p>
                <button
                  type="button"
                  className="font-mono text-[10px] text-white/40 hover:text-amber"
                  onClick={() => {
                    setLog([]);
                    writeLog([]);
                  }}
                >
                  Clear
                </button>
              </div>
              <p className="mt-1 font-mono text-2xl font-bold text-white">
                {log.length}
                <span className="ml-2 text-xs font-normal text-white/40">local events</span>
              </p>
              <div className="mt-3 max-h-48 flex-1 space-y-2 overflow-y-auto pr-1">
                {log.length === 0 ? (
                  <p className="font-mono text-[11px] text-white/35">No local ops yet — use quick actions or refresh oracle.</p>
                ) : (
                  log.slice(0, 8).map((e) => (
                    <div
                      key={e.id}
                      className="flex items-start justify-between gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2"
                    >
                      <div>
                        <p className="font-mono text-[11px] font-semibold text-white">{e.label}</p>
                        {e.detail && <p className="font-mono text-[10px] text-white/40">{e.detail}</p>}
                      </div>
                      <span className="shrink-0 font-mono text-[9px] text-white/30">
                        {new Date(e.at).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Quick actions column */}
            <div className="flex flex-col gap-2">
              {[
                { href: "/faucet", label: "Deposit / Faucet", sub: "Test funds" },
                { href: "/deal/new", label: "New deal", sub: "Propose" },
                { href: "/marketplace", label: "P2P market", sub: "Browse" },
                { href: "/keeper", label: "Keeper console", sub: "Operator" },
              ].map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  onClick={() => pushLog(`Open ${a.label}`, a.href)}
                  className="flex flex-1 flex-col justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-amber/5 px-4 py-3 transition hover:border-amber/40"
                >
                  <span className="font-ui text-xs uppercase tracking-wider text-white">{a.label}</span>
                  <span className="font-mono text-[10px] text-white/40">{a.sub}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Row 2: asset cards + activity */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/15 to-transparent p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-300/80">Bitcoin (oracle)</p>
              <p className="mt-2 font-mono text-2xl font-bold text-white">
                ${btcCard ? btcCard.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
              </p>
              <p className="mt-1 font-mono text-[10px] text-white/45">
                conf {price ? `${price.confBps} bps` : "—"} · age {price ? `${price.ageSeconds}s` : "—"} · {price?.source || "—"}
              </p>
              <div className="mt-3 h-12 opacity-80">
                <Sparkline points={sparkPoints.slice(-16)} height={48} stroke="#34d399" width={280} />
              </div>
            </Card>

            <Card className="overflow-hidden border-red-500/15 bg-gradient-to-br from-red-500/10 to-transparent p-5">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-white/50">Wallet · SOL</p>
                <span className="font-mono text-[10px] text-white/30">{walletShort}</span>
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-white">{balances.solBalance.toFixed(4)} SOL</p>
              <p className="mt-1 font-mono text-[10px] text-white/40">Gas for txs · devnet</p>
              <div className="mt-4 h-10 rounded-lg bg-gradient-to-r from-red-500/20 via-orange-500/30 to-transparent" />
            </Card>

            <Card className="p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/50">Fear &amp; oracle health</p>
              <div className="mt-4 flex items-center justify-between gap-2">
                {["LOW", "", "", "MID", "", "", "HIGH"].map((lab, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        isFailClosed ? (i > 4 ? "bg-red-400 shadow-[0_0_8px_#f87171]" : "bg-white/15") : i < 3 ? "bg-emerald-400" : "bg-white/15"
                      }`}
                    />
                    {lab && <span className="font-mono text-[8px] text-white/30">{lab}</span>}
                  </div>
                ))}
              </div>
              <p className="mt-4 font-mono text-xs text-white/60">
                {isFailClosed ? "Oracle blocked — price-dependent actions fail closed" : "Oracle fresh — within staleness & confidence gates"}
              </p>
            </Card>

            <Card className="p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/50">Local activity</p>
              <p className="mt-1 font-mono text-lg font-semibold text-white">Ops intensity</p>
              <div className="mt-3">
                <MiniBar values={activityBars.values} labels={activityBars.labels} />
              </div>
            </Card>
          </div>

          {/* Row 3: tokens + governance + programs */}
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.1fr]">
            <Card className="p-5">
              <p className="eyebrow">Wallet tokens</p>
              <h3 className="mt-1 font-display text-lg font-bold text-white">Available balances</h3>
              <div className="mt-4 space-y-2">
                {publicKey ? (
                  balances.tokenList.map((t) => (
                    <div
                      key={t.symbol}
                      className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber/15 font-mono text-[10px] text-amber">
                          {t.symbol.slice(0, 3)}
                        </span>
                        <span className="font-mono text-xs text-white">{t.symbol}</span>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xs text-white">
                          {t.balance.toFixed(t.symbol.includes("BTC") || t.symbol === "BTC" ? 4 : t.symbol === "SOL" ? 3 : 2)}
                        </p>
                        <p className="font-mono text-[10px] text-white/35">${t.usdValue.toFixed(2)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="font-mono text-xs text-white/40">Connect wallet to load balances</p>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <p className="eyebrow">Governance policy</p>
              <h3 className="mt-1 font-display text-lg font-bold text-white">Signer gates</h3>
              <ul className="mt-4 space-y-3">
                {GOV_ACTIONS.map((a) => (
                  <li
                    key={a.name}
                    className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 font-mono text-[11px]"
                  >
                    <span className="text-white/70">{a.name}</span>
                    <span className="shrink-0 text-amber">{a.policy}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 font-mono text-[10px] leading-5 text-white/35">
                UI cannot bypass multisig. Connect a governance signer wallet to propose on-chain changes when programs accept them.
              </p>
              <Button
                className="mt-4 w-full text-xs"
                variant="secondary"
                disabled={!publicKey}
                onClick={() => pushLog("Governance check", isOperator ? "operator wallet connected" : "non-operator wallet")}
              >
                {isOperator ? "Operator wallet detected" : publicKey ? "Record signer check" : "Connect wallet"}
              </Button>
            </Card>

            <Card className="p-5">
              <p className="eyebrow">Protocol map</p>
              <h3 className="mt-1 font-display text-lg font-bold text-white">Programs · mints · roles</h3>
              <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {PROGRAM_ROWS.map((r) => (
                  <a
                    key={r.key}
                    href={explorerAddress(r.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/5 px-2 py-1.5 font-mono text-[10px] hover:border-amber/30"
                  >
                    <span className="text-amber">{r.key}</span>
                    <span className="truncate text-white/40">{r.id.slice(0, 8)}…</span>
                  </a>
                ))}
              </div>
              <div className="mt-3 space-y-1 border-t border-white/5 pt-3 font-mono text-[10px] text-white/45">
                <p>
                  Operator{" "}
                  <a className="text-white/70 hover:text-amber" href={explorerAddress(OPERATOR)} target="_blank" rel="noreferrer">
                    {OPERATOR.toBase58().slice(0, 8)}…
                  </a>
                </p>
                <p>
                  Treasury{" "}
                  <a className="text-white/70 hover:text-amber" href={explorerAddress(TREASURY)} target="_blank" rel="noreferrer">
                    {TREASURY.toBase58().slice(0, 8)}…
                  </a>
                </p>
                <p className="truncate">RPC {DEFAULT_RPC.replace("https://", "")}</p>
                <p className="truncate">Pyth {PYTH.btcUsdFeedId.slice(0, 18)}…</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(["tBTC", "zBTC", "USDC", "USDT"] as const).map((sym) => {
                  const m = MINTS[sym];
                  return m ? (
                    <a
                      key={sym}
                      href={explorerAddress(m)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[9px] text-white/50 hover:text-amber"
                    >
                      {sym}
                    </a>
                  ) : null;
                })}
              </div>
            </Card>
          </div>

          {/* System status strip */}
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex flex-wrap gap-3 font-mono text-[10px]">
              <StatusPill ok label={`Cluster ${CLUSTER}`} />
              <StatusPill ok={Boolean(price) && !isFailClosed} label="Oracle" />
              <StatusPill ok={Boolean(publicKey)} label="Wallet" />
              <StatusPill ok={isOperator} label="Operator" />
              <StatusPill ok={false} label="API DB (optional)" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="text-[11px]"
                onClick={() =>
                  pushLog("Health snapshot", `btc=${price?.price ?? "n/a"} portfolio=${portfolioUsd.toFixed(2)}`)
                }
              >
                Snapshot log
              </Button>
              <Link href="/known-limitations">
                <Button variant="secondary" className="text-[11px]">
                  Known limits
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
        ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-white/10 bg-white/[0.03] text-white/45"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-white/25"}`} />
      {label}
    </span>
  );
}
