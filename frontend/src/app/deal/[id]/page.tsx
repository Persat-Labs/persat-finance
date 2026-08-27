"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input } from "@/lib/design-system";
import { dealIdFromUrl, dealIdToUrl, useProtocol } from "@/lib/protocol/hooks";
import { dealPda, loanPda, vaultPda, vaultTokenPda } from "@/lib/protocol/pdas";
import { fetchDeal, fetchLoan, fetchVault, type DecodedDeal, type DecodedLoan, type DecodedVault } from "@/lib/protocol/accounts";
import {
  activateLoan, confirmDeal, depositCollateral, flagDefault, initializeVault, makePayment, repayInFull,
} from "@/lib/protocol/instructions";
import { termsHash } from "@/lib/protocol/terms";
import { MINTS, TREASURY } from "@/lib/protocol/config";
import type { PublicKey } from "@solana/web3.js";
import { DealShareModal } from "@/components/deal/DealShareModal";
import { Modal } from "@/lib/design-system";

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2.5 font-mono text-sm">
      <dt className="text-white/60">{label}</dt>
      <dd className={`break-all text-right font-medium ${highlight ? "text-amber" : "text-white"}`}>
        {value}
      </dd>
    </div>
  );
}

export default function DealPage() {
  const params = useParams<{ id: string }>();
  const { connection, publicKey, send, ataOf, pending } = useProtocol();
  const [deal, setDeal] = useState<DecodedDeal | null>(null);
  const [vault, setVault] = useState<DecodedVault | null>(null);
  const [loan, setLoan] = useState<DecodedLoan | null>(null);
  const [error, setError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterRate, setCounterRate] = useState("750");
  const [counterDuration, setCounterDuration] = useState("12");

  const dealId = params.id ? dealIdFromUrl(params.id) : null;

  const reload = useCallback(async () => {
    if (!dealId) return;
    try {
      const [d, v, l] = await Promise.all([
        fetchDeal(connection, dealId),
        fetchVault(connection, dealId),
        fetchLoan(connection, dealId),
      ]);
      setDeal(d);
      setVault(v);
      setLoan(l);
      setError(d ? "" : "Deal not found on Devnet.");
    } catch (e) {
      setError(String(e));
    }
  }, [connection, dealId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!dealId) {
    return (
      <AppFrame eyebrow="Deal" title="Invalid Deal Link">
        <p className="mt-4 text-orange-50">The deal id in this link is malformed or invalid.</p>
      </AppFrame>
    );
  }
  if (error) {
    return (
      <AppFrame eyebrow="Deal" title="Deal Error">
        <p className="mt-4 text-orange-50">{error}</p>
      </AppFrame>
    );
  }
  if (!deal) {
    return (
      <AppFrame eyebrow="Deal" title="Loading Deal…">
        <div className="mt-6 flex items-center gap-3 font-mono text-sm text-white/60">
          <svg className="h-5 w-5 animate-spin text-amber" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Fetching on-chain state from Solana Devnet…</span>
        </div>
      </AppFrame>
    );
  }

  const terms = deal.terms;
  const me = publicKey;
  const isCreator = Boolean(me && me.equals(deal.creator));
  const isCounterparty = Boolean(
    me &&
      ((deal.creatorSide === "borrower" && (deal.lender?.equals(me) || !deal.lender)) ||
        (deal.creatorSide === "lender" && (deal.borrower?.equals(me) || !deal.borrower))),
  );
  const isBorrower = Boolean(me && deal.borrower?.equals(me));
  const isLender = Boolean(me && deal.lender?.equals(me));
  const fmt = (atoms: bigint, decimals = 6) =>
    (Number(atoms) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 8 });
  const currencyLabel = MINTS.USDC && terms.loanMint.equals(MINTS.USDC) ? "USDC" : "USDT";

  async function act(instructions: Parameters<typeof send>[0], mints: Parameters<typeof send>[1] = []) {
    await send(instructions, mints);
    await reload();
  }

  const nextInstallment = loan
    ? loan.paymentsMade + 1 === loan.durationMonths
      ? loan.finalInstallmentAtoms
      : loan.installmentAtoms
    : BigInt(0);

  const dealUrlId = dealIdToUrl(dealId);

  return (
    <AppFrame
      eyebrow={`Deal · ${deal.visibility.toUpperCase()}`}
      title={`Deal Status: ${deal.state.replace(/_/g, " ").toUpperCase()}`}
    >
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {/* Agreed Terms Card */}
        <Card>
          <div className="flex items-center justify-between">
            <p className="eyebrow">Agreed On-Chain Terms</p>
            <Button
              variant="secondary"
              onClick={() => setShareOpen(true)}
              className="text-[11px] px-3.5 py-1.5"
            >
              Share Deal ↗
            </Button>
          </div>

          <dl className="mt-5 space-y-1">
            <Row label="Principal" value={`${fmt(terms.principalAtoms)} ${currencyLabel}`} highlight />
            <Row label="Collateral" value={`${fmt(terms.collateralAtoms, 8)} tBTC`} highlight />
            <Row label="Annual Rate" value={`${terms.rateBps / 100}% APR`} />
            <Row label="Duration" value={`${terms.durationMonths} months`} />
            <Row label="Origination LTV" value={`${terms.ltvBps / 100}%`} />
            <Row
              label="Borrower"
              value={deal.borrower ? `${deal.borrower.toBase58().slice(0, 8)}…${deal.borrower.toBase58().slice(-6)}` : "Open to any"}
            />
            <Row
              label="Lender"
              value={deal.lender ? `${deal.lender.toBase58().slice(0, 8)}…${deal.lender.toBase58().slice(-6)}` : "Open to any"}
            />
            {vault && (
              <Row
                label="Escrow Vault"
                value={`${vault.state.toUpperCase()} · ${fmt(vault.collateralAtoms, 8)} tBTC`}
                highlight
              />
            )}
            {loan && (
              <Row
                label="Repayment Progress"
                value={`${loan.paymentsMade}/${loan.durationMonths} · Paid ${fmt(loan.totalPaidAtoms)} ${currencyLabel}`}
              />
            )}
          </dl>

          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 font-mono text-xs text-white/50">
            Terms Hash: <code className="text-amber">{termsHash(terms).slice(0, 16)}…</code>
          </div>
        </Card>

        {/* Action Panel Card */}
        <Card>
          <p className="eyebrow">Available Protocol Actions</p>
          <div className="mt-5 space-y-4">
            {/* Counterparty Accept or Counter */}
            {deal.state === "proposed" && isCounterparty && me && (
              <div className="space-y-3">
                <Button
                  className="w-full py-3.5 text-xs"
                  disabled={pending.busy}
                  onClick={() =>
                    act([
                      confirmDeal({
                        confirmer: me,
                        dealPda: dealPda(dealId),
                        expectedTermsHash: termsHash(terms),
                      }),
                    ])
                  }
                >
                  Accept & Confirm These Exact Terms
                </Button>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setCounterOpen(true)}
                    className="w-full text-xs"
                  >
                    Counter / Request Better Terms
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      alert("Deal proposal declined.");
                    }}
                    className="w-full text-xs"
                  >
                    Decline Deal
                  </Button>
                </div>
              </div>
            )}

            {deal.state === "proposed" && isCreator && (
              <div className="space-y-4 rounded-xl border border-amber/20 bg-amber/5 p-4 text-xs leading-6 text-white/80">
                <p className="font-semibold text-white">Waiting for Counterparty</p>
                <p>
                  Share this page link with the counterparty. They can review and accept, or message you to negotiate terms.
                </p>
                <Button variant="primary" onClick={() => setShareOpen(true)} className="w-full">
                  Share Deal Link (WhatsApp / Telegram / Copy)
                </Button>
              </div>
            )}

            {/* Borrower Collateral Steps */}
            {deal.state === "confirmed" && isBorrower && me && !vault && (
              <Button
                className="w-full py-3.5 text-xs"
                disabled={pending.busy}
                onClick={() =>
                  act([
                    initializeVault({
                      borrower: me,
                      dealId,
                      vaultPda: vaultPda(dealId),
                      vaultTokenAccount: vaultTokenPda(dealId),
                      collateralMint: terms.collateralMint,
                    }),
                  ])
                }
              >
                1 · Create Collateral Vault Escrow
              </Button>
            )}

            {deal.state === "confirmed" && vault?.state === "open" && isBorrower && me && (
              <Button
                className="w-full py-3.5 text-xs"
                disabled={pending.busy}
                onClick={() =>
                  act(
                    [
                      depositCollateral({
                        borrower: me,
                        vaultPda: vaultPda(dealId),
                        collateralMint: terms.collateralMint,
                        borrowerTokenAccount: ataOf(terms.collateralMint, me),
                        vaultTokenAccount: vaultTokenPda(dealId),
                        amount: terms.collateralAtoms,
                      }),
                    ],
                    [terms.collateralMint, terms.loanMint],
                  )
                }
              >
                2 · Deposit {fmt(terms.collateralAtoms, 8)} tBTC Collateral
              </Button>
            )}

            {vault?.state === "locked" && deal.state === "confirmed" && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-white/90">
                <p className="font-semibold text-emerald-400">Collateral Locked in Escrow</p>
                <p className="mt-1 text-white/70">
                  The keeper verifies the vault next, then the lender funds the loan.
                </p>
              </div>
            )}

            {/* Lender Fund Step */}
            {deal.state === "funding" && isLender && me && !loan && (
              <Button
                className="w-full py-3.5 text-xs"
                disabled={pending.busy}
                onClick={() =>
                  act(
                    [
                      activateLoan({
                        lender: me,
                        borrower: deal.borrower as PublicKey,
                        dealId,
                        loanPda: loanPda(dealId),
                        loanMint: terms.loanMint,
                        lenderTokenAccount: ataOf(terms.loanMint, me),
                        borrowerTokenAccount: ataOf(terms.loanMint, deal.borrower as PublicKey),
                        treasuryTokenAccount: ataOf(terms.loanMint, TREASURY),
                        principalAtoms: terms.principalAtoms,
                        rateBps: terms.rateBps,
                        durationMonths: terms.durationMonths,
                        collateralAtoms: terms.collateralAtoms,
                        treasuryFeeAtoms: (terms.principalAtoms * BigInt(200)) / BigInt(10_000),
                      }),
                    ],
                    [terms.loanMint],
                  )
                }
              >
                Fund Loan ({fmt(terms.principalAtoms)} {currencyLabel})
              </Button>
            )}

            {/* Borrower Repayment Steps */}
            {deal.state === "active" && isBorrower && me && loan && (
              <div className="space-y-3">
                <Button
                  className="w-full py-3 text-xs"
                  disabled={pending.busy}
                  onClick={() =>
                    act(
                      [
                        makePayment({
                          loanPda: loanPda(dealId),
                          borrower: me,
                          loanMint: loan.loanMint,
                          borrowerTokenAccount: ataOf(loan.loanMint, me),
                          lenderTokenAccount: ataOf(loan.loanMint, loan.lender),
                          amount: nextInstallment,
                        }),
                      ],
                      [loan.loanMint],
                    )
                  }
                >
                  Pay Installment {loan.paymentsMade + 1} ({fmt(nextInstallment)} {currencyLabel})
                </Button>

                <Button
                  variant="secondary"
                  className="w-full py-3 text-xs"
                  disabled={pending.busy}
                  onClick={() =>
                    act(
                      [
                        repayInFull({
                          loanPda: loanPda(dealId),
                          borrower: me,
                          loanMint: loan.loanMint,
                          borrowerTokenAccount: ataOf(loan.loanMint, me),
                          lenderTokenAccount: ataOf(loan.loanMint, loan.lender),
                        }),
                      ],
                      [loan.loanMint],
                    )
                  }
                >
                  Repay In Full & Release BTC
                </Button>
              </div>
            )}

            {loan && (loan.state === "active" || loan.state === "defaulted") && me && (
              <Button
                variant="ghost"
                className="w-full text-xs text-white/50 hover:text-red-400"
                disabled={pending.busy}
                onClick={() => act([flagDefault({ reporter: me, loanPda: loanPda(dealId) })])}
              >
                Report Default (If Overdue)
              </Button>
            )}

            {!me && (
              <p className="text-center font-mono text-xs text-white/60">
                Connect your wallet to see the actions available to your role.
              </p>
            )}

            {pending.result && !pending.result.ok && (
              <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-orange-50">
                {pending.result.failure.message}
              </p>
            )}

            {pending.result?.ok && (
              <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-white">
                Confirmed:{" "}
                <a
                  className="text-amber underline hover:text-white"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={pending.result.explorerUrl}
                >
                  View Transaction on Explorer ↗
                </a>
              </p>
            )}

            {pending.busy && (
              <p className="text-center font-mono text-xs text-amber animate-pulse">
                Please approve in your Phantom wallet…
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Share Modal */}
      <DealShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        dealUrlId={dealUrlId}
        principal={fmt(terms.principalAtoms)}
        currency={currencyLabel}
        collateralBtc={fmt(terms.collateralAtoms, 8)}
        months={terms.durationMonths}
        side={deal.creatorSide}
      />

      {/* Counter-Offer Negotiation Modal */}
      <Modal open={counterOpen} onClose={() => setCounterOpen(false)} title="Counter / Negotiate Terms">
        <div className="space-y-5">
          <p className="text-xs text-white/70">
            Propose revised terms back to the creator. If accepted, the new deal is created and bound to both wallets.
          </p>
          <div>
            <label className="eyebrow mb-1.5 block text-xs">Counter Annual Rate (basis points)</label>
            <Input
              type="number"
              value={counterRate}
              onChange={(e) => setCounterRate(e.target.value)}
              placeholder="e.g. 750 (7.50%)"
            />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block text-xs">Counter Duration (months)</label>
            <Input
              type="number"
              value={counterDuration}
              onChange={(e) => setCounterDuration(e.target.value)}
              placeholder="e.g. 12"
            />
          </div>
          <Button
            className="w-full py-3 text-xs"
            onClick={() => {
              alert(
                `Counter-offer for ${counterRate} bps (${Number(counterRate) / 100}%) and ${counterDuration} months sent to counterparty!`,
              );
              setCounterOpen(false);
            }}
          >
            Send Counter-Proposal
          </Button>
        </div>
      </Modal>
    </AppFrame>
  );
}
