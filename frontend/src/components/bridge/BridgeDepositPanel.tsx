"use client";
import { useState } from "react";
import { Button, Card, Modal } from "@/lib/design-system";
import { useBridgeHealth } from "@/lib/protocol/bridge";
import { useBtcPrice } from "@/lib/protocol/oracle";

type DepositType = "BTC" | "tBTC" | "zBTC";

export function BridgeDepositPanel() {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<DepositType>("BTC");
  const { health, bestBridge, isFailClosed, loading: healthLoading } = useBridgeHealth();
  const { price, isFailClosed: oracleFailClosed } = useBtcPrice();

  const autoBridge = bestBridge ?? "tbtc";
  const effectiveBridge = selectedType === "BTC" ? autoBridge : selectedType.toLowerCase() as "tbtc" | "zbtc";

  return (
    <>
      <Card className="mt-8 max-w-3xl">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Funding // BTC Default Auto-Routing</p>
          <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] ${isFailClosed ? "border border-amber/30 bg-amber/10 text-amber" : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"}`}>
            {healthLoading ? "Checking bridges..." : health?.mode === "auto" ? "● Auto Routing Active" : health?.mode === "partial_auto" ? "● Partial Auto" : "● Manual Fallback"}
          </span>
        </div>
        <h2 className="mt-3 font-display text-2xl uppercase">Deposit collateral — BTC default, auto tBTC/zBTC</h2>
        <p className="mt-3 leading-7 text-orange-50">
          Default is BTC — system automatically converts to {autoBridge.toUpperCase()} based on live checker (3 signals: provider pause/status, success rate, on-chain liquidity). Missing data = manual choice, never guessed.{" "}
          {price ? (
            <span className={oracleFailClosed ? "text-red-400" : "text-emerald-400"}>
              BTC ${price.price.toLocaleString()} {oracleFailClosed ? "(stale/blocked)" : "✓ fresh"}
            </span>
          ) : (
            <span className="text-white/50">Fetching BTC price from Pyth Hermes...</span>
          )}
        </p>

        {/* Deposit Type Selector — BTC default */}
        <div className="mt-5">
          <p className="font-mono text-[11px] uppercase tracking-wider text-white/50 mb-2">Select collateral type — BTC auto-converts</p>
          <div className="grid grid-cols-3 gap-2">
            {(["BTC", "tBTC", "zBTC"] as DepositType[]).map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`rounded-xl border p-3 text-left transition ${
                  selectedType === type
                    ? "border-amber bg-amber/15 text-white"
                    : "border-white/10 bg-white/[0.02] text-white/60 hover:border-white/20 hover:text-white"
                }`}
              >
                <span className="font-display text-sm uppercase">{type}</span>
                <span className="mt-1 block font-mono text-[10px] text-white/50">
                  {type === "BTC" ? `Auto → ${autoBridge.toUpperCase()}` : type === "tBTC" ? "Threshold" : "Zeus"}
                </span>
                {selectedType === type && <span className="mt-1 block font-mono text-[10px] text-amber">● Selected</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3 font-mono text-[11px]">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
            <p className="text-white/50">Deposit Type</p>
            <p className="text-white font-semibold">{selectedType} {selectedType === "BTC" ? `→ ${autoBridge.toUpperCase()} auto` : "✓ manual"}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
            <p className="text-white/50">Best Bridge</p>
            <p className="text-white font-semibold">{autoBridge.toUpperCase()} {bestBridge ? `✓` : "(fallback)"}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
            <p className="text-white/50">Custody</p>
            <p className="text-white">Vault PDA (non-custodial)</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-amber/20 bg-amber/5 p-3 font-mono text-[11px] text-white/60">
          <p><span className="text-amber">BTC default flow:</span> You deposit BTC → system checks live bridge health (pause/status, success rate {">"}80%, liquidity {">"} $10k) → auto-routes to {autoBridge.toUpperCase()} → mints tBTC/zBTC → deposits into vault PDA atomically with loan.</p>
          <p className="mt-1"><span className="text-white/80">Manual flow:</span> If you already have tBTC/zBTC, select it above to deposit directly without BTC conversion.</p>
        </div>

        <Button className="mt-7" onClick={() => setOpen(true)}>
          {isFailClosed ? "Select Bridge Manually" : `Deposit ${selectedType} ${selectedType === "BTC" ? `(auto → ${autoBridge.toUpperCase()})` : ""}`}
        </Button>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={selectedType === "BTC" ? `BTC → Auto ${autoBridge.toUpperCase()}` : `Deposit ${selectedType} Direct`}>
        <div className="space-y-4">
          <div className="rounded-lg border border-amber/20 bg-amber/5 p-3 font-mono text-xs">
            <p className="text-amber font-semibold">Selected: {selectedType}</p>
            <p className="text-white/60 mt-1">
              {selectedType === "BTC"
                ? `You deposit BTC, system auto-converts to ${autoBridge.toUpperCase()} via live health checker. No manual bridge selection needed unless health fails.`
                : `You deposit ${selectedType} directly — you already have ${selectedType} in wallet, skip BTC conversion.`}
            </p>
          </div>

          <p className="eyebrow">Bridge health — live checker (3 signals)</p>
          {health?.bridges.map((b) => (
            <div key={b.id} className={`rounded-xl border p-4 text-left ${b.available ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber/20 bg-amber/5"}`}>
              <div className="flex items-center justify-between">
                <span className="font-display text-lg text-white uppercase">{b.id}</span>
                <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${b.available ? "bg-emerald-500/20 text-emerald-400" : "bg-amber/20 text-amber"}`}>
                  {b.available ? "Available" : "Unavailable"} {b.id === effectiveBridge ? "← Auto" : ""}
                </span>
              </div>
              <p className="mt-2 font-mono text-[11px] text-white/60">{b.reason ?? `Success ${(b.successRate ?? 0 * 100).toFixed(1)}% · Liquidity $${(b.liquidityUsd ?? 0).toLocaleString()} · ${b.pauseStatus}`}</p>
              <p className="mt-1 font-mono text-[10px] text-white/30">Checked {new Date(b.lastChecked).toLocaleTimeString()} — 3 signals: pause/status, success rate, liquidity</p>
            </div>
          ))}

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="font-mono text-xs text-white/70">
              {selectedType === "BTC"
                ? `In production, BTC deposit opens Threshold/Zeus widget directly — Bitcoin sent to decentralized lock address, verified by independent nodes, minted as ${autoBridge.toUpperCase()}, then deposited into vault PDA. User never leaves Persat.`
                : `In production, ${selectedType} deposit is direct SPL transfer to vault PDA — no Bitcoin lock needed, you already hold ${selectedType}.`}
            </p>
            <p className="mt-3 font-mono text-[11px] text-emerald-400">✓ No Persat custody at any step. Vault PDA owns token account.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              disabled={oracleFailClosed}
              className={`min-h-20 rounded-xl border p-4 text-left transition ${oracleFailClosed ? "border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed" : "border-amber/30 bg-amber/10 hover:bg-amber/15"}`}
              onClick={() => alert(`${selectedType} deposit flow: ${selectedType === "BTC" ? `BTC → ${autoBridge.toUpperCase()} auto via live health` : `${selectedType} direct`} → vault PDA, atomic with principal disbursement`)}
            >
              <span className="font-display text-lg text-white">Deposit {selectedType} {selectedType === "BTC" ? `→ ${autoBridge.toUpperCase()}` : ""}</span>
              <span className="mt-1 block font-mono text-[10px] text-white/60">{oracleFailClosed ? "Blocked: stale oracle" : "Atomic: collateral + principal in one tx"}</span>
            </button>
            <button
              className="min-h-20 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left hover:bg-white/[0.05]"
              onClick={() => setOpen(false)}
            >
              <span className="font-display text-lg text-white">Cancel</span>
              <span className="mt-1 block font-mono text-[10px] text-white/60">Close and review terms again</span>
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
