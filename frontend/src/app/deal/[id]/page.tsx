"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card } from "@/lib/design-system";
import { dealIdFromUrl, useProtocol } from "@/lib/protocol/hooks";
import { dealPda, loanPda, vaultPda, vaultTokenPda } from "@/lib/protocol/pdas";
import { fetchDeal, fetchLoan, fetchVault, type DecodedDeal, type DecodedLoan, type DecodedVault } from "@/lib/protocol/accounts";
import {
  activateLoan, confirmDeal, depositCollateral, flagDefault, initializeVault, makePayment, repayInFull,
} from "@/lib/protocol/instructions";
import { termsHash } from "@/lib/protocol/terms";
import { MINTS, TREASURY } from "@/lib/protocol/config";
import type { PublicKey } from "@solana/web3.js";

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-orange-50">{label}</dt><dd className="break-all text-right">{value}</dd></div>;
}

export default function DealPage() {
  const params = useSearchParams();
  const { connection, publicKey, send, ataOf, pending } = useProtocol();
  const [deal, setDeal] = useState<DecodedDeal | null>(null);
  const [vault, setVault] = useState<DecodedVault | null>(null);
  const [loan, setLoan] = useState<DecodedLoan | null>(null);
  const [error, setError] = useState("");
  const idParam = params.get("id");
  const dealId = idParam ? dealIdFromUrl(idParam) : null;

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

  useEffect(() => { void reload(); }, [reload]);

  if (!dealId) return <AppFrame eyebrow="Deal" title="Invalid deal link"><p className="mt-4 text-orange-50">The deal id in this link is malformed.</p></AppFrame>;
  if (error) return <AppFrame eyebrow="Deal" title="Deal"><p className="mt-4 text-orange-50">{error}</p></AppFrame>;
  if (!deal) return <AppFrame eyebrow="Deal" title="Loading deal…"><p className="mt-4 text-orange-50">Fetching from Devnet…</p></AppFrame>;

  const terms = deal.terms;
  const me = publicKey;
  const isCreator = me ? me.equals(deal.creator) : false;
  const isCounterparty = Boolean(me && ((deal.creatorSide === "borrower" && deal.lender?.equals(me)) || (deal.creatorSide === "lender" && deal.borrower?.equals(me))));
  const isBorrower = Boolean(me && deal.borrower?.equals(me));
  const isLender = Boolean(me && deal.lender?.equals(me));
  const fmt = (atoms: bigint, decimals = 6) => (Number(atoms) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 8 });
  const currencyLabel = MINTS.USDC && terms.loanMint.equals(MINTS.USDC) ? "USDC" : "USDT";

  async function act(instructions: Parameters<typeof send>[0], mints: Parameters<typeof send>[1] = []) {
    await send(instructions, mints);
    await reload();
  }

  const nextInstallment = loan
    ? (loan.paymentsMade + 1 === loan.durationMonths ? loan.finalInstallmentAtoms : loan.installmentAtoms)
    : BigInt(0);

  return (
    <AppFrame eyebrow={`Deal · ${deal.visibility}`} title={deal.state.replace(/_/g, " ")}>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <p className="eyebrow">Agreed terms</p>
          <dl className="mt-5 space-y-3 font-mono text-sm">
            <Row label="Principal" value={`${fmt(terms.principalAtoms)} ${currencyLabel}`} />
            <Row label="Collateral" value={`${fmt(terms.collateralAtoms, 8)} tBTC`} />
            <Row label="Rate" value={`${terms.rateBps / 100}% APR`} />
            <Row label="Duration" value={`${terms.durationMonths} months`} />
            <Row label="LTV" value={`${terms.ltvBps / 100}%`} />
            <Row label="Borrower" value={deal.borrower ? `${deal.borrower.toBase58().slice(0, 10)}…` : "open"} />
            <Row label="Lender" value={deal.lender ? `${deal.lender.toBase58().slice(0, 10)}…` : "open"} />
            {vault && <Row label="Vault" value={`${vault.state} · ${fmt(vault.collateralAtoms, 8)} tBTC`} />}
            {loan && <Row label="Payments" value={`${loan.paymentsMade}/${loan.durationMonths} · paid ${fmt(loan.totalPaidAtoms)} ${currencyLabel}`} />}
          </dl>
        </Card>

        <Card>
          <p className="eyebrow">Actions</p>
          <div className="mt-5 space-y-3">
            {deal.state === "proposed" && isCounterparty && me && (
              <Button className="w-full" disabled={pending.busy} onClick={() => act([confirmDeal({
                confirmer: me, dealPda: dealPda(dealId), expectedTermsHash: termsHash(terms),
              })])}>Confirm these exact terms</Button>
            )}
            {deal.state === "proposed" && isCreator && (
              <p className="text-sm leading-6 text-orange-50">Waiting for the counterparty. Share this page&apos;s link with them — confirmation is checked against a hash of the exact terms above.</p>
            )}
            {deal.state === "confirmed" && isBorrower && me && !vault && (
              <Button className="w-full" disabled={pending.busy} onClick={() => act([initializeVault({
                borrower: me, dealId, vaultPda: vaultPda(dealId),
                vaultTokenAccount: vaultTokenPda(dealId), collateralMint: terms.collateralMint,
              })])}>Create collateral vault</Button>
            )}
            {deal.state === "confirmed" && vault?.state === "open" && isBorrower && me && (
              <Button className="w-full" disabled={pending.busy} onClick={() => act([depositCollateral({
                borrower: me, vaultPda: vaultPda(dealId), collateralMint: terms.collateralMint,
                borrowerTokenAccount: ataOf(terms.collateralMint, me),
                vaultTokenAccount: vaultTokenPda(dealId), amount: terms.collateralAtoms,
              })], [terms.collateralMint, terms.loanMint])}>Deposit {fmt(terms.collateralAtoms, 8)} tBTC collateral</Button>
            )}
            {vault?.state === "locked" && deal.state === "confirmed" && (
              <p className="text-sm leading-6 text-orange-50">Collateral locked. The operator opens funding next, then the lender activates the loan.</p>
            )}
            {deal.state === "funding" && isLender && me && !loan && (
              <Button className="w-full" disabled={pending.busy} onClick={() => act([activateLoan({
                lender: me, borrower: deal.borrower as PublicKey, dealId, loanPda: loanPda(dealId),
                loanMint: terms.loanMint,
                lenderTokenAccount: ataOf(terms.loanMint, me),
                borrowerTokenAccount: ataOf(terms.loanMint, deal.borrower as PublicKey),
                treasuryTokenAccount: ataOf(terms.loanMint, TREASURY),
                principalAtoms: terms.principalAtoms, rateBps: terms.rateBps, durationMonths: terms.durationMonths,
                collateralAtoms: terms.collateralAtoms, treasuryFeeAtoms: (terms.principalAtoms * BigInt(200)) / BigInt(10_000),
              })], [terms.loanMint])}>Fund the loan (2% fee)</Button>
            )}
            {deal.state === "active" && isBorrower && me && loan && (
              <>
                <Button className="w-full" disabled={pending.busy} onClick={() => act([makePayment({
                  loanPda: loanPda(dealId), borrower: me, loanMint: loan.loanMint,
                  borrowerTokenAccount: ataOf(loan.loanMint, me),
                  lenderTokenAccount: ataOf(loan.loanMint, loan.lender),
                  amount: nextInstallment,
                })], [loan.loanMint])}>Pay installment {loan.paymentsMade + 1} ({fmt(nextInstallment)} {currencyLabel})</Button>
                <Button className="w-full" disabled={pending.busy} onClick={() => act([repayInFull({
                  loanPda: loanPda(dealId), borrower: me, loanMint: loan.loanMint,
                  borrowerTokenAccount: ataOf(loan.loanMint, me),
                  lenderTokenAccount: ataOf(loan.loanMint, loan.lender),
                })], [loan.loanMint])}>Repay in full</Button>
              </>
            )}
            {loan && (loan.state === "active" || loan.state === "defaulted") && me && (
              <Button className="w-full" disabled={pending.busy} onClick={() => act([flagDefault({
                reporter: me, loanPda: loanPda(dealId),
              })])}>Report default (anyone, if overdue)</Button>
            )}
            {!me && <p className="text-sm text-orange-50">Connect your wallet to see the actions available to your role.</p>}
            {pending.result && !pending.result.ok && (
              <p role="alert" className="border-l-2 border-red-500 bg-red-500/5 p-3 text-sm text-orange-50">{pending.result.failure.message}</p>
            )}
            {pending.result?.ok && (
              <p role="status" className="border-l-2 border-emerald-500 bg-emerald-500/5 p-3 text-sm">
                <a className="text-amber underline" target="_blank" rel="noopener noreferrer" href={pending.result.explorerUrl}>Confirmed — view transaction</a>
              </p>
            )}
            {pending.busy && <p className="text-sm text-orange-50">Confirm in your wallet…</p>}
          </div>
        </Card>
      </div>
    </AppFrame>
  );
}
