"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card } from "@/lib/design-system";
import { dealIdFromUrl, dealIdToUrl, useProtocol } from "@/lib/protocol/hooks";
import { dealPda, loanPda, vaultPda, vaultTokenPda } from "@/lib/protocol/pdas";
import { fetchDeal, fetchLoan, fetchVault, type DecodedDeal, type DecodedLoan, type DecodedVault } from "@/lib/protocol/accounts";
import { flagDefault, makePayment, repayInFull, releaseCollateral, closeDeal, CloseOutcome } from "@/lib/protocol/instructions";
import { MINTS, OPERATOR } from "@/lib/protocol/config";
import { DealShareModal } from "@/components/deal/DealShareModal";
import { FundWalletModal } from "@/components/wallet/FundWalletModal";
import { useBtcPrice } from "@/lib/protocol/oracle";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function Row({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2.5 font-mono text-sm">
      <dt className="text-white/60">{label}</dt>
      <dd className={`break-all text-right font-medium ${highlight ? "text-amber" : warn ? "text-red-400" : "text-white"}`}>{value}</dd>
    </div>
  );
}

export default function RepayPage() {
  const params = useParams<{ id: string }>();
  const { connection, publicKey, send, ataOf, pending } = useProtocol();
  const { price: btcPrice, isFailClosed } = useBtcPrice();

  const [deal, setDeal] = useState<DecodedDeal | null>(null);
  const [vault, setVault] = useState<DecodedVault | null>(null);
  const [loan, setLoan] = useState<DecodedLoan | null>(null);
  const [error, setError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [payMode, setPayMode] = useState<"installment" | "full">("installment");

  const dealId = params.id ? dealIdFromUrl(params.id) : null;
  const dealUrlId = dealId ? dealIdToUrl(dealId) : "";

  const reload = useCallback(async () => {
    if (!dealId) return;
    try {
      const [d, v, l] = await Promise.all([fetchDeal(connection, dealId), fetchVault(connection, dealId), fetchLoan(connection, dealId)]);
      setDeal(d);
      setVault(v);
      setLoan(l);
      setError(d ? "" : "Deal not found — RPC rate-limited or not deployed.");
    } catch (e) {
      setError((e as Error).message.slice(0, 300));
    }
  }, [connection, dealId]);

  useEffect(() => {
    void reload();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void reload();
    }, 10000);
    return () => clearInterval(id);
  }, [reload]);

  if (!dealId) {
    return (
      <AppFrame eyebrow="Deal // Repay" title="Invalid Deal Link">
        <p className="mt-4 text-orange-50">Malformed deal id.</p>
      </AppFrame>
    );
  }

  if (error) {
    return (
      <AppFrame eyebrow="Deal // Repay — Reload-Safe" title="Deal Error">
        <Card className="mt-6">
          <p className="text-sm text-orange-50">{error}</p>
          <div className="mt-4 flex gap-3">
            <Button onClick={() => void reload()} className="text-xs">↻ Retry</Button>
            <Button variant="secondary" onClick={() => setFundingOpen(true)} className="text-xs">⚡ Get Funds</Button>
          </div>
        </Card>
        <FundWalletModal open={fundingOpen} onClose={() => setFundingOpen(false)} reason="Fund wallet to retry." />
      </AppFrame>
    );
  }

  if (!deal) {
    return (
      <AppFrame eyebrow="Deal // Repay" title="Loading Repayment…">
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="glass sheen rounded-[22px] p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex justify-between py-2 border-b border-white/5">
                <div className="shimmer-box h-4 w-24" />
                <div className="shimmer-box h-4 w-28" />
              </div>
            ))}
          </div>
          <div className="glass sheen rounded-[22px] p-6">
            <div className="shimmer-box h-12 w-full rounded-full" />
          </div>
        </div>
      </AppFrame>
    );
  }

  const terms = deal.terms;
  const me = publicKey;
  const isBorrower = Boolean(me && deal.borrower?.equals(me));
  const fmt = (atoms: bigint, decimals = 6) => (Number(atoms) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 8 });
  const currencyLabel = MINTS.USDC && terms.loanMint.equals(MINTS.USDC) ? "USDC" : "USDT";

  const nextInstallment = loan ? (loan.paymentsMade + 1 === loan.durationMonths ? loan.finalInstallmentAtoms : loan.installmentAtoms) : BigInt(0);
  const outstanding = loan ? loan.totalRepaymentAtoms - loan.totalPaidAtoms : BigInt(0);
  const progress = loan ? (loan.paymentsMade / loan.durationMonths) * 100 : 0;

  const btcUsd = btcPrice?.price ?? 60000;
  const collateralBtc = Number(terms.collateralAtoms) / 1e8;
  const collateralUsd = collateralBtc * btcUsd;

  async function act(instructions: Parameters<typeof send>[0], mints: Parameters<typeof send>[1] = []) {
    const res = await send(instructions, mints);
    await reload();
    return res;
  }

  return (
    <ErrorBoundary>
      <AppFrame eyebrow={`Deal · ${deal.visibility.toUpperCase()} · ${deal.state.toUpperCase()} — Reload-Safe`} title="Repayment — Installment, Full, Default">
        <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <span className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-white/60">Deal {dealUrlId.slice(0, 12)}…</span>
          <span className={`rounded-full border px-3 py-1 ${isFailClosed ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"}`}>
            BTC ${btcUsd.toLocaleString()} {isFailClosed ? "⚠ stale" : "✓ fresh"}
          </span>
          <Button variant="secondary" onClick={() => void reload()} className="text-[10px] px-3 py-1">↻ Reload Chain</Button>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          {/* Left: Schedule */}
          <div className="space-y-6">
            <Card>
              <p className="eyebrow">Repayment Schedule — On-Chain</p>
              <div className="mt-4">
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-white/60">Progress</span>
                  <span className="text-white">{loan ? `${loan.paymentsMade}/${loan.durationMonths}` : "—"} · {progress.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-3 overflow-hidden rounded-full border border-white/10 bg-black">
                  <div className="h-full bg-amber transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <dl className="mt-6 space-y-1">
                <Row label="Principal" value={`${fmt(terms.principalAtoms)} ${currencyLabel}`} highlight />
                <Row label="Total Repayment" value={loan ? `${fmt(loan.totalRepaymentAtoms)} ${currencyLabel}` : "—"} />
                <Row label="Paid" value={loan ? `${fmt(loan.totalPaidAtoms)} ${currencyLabel}` : "—"} highlight />
                <Row label="Outstanding" value={loan ? `${fmt(outstanding)} ${currencyLabel}` : "—"} warn={loan?.state === "defaulted"} />
                <Row label="Next Installment" value={loan ? `${fmt(nextInstallment)} ${currencyLabel}` : "—"} highlight />
                <Row label="Collateral Value" value={`$${collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${collateralBtc.toFixed(8)} BTC)`} />
                {vault && <Row label="Vault" value={`${vault.state.toUpperCase()} · ${fmt(vault.collateralAtoms, 8)} BTC`} highlight />}
                {loan && <Row label="Loan State" value={loan.state.toUpperCase()} highlight={loan.state === "active"} warn={loan.state === "defaulted" || loan.state === "fully_liquidated"} />}
              </dl>

              {loan?.state === "defaulted" && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-red-300">
                  ⚠ Loan defaulted — grace window closed. Keeper can execute partial liquidation (70% LTV) or full (80% LTV or terminal default). Borrower can still repay to cure.
                </div>
              )}
              {loan?.state === "partially_liquidated" && (
                <div className="mt-4 rounded-xl border border-amber/30 bg-amber/10 p-3 font-mono text-xs text-amber">
                  Partial liquidation executed — 50% collateral seized to cover missed payment + penalty. Loan continues with reduced collateral. LTV now higher — monitor closely.
                </div>
              )}
              {loan?.state === "fully_liquidated" && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-orange-50">
                  Full liquidation — debt repaid from collateral, surplus returned if any. Deal will be closed by keeper.
                </div>
              )}
            </Card>
          </div>

          {/* Right: Actions */}
          <div className="space-y-6">
            <Card>
              <p className="eyebrow">Available Actions — Borrower</p>
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" className={`text-[11px] ${payMode === "installment" ? "border-amber bg-amber/15" : ""}`} onClick={() => setPayMode("installment")}>Pay Installment</Button>
                  <Button variant="secondary" className={`text-[11px] ${payMode === "full" ? "border-amber bg-amber/15" : ""}`} onClick={() => setPayMode("full")}>Pay In Full</Button>
                </div>

                {isBorrower && loan && loan.state !== "completed" && loan.state !== "fully_liquidated" && (
                  <>
                    {payMode === "installment" ? (
                      <Button className="w-full py-3.5 text-xs" disabled={pending.busy || !me} onClick={() => act([makePayment({ loanPda: loanPda(dealId), borrower: me as any, loanMint: loan.loanMint, borrowerTokenAccount: ataOf(loan.loanMint, me as any), lenderTokenAccount: ataOf(loan.loanMint, loan.lender), amount: nextInstallment })], [loan.loanMint])}>
                        Pay Installment {loan.paymentsMade + 1} — {fmt(nextInstallment)} {currencyLabel}
                      </Button>
                    ) : (
                      <Button className="w-full py-3.5 text-xs bg-emerald-500/20 border-emerald-500/40 hover:bg-emerald-500/30" disabled={pending.busy || !me} onClick={() => act([repayInFull({ loanPda: loanPda(dealId), borrower: me as any, loanMint: loan.loanMint, borrowerTokenAccount: ataOf(loan.loanMint, me as any), lenderTokenAccount: ataOf(loan.loanMint, loan.lender) })], [loan.loanMint])}>
                        Repay In Full {fmt(outstanding)} {currencyLabel} & Release BTC
                      </Button>
                    )}
                  </>
                )}

                {loan && (loan.state === "active" || loan.state === "defaulted") && (
                  <Button variant="ghost" className="w-full text-xs text-white/40 hover:text-red-400" disabled={pending.busy} onClick={() => act([flagDefault({ reporter: me ?? OPERATOR, loanPda: loanPda(dealId) })])}>
                    Report Default (Anyone — if overdue past grace)
                  </Button>
                )}

                {deal.state === "active" && loan?.state === "completed" && (
                  <>
                    <Button className="w-full py-3 text-xs" disabled={pending.busy} onClick={() => act([releaseCollateral({ operator: OPERATOR, vaultPda: vaultPda(dealId), collateralMint: terms.collateralMint, vaultTokenAccount: vaultTokenPda(dealId), borrowerTokenAccount: ataOf(terms.collateralMint, deal.borrower as any) })])}>
                      Release Collateral to Borrower — Keeper
                    </Button>
                    <Button className="w-full py-3 text-xs" disabled={pending.busy} onClick={() => act([closeDeal({ operator: OPERATOR, dealPda: dealPda(dealId), outcome: CloseOutcome.Completed })])}>
                      Close Deal (Completed) — Keeper
                    </Button>
                  </>
                )}

                {!me && <p className="text-center font-mono text-xs text-white/60">Connect wallet to repay. State reload-safe — refresh keeps schedule.</p>}

                {pending.result && !pending.result.ok && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 space-y-2">
                    <p className="font-mono text-xs text-orange-50">{pending.result.failure.message.slice(0, 300)}</p>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setFundingOpen(true)} className="text-[10px] px-3 py-1">⚡ Need Funds</Button>
                      <Button variant="secondary" onClick={() => void reload()} className="text-[10px] px-3 py-1">↻ Reload</Button>
                    </div>
                    <p className="font-mono text-[10px] text-white/40">Failure UX polished — no crash, shows reason, suggests faucet, reload-safe.</p>
                  </div>
                )}

                {pending.result?.ok && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <p className="font-mono text-xs text-white">✓ Confirmed — <a href={pending.result.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-amber underline">Explorer ↗</a></p>
                    <p className="mt-1 font-mono text-[10px] text-white/50">Payment recorded on-chain. Refresh page — progress persists.</p>
                  </div>
                )}

                {pending.busy && <p className="text-center font-mono text-xs text-amber animate-pulse">Approving in Phantom…</p>}
              </div>
            </Card>

            <Card>
              <p className="eyebrow">Liquidation History — On-Chain Events</p>
              <div className="mt-3 space-y-2 font-mono text-[11px] text-white/60">
                {loan ? (
                  <>
                    <p>Payments made: {loan.paymentsMade} / {loan.durationMonths}</p>
                    <p>Total paid: {fmt(loan.totalPaidAtoms)} {currencyLabel}</p>
                    <p>State: {loan.state}</p>
                    <p>Vault: {vault ? `${vault.state} · ${fmt(vault.collateralAtoms, 8)} BTC` : "—"}</p>
                    <p className="text-[10px] text-white/30">All events emitted: LoanActivated, PaymentMade, LoanDefaulted, PartialLiquidationAuthorized, FullLiquidationAuthorized, CollateralSeized, LoanCompleted.</p>
                  </>
                ) : (
                  <p>Loan not yet activated — fund via lender first.</p>
                )}
              </div>
            </Card>
          </div>
        </div>

        <DealShareModal open={shareOpen} onClose={() => setShareOpen(false)} dealUrlId={dealUrlId} principal={fmt(terms.principalAtoms)} currency={currencyLabel} collateralBtc={fmt(terms.collateralAtoms, 8)} months={terms.durationMonths} side={deal.creatorSide} />
        <FundWalletModal open={fundingOpen} onClose={() => setFundingOpen(false)} reason="Fund wallet with Devnet SOL + USDC to repay." />
      </AppFrame>
    </ErrorBoundary>
  );
}
