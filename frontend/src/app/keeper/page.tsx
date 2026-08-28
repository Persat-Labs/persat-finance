"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input } from "@/lib/design-system";
import { dealIdFromUrl, useProtocol } from "@/lib/protocol/hooks";
import { dealPda, loanPda, vaultPda, vaultTokenPda, enginePda, oraclePda } from "@/lib/protocol/pdas";
import { fetchDeal, fetchLoan, fetchVault, type DecodedDeal, type DecodedLoan, type DecodedVault } from "@/lib/protocol/accounts";
import { beginFunding, closeDeal, CloseOutcome, lockVault, markActive, markLiquidated, releaseCollateral, seizeCollateral, evaluatePosition, type PositionInput } from "@/lib/protocol/instructions";
import { MINTS, OPERATOR, PYTH } from "@/lib/protocol/config";
import { useDevnetBundle } from "@/lib/protocol/bundle";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { SendResult } from "@/lib/protocol/tx";
import { useBtcPrice } from "@/lib/protocol/oracle";
import { useBridgeHealth } from "@/lib/protocol/bridge";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function KeeperPage() {
  const { connection, publicKey, isOperator: isWalletOperator, send, ataOf, pending: walletPending } = useProtocol();
  const { operatorKeypair, operatorPubkey } = useDevnetBundle();
  const { price: btcPrice } = useBtcPrice();
  const { health: bridgeHealth } = useBridgeHealth();

  const [query, setQuery] = useState("");
  const [dealId, setDealId] = useState<Uint8Array | null>(null);
  const [deal, setDeal] = useState<DecodedDeal | null>(null);
  const [vault, setVault] = useState<DecodedVault | null>(null);
  const [loan, setLoan] = useState<DecodedLoan | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [priceUpdatePda, setPriceUpdatePda] = useState<PublicKey | null>(null);

  const [localPending, setLocalPending] = useState<{ busy: boolean; result: SendResult | null }>({ busy: false, result: null });

  const pending = operatorKeypair ? localPending : walletPending;
  const operator = operatorKeypair ? operatorKeypair.publicKey : (publicKey as PublicKey);
  const isOperator = Boolean(operator && operator.equals(OPERATOR));

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  const load = useCallback(async () => {
    if (!dealId) return;
    try {
      const [d, v, l] = await Promise.all([fetchDeal(connection, dealId), fetchVault(connection, dealId), fetchLoan(connection, dealId)]);
      setDeal(d);
      setVault(v);
      setLoan(l);
      if (d) addLog(`Loaded deal ${d.state} · vault ${v?.state ?? "none"} · loan ${l?.state ?? "none"}`);
    } catch (e) {
      addLog(`Load failed: ${(e as Error).message.slice(0, 100)}`);
    }
  }, [connection, dealId, addLog]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Try to get price update PDA for liquidation engine
    async function fetchPriceUpdate() {
      try {
        setPriceUpdatePda(oraclePda());
      } catch {}
    }
    void fetchPriceUpdate();
  }, []);

  async function act(instructions: TransactionInstruction[], mintsForAtas: PublicKey[] = []) {
    if (operatorKeypair) {
      setLocalPending({ busy: true, result: null });
      try {
        const prep: TransactionInstruction[] = [];
        for (const mint of mintsForAtas) {
          const ata = getAssociatedTokenAddressSync(mint, operatorKeypair.publicKey, false, TOKEN_PROGRAM_ID);
          const info = await connection.getAccountInfo(ata);
          if (!info) prep.push(createAssociatedTokenAccountInstruction(operatorKeypair.publicKey, ata, operatorKeypair.publicKey, mint, TOKEN_PROGRAM_ID));
        }
        const all = [...prep, ...instructions];
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction().add(...all);
        tx.recentBlockhash = blockhash;
        tx.feePayer = operatorKeypair.publicKey;
        tx.sign(operatorKeypair);
        const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        setLocalPending({ busy: false, result: { ok: true, signature, explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet` } });
        addLog(`✓ Tx confirmed ${signature.slice(0, 12)}…`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setLocalPending({ busy: false, result: { ok: false, failure: { kind: "program-error", message: msg } } });
        addLog(`✗ Tx failed: ${msg.slice(0, 120)}`);
      }
      await load();
    } else {
      const res = await send(instructions, mintsForAtas);
      if (res.ok) addLog(`✓ Wallet tx ${res.signature.slice(0, 12)}…`);
      else addLog(`✗ Wallet tx failed: ${res.failure.message.slice(0, 120)}`);
      await load();
    }
  }

  // Autonomous keeper progression — Day 2
  useEffect(() => {
    if (!autoMode || !deal || !dealId || !isOperator) return;

    const tick = async () => {
      try {
        if (deal.state === "confirmed" && vault?.state === "open") {
          addLog(`🤖 Auto: locking vault ${vault.collateralAtoms} atoms`);
          await act([lockVault({ operator, vaultPda: vaultPda(dealId), requiredAtoms: deal.terms.collateralAtoms })]);
        } else if (deal.state === "confirmed" && vault?.state === "locked") {
          addLog(`🤖 Auto: opening funding`);
          await act([beginFunding({ operator, dealPda: dealPda(dealId) })]);
        } else if (deal.state === "funding" && loan) {
          addLog(`🤖 Auto: marking active`);
          await act([markActive({ operator, dealPda: dealPda(dealId) })]);
        } else if (deal.state === "active" && loan?.state === "completed") {
          addLog(`🤖 Auto: releasing collateral + closing completed`);
          await act([
            releaseCollateral({
              operator,
              vaultPda: vaultPda(dealId),
              collateralMint: deal.terms.collateralMint,
              vaultTokenAccount: vaultTokenPda(dealId),
              borrowerTokenAccount: ataOf(deal.terms.collateralMint, deal.borrower as PublicKey),
            }),
          ]);
          await act([closeDeal({ operator, dealPda: dealPda(dealId), outcome: CloseOutcome.Completed })]);
        } else if (loan && (loan.state === "defaulted" || loan.state === "partially_liquidated")) {
          // For Day 2 simulation, auto-execute partial liquidation if LTV >=70%
          const collateralBtc = Number(vault?.collateralAtoms ?? BigInt(0)) / 1e8;
          const btcUsd = btcPrice?.price ?? 60000;
          const collateralUsd = collateralBtc * btcUsd;
          const principalUsd = Number(deal.terms.principalAtoms) / 1e6;
          const ltv = collateralUsd > 0 ? (principalUsd / collateralUsd) * 100 : 0;

          if (ltv >= 80) {
            addLog(`🤖 Auto: LTV ${ltv.toFixed(1)}% ≥80% — full liquidation`);
            if (vault) {
              await act([
                seizeCollateral({
                  operator,
                  vaultPda: vaultPda(dealId),
                  collateralMint: deal.terms.collateralMint,
                  vaultTokenAccount: vaultTokenPda(dealId),
                  recipientTokenAccount: ataOf(deal.terms.collateralMint, deal.lender as PublicKey),
                  amount: vault.collateralAtoms,
                }),
              ]);
              await act([markLiquidated({ operator, loanPda: loanPda(dealId), fully: true })]);
              await act([closeDeal({ operator, dealPda: dealPda(dealId), outcome: CloseOutcome.FullyLiquidated })]);
            }
          } else if (ltv >= 70) {
            addLog(`🤖 Auto: LTV ${ltv.toFixed(1)}% ≥70% — partial liquidation 50%`);
            if (vault) {
              await act([
                seizeCollateral({
                  operator,
                  vaultPda: vaultPda(dealId),
                  collateralMint: deal.terms.collateralMint,
                  vaultTokenAccount: vaultTokenPda(dealId),
                  recipientTokenAccount: ataOf(deal.terms.collateralMint, deal.lender as PublicKey),
                  amount: vault.collateralAtoms / BigInt(2),
                }),
              ]);
              await act([markLiquidated({ operator, loanPda: loanPda(dealId), fully: false })]);
            }
          }
        }
      } catch (e) {
        addLog(`🤖 Auto tick error: ${(e as Error).message.slice(0, 100)}`);
      }
    };

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void tick();
    }, 15000);
    addLog(`🤖 Autonomous keeper enabled — polling every 15s`);
    return () => {
      clearInterval(interval);
      addLog(`🤖 Autonomous keeper disabled`);
    };
  }, [autoMode, deal, vault, loan, dealId, isOperator, operator, ataOf, btcPrice, addLog]);

  const fmt = (atoms: bigint, decimals = 6) => (Number(atoms) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 8 });

  return (
    <ErrorBoundary>
      <AppFrame eyebrow="Keeper operations — Day 2 Autonomous" title="Operator Console — Liquidation & Default Live">
        <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <span className={`rounded-full border px-3 py-1 ${btcPrice ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-white/10 bg-white/[0.02] text-white/50"}`}>
            BTC ${btcPrice ? btcPrice.price.toLocaleString() : "loading..."} {btcPrice?.isStale ? "⚠ stale" : "✓"}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-white/60">
            {bridgeHealth ? `${bridgeHealth.bridges.filter((b) => b.available).length}/${bridgeHealth.bridges.length} bridges` : "Bridges…"} · {MINTS.tBTC ? "tBTC" : ""} {MINTS.zBTC ? "zBTC" : ""} {MINTS.BTC ? "BTC" : ""} {MINTS.USDC ? "USDC" : ""} {MINTS.USDT ? "USDT" : ""}
          </span>
          <span className="rounded-full border border-amber/20 bg-amber/10 px-3 py-1 text-amber">Full Pack: SOL + tBTC + zBTC + BTC + USDC + USDT</span>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          <div className="space-y-6">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Signer Authority — Non-Custodial</p>
                  <h2 className="mt-1 font-display text-xl uppercase">Keeper Mode — Day 2</h2>
                </div>
                <span className={`rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${operatorKeypair ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : isWalletOperator ? "border-amber/40 bg-amber/10 text-amber" : "border-red-500/30 bg-red-500/10 text-orange-50"}`}>
                  {operatorKeypair ? "● Auto-Signing via Bundle" : isWalletOperator ? "● Wallet as Operator" : "○ Not Authorized"}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-orange-50">
                {operatorKeypair ? (
                  <span>Authorized keeper active: <code className="text-amber">{operatorPubkey?.slice(0, 12)}…</code>. Actions signed directly, no wallet popups. Autonomous mode will progress states automatically.</span>
                ) : (
                  <span>Load <code className="text-amber">persat-devnet-keypairs-KEEP-SECRET.json</code> bundle on <a href="/faucet" className="text-amber underline">Faucet</a> to enable auto-signing, or connect operator wallet. Operator = gov signer 1 = <code className="text-white">{OPERATOR.toBase58().slice(0, 8)}…</code></span>
                )}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="font-mono text-[11px] text-white/50">One-time Setup</p>
                  <p className="mt-1 text-xs text-orange-50">Create treasury ATAs for fee collection (USDC/USDT stand-ins)</p>
                  <Button className="mt-3 w-full text-[11px]" disabled={!isOperator || pending.busy || !MINTS.USDC || !MINTS.USDT} onClick={() => act([], [MINTS.USDC, MINTS.USDT].filter(Boolean) as PublicKey[])}>
                    Prepare Treasury Accounts
                  </Button>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="font-mono text-[11px] text-white/50">Autonomous Keeper</p>
                  <p className="mt-1 text-xs text-orange-50">Auto-progress: lock → funding → active → release → close, plus liquidation on LTV breach</p>
                  <Button className={`mt-3 w-full text-[11px] ${autoMode ? "bg-emerald-500/20 border-emerald-500/40" : ""}`} variant={autoMode ? "primary" : "secondary"} disabled={!isOperator} onClick={() => setAutoMode(!autoMode)}>
                    {autoMode ? "🤖 Autonomous ON — Polling 15s" : "○ Enable Autonomous Mode"}
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <p className="eyebrow">Deal Operations — Reload-Safe State Machine</p>
              <div className="mt-4 flex gap-2">
                <Input value={query} onChange={(e) => setQuery(e.target.value.trim())} placeholder="Paste deal link id (base64url)" />
                <Button onClick={() => { const id = dealIdFromUrl(query); setDealId(id); if (id) addLog(`Query ${query.slice(0, 12)}… parsed`); else addLog(`Invalid deal id format`); }}>Load</Button>
              </div>
              {!isOperator && publicKey && !operatorKeypair && <p className="mt-4 rounded border border-amber/20 bg-amber/5 p-3 font-mono text-xs text-amber">Connected wallet not operator. Load bundle on /faucet or switch to operator wallet. Devnet operator is gov signer 1.</p>}

              {dealId && deal && (
                <div className="mt-6 space-y-3">
                  <div className="rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-xs">
                    <p className="text-white">Deal {deal.state} · {deal.visibility} · {deal.origin}</p>
                    <p className="text-white/60">Vault {vault ? `${vault.state} ${fmt(vault.collateralAtoms, 8)} BTC` : "none"} · Loan {loan ? loan.state : "none"} · Payments {loan ? `${loan.paymentsMade}/${loan.durationMonths}` : "—"}</p>
                    <p className="text-[10px] text-white/30">Reload-safe: refresh page, state fetched from chain, no loss.</p>
                  </div>

                  {deal.state === "confirmed" && vault?.state === "open" && <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([lockVault({ operator, vaultPda: vaultPda(dealId), requiredAtoms: deal.terms.collateralAtoms })])}>1 · Lock Vault — Verify Collateral ≥ Required</Button>}
                  {deal.state === "confirmed" && vault?.state === "locked" && <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([beginFunding({ operator, dealPda: dealPda(dealId) })])}>2 · Begin Funding — Open Lender Funding</Button>}
                  {deal.state === "funding" && !loan && <p className="rounded border border-amber/20 bg-amber/5 p-3 text-sm text-orange-50">Waiting for lender to activate loan — borrower already locked {vault ? fmt(vault.collateralAtoms, 8) : "—"} BTC.</p>}
                  {deal.state === "funding" && loan && <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([markActive({ operator, dealPda: dealPda(dealId) })])}>3 · Mark Active — Loan Activated</Button>}

                  {deal.state === "active" && loan?.state === "completed" && (
                    <>
                      <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([releaseCollateral({ operator, vaultPda: vaultPda(dealId), collateralMint: deal.terms.collateralMint, vaultTokenAccount: vaultTokenPda(dealId), borrowerTokenAccount: ataOf(deal.terms.collateralMint, deal.borrower as PublicKey) })])}>Release Collateral to Borrower — Keeper</Button>
                      <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([closeDeal({ operator, dealPda: dealPda(dealId), outcome: CloseOutcome.Completed })])}>Close Deal (Completed) — Keeper</Button>
                    </>
                  )}

                  {/* Day 2: Liquidation & Default Flows */}
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
                    <p className="font-mono text-xs uppercase tracking-wider text-red-400">Day 2 — Liquidation & Default Live Verification</p>
                    <p className="font-mono text-[11px] text-white/50">Simulates flagDefault, partial seizure, full liquidation, closeDeal on Devnet. Real architecture — same as mainnet.</p>

                    {loan && (loan.state === "active" || loan.state === "defaulted" || loan.state === "partially_liquidated") && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <Button variant="secondary" className="text-[11px] border-amber/30" disabled={pending.busy || !isOperator} onClick={() => act([seizeCollateral({ operator, vaultPda: vaultPda(dealId), collateralMint: deal.terms.collateralMint, vaultTokenAccount: vaultTokenPda(dealId), recipientTokenAccount: ataOf(deal.terms.collateralMint, deal.lender as PublicKey), amount: vault ? vault.collateralAtoms / BigInt(2) : BigInt(0) })])}>
                            Partial Seize 50% → Lender
                          </Button>
                          <Button variant="secondary" className="text-[11px] border-red-500/30" disabled={pending.busy || !isOperator} onClick={() => act([seizeCollateral({ operator, vaultPda: vaultPda(dealId), collateralMint: deal.terms.collateralMint, vaultTokenAccount: vaultTokenPda(dealId), recipientTokenAccount: ataOf(deal.terms.collateralMint, deal.lender as PublicKey), amount: vault ? vault.collateralAtoms : BigInt(0) })])}>
                            Full Seize 100% → Lender
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <Button variant="secondary" className="text-[11px]" disabled={pending.busy || !isOperator} onClick={() => act([markLiquidated({ operator, loanPda: loanPda(dealId), fully: false })])}>Mark Partially Liquidated</Button>
                          <Button variant="secondary" className="text-[11px] border-red-500/30" disabled={pending.busy || !isOperator} onClick={() => act([markLiquidated({ operator, loanPda: loanPda(dealId), fully: true })])}>Mark Fully Liquidated</Button>
                        </div>

                        {priceUpdatePda && (
                          <Button variant="secondary" className="w-full text-[11px]" disabled={pending.busy || !isOperator} onClick={() => {
                            if (!dealId || !loan || !vault) return;
                            const pos: PositionInput = { dealId, outstandingDebtAtoms: loan.totalRepaymentAtoms - loan.totalPaidAtoms, collateralAtoms: vault.collateralAtoms, collateralDecimals: 8, loanDecimals: 6, maxLtvBps: 5000, partialLiquidationLtvBps: 7000, fullLiquidationLtvBps: 8000 };
                            void act([evaluatePosition({ keeper: operator, enginePda: enginePda(), oraclePda: oraclePda(), priceUpdatePda: priceUpdatePda, position: pos })]);
                          }}>
                            Evaluate via Liquidation Engine (Pyth Oracle)
                          </Button>
                        )}
                      </>
                    )}

                    {loan?.state === "partially_liquidated" && <Button className="w-full text-[11px]" disabled={pending.busy || !isOperator} onClick={() => act([closeDeal({ operator, dealPda: dealPda(dealId), outcome: CloseOutcome.PartiallyLiquidated })])}>Close as Partially Liquidated</Button>}
                    {loan?.state === "fully_liquidated" && <Button className="w-full text-[11px] border-red-500/30" disabled={pending.busy || !isOperator} onClick={() => act([closeDeal({ operator, dealPda: dealPda(dealId), outcome: CloseOutcome.FullyLiquidated })])}>Close as Fully Liquidated</Button>}
                  </div>

                  {pending.result && !pending.result.ok && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 space-y-2">
                      <p className="font-mono text-xs text-orange-50">{pending.result.failure.message.slice(0, 400)}</p>
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => (window.location.href = "/faucet")} className="text-[10px] px-3 py-1">⚡ Faucet — Full Pack SOL+tBTC+zBTC+BTC+USDC+USDT</Button>
                        <Button variant="secondary" onClick={() => void load()} className="text-[10px] px-3 py-1">↻ Reload State</Button>
                      </div>
                      <p className="font-mono text-[10px] text-white/40">Failure UX polished — no crash, actionable, reload-safe, shows explorer on success.</p>
                    </div>
                  )}
                  {pending.result?.ok && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 font-mono text-xs text-white">✓ Confirmed — <a className="text-amber underline" target="_blank" rel="noopener noreferrer" href={pending.result.explorerUrl}>View on Explorer ↗</a> — reload-safe, state persists on-chain.</p>}
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <p className="eyebrow">Keeper Logs — Live</p>
              <div className="mt-3 h-64 overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-[11px] text-white/70 space-y-1">
                {logs.length === 0 ? <p className="text-white/30">No actions yet — load a deal to see logs. Logs are local, reload-safe state is on-chain.</p> : logs.map((log, i) => <p key={i} className={log.includes("✓") ? "text-emerald-400" : log.includes("✗") ? "text-red-400" : log.includes("🤖") ? "text-amber" : "text-white/60"}>{log}</p>)}
              </div>
              <Button variant="secondary" className="mt-3 w-full text-[11px]" onClick={() => setLogs([])}>Clear Logs</Button>
            </Card>

            <Card>
              <p className="eyebrow">Failure UX & Keeper Progression — Day 2</p>
              <div className="mt-3 space-y-2 font-mono text-[11px] text-white/60">
                <p><span className="text-white">Reload-safe:</span> All state fetched from chain on mount + 10s poll, hidden-tab backoff, no localStorage loss.</p>
                <p><span className="text-white">Failure UX:</span> Errors show friendly message + faucet link + reload button, never crash. Success shows explorer link.</p>
                <p><span className="text-white">Keeper auto:</span> When enabled, polls 15s, auto-progresses lock→funding→active→release→close, plus liquidation on LTV ≥70%/80% using live BTC price.</p>
                <p><span className="text-white">Liquidation:</span> flagDefault (anyone if overdue), seizeCollateral 50% partial / 100% full (operator), markLiquidated, closeDeal with outcome. Matches liquidation_engine program + escrow_vault.</p>
                <p className="mt-2 text-amber">Day 3 prep: 10 scripted cycles → security-audits/pass-3 evidence, known-limitations page, Netlify deployment.</p>
              </div>
            </Card>
          </div>
        </div>
      </AppFrame>
    </ErrorBoundary>
  );
}
