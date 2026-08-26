"use client";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input } from "@/lib/design-system";
import { dealIdFromUrl, useProtocol } from "@/lib/protocol/hooks";
import { dealPda, loanPda, vaultPda, vaultTokenPda } from "@/lib/protocol/pdas";
import { fetchDeal, fetchLoan, fetchVault, type DecodedDeal, type DecodedLoan, type DecodedVault } from "@/lib/protocol/accounts";
import {
  beginFunding, closeDeal, CloseOutcome, lockVault, markActive, markLiquidated, releaseCollateral, seizeCollateral,
} from "@/lib/protocol/instructions";
import { MINTS } from "@/lib/protocol/config";
import type { PublicKey } from "@solana/web3.js";

/**
 * Operator (keeper) console. The programs contain no cross-program CPIs, so
 * the wallet recorded in each program's configuration signs the state
 * transitions they cannot drive themselves. On devnet that is governance
 * signer 1; connect that wallet to use this page.
 */
export default function KeeperPage() {
  const { connection, publicKey, isOperator, send, ataOf, pending } = useProtocol();
  const [query, setQuery] = useState("");
  const [dealId, setDealId] = useState<Uint8Array | null>(null);
  const [deal, setDeal] = useState<DecodedDeal | null>(null);
  const [vault, setVault] = useState<DecodedVault | null>(null);
  const [loan, setLoan] = useState<DecodedLoan | null>(null);

  const load = useCallback(async () => {
    if (!dealId) return;
    const [d, v, l] = await Promise.all([
      fetchDeal(connection, dealId), fetchVault(connection, dealId), fetchLoan(connection, dealId),
    ]);
    setDeal(d); setVault(v); setLoan(l);
  }, [connection, dealId]);

  useEffect(() => { void load(); }, [load]);

  async function act(instructions: Parameters<typeof send>[0], mints: Parameters<typeof send>[1] = []) {
    await send(instructions, mints);
    await load();
  }

  const operator = publicKey as PublicKey;
  const fmt = (atoms: bigint, decimals = 6) => (Number(atoms) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 8 });

  return (
    <AppFrame eyebrow="Keeper operations" title="Operator console">
      <div className="mt-8 max-w-3xl space-y-6">
        <Card>
          <p className="eyebrow">One-time setup</p>
          <p className="mt-3 text-sm leading-6 text-orange-50">Create the fee destination token accounts for the treasury wallet (USDC and USDT stand-ins).</p>
          <Button className="mt-4" disabled={!isOperator || pending.busy || !MINTS.USDC || !MINTS.USDT}
            onClick={() => act([], [MINTS.USDC, MINTS.USDT].filter(Boolean) as PublicKey[])}>
            Prepare treasury accounts
          </Button>
        </Card>

        <Card>
          <p className="eyebrow">Deal operations</p>
          <div className="mt-4 flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value.trim())} placeholder="Paste a deal link id" />
            <Button onClick={() => { const id = dealIdFromUrl(query); setDealId(id); }}>Load</Button>
          </div>
          {!isOperator && publicKey && <p className="mt-4 text-sm text-orange-50">Connected wallet is not the configured operator — actions will be refused by the programs.</p>}
          {!publicKey && <p className="mt-4 text-sm text-orange-50">Connect the operator wallet (governance signer 1 on devnet).</p>}

          {dealId && deal && (
            <div className="mt-6 space-y-3">
              <p className="font-mono text-xs text-orange-50">state: {deal.state}{vault ? ` · vault ${vault.state} (${fmt(vault.collateralAtoms, 8)} tBTC)` : ""}{loan ? ` · loan ${loan.state}` : ""}</p>
              {deal.state === "confirmed" && vault?.state === "open" && (
                <Button className="w-full" disabled={pending.busy} onClick={() => act([lockVault({
                  operator, vaultPda: vaultPda(dealId), requiredAtoms: deal.terms.collateralAtoms,
                })])}>1 · Verify and lock vault</Button>
              )}
              {deal.state === "confirmed" && vault?.state === "locked" && (
                <Button className="w-full" disabled={pending.busy} onClick={() => act([beginFunding({ operator, dealPda: dealPda(dealId) })])}>2 · Open funding</Button>
              )}
              {deal.state === "funding" && !loan && (
                <p className="text-sm text-orange-50">Waiting for the lender to activate the loan.</p>
              )}
              {deal.state === "funding" && loan && (
                <Button className="w-full" disabled={pending.busy} onClick={() => act([markActive({ operator, dealPda: dealPda(dealId) })])}>3 · Mark deal active</Button>
              )}
              {deal.state === "active" && loan?.state === "completed" && (
                <>
                  <Button className="w-full" disabled={pending.busy} onClick={() => act([releaseCollateral({
                    operator, vaultPda: vaultPda(dealId), collateralMint: deal.terms.collateralMint,
                    vaultTokenAccount: vaultTokenPda(dealId),
                    borrowerTokenAccount: ataOf(deal.terms.collateralMint, deal.borrower as PublicKey),
                  })])}>3 · Release collateral to borrower</Button>
                  <Button className="w-full" disabled={pending.busy} onClick={() => act([closeDeal({
                    operator, dealPda: dealPda(dealId), outcome: CloseOutcome.Completed,
                  })])}>4 · Close deal (completed)</Button>
                </>
              )}
              {loan && (loan.state === "defaulted" || loan.state === "partially_liquidated") && (
                <>
                  <Button className="w-full" disabled={pending.busy} onClick={() => act([seizeCollateral({
                    operator, vaultPda: vaultPda(dealId), collateralMint: deal.terms.collateralMint,
                    vaultTokenAccount: vaultTokenPda(dealId),
                    recipientTokenAccount: ataOf(deal.terms.collateralMint, deal.lender as PublicKey),
                    amount: vault ? vault.collateralAtoms : BigInt(0),
                  })])}>Seize remaining collateral (full liquidation)</Button>
                  <Button className="w-full" disabled={pending.busy} onClick={() => act([markLiquidated({
                    operator, loanPda: loanPda(dealId), fully: true,
                  })])}>Mark loan fully liquidated</Button>
                </>
              )}
              {loan?.state === "fully_liquidated" && deal.state !== "fully_liquidated" && (
                <Button className="w-full" disabled={pending.busy} onClick={() => act([closeDeal({
                  operator, dealPda: dealPda(dealId), outcome: CloseOutcome.FullyLiquidated,
                })])}>Close deal (fully liquidated)</Button>
              )}
              {pending.result && !pending.result.ok && <p role="alert" className="border-l-2 border-red-500 bg-red-500/5 p-3 text-sm text-orange-50">{pending.result.failure.message}</p>}
              {pending.result?.ok && <p role="status" className="border-l-2 border-emerald-500 bg-emerald-500/5 p-3 text-sm"><a className="text-amber underline" target="_blank" rel="noopener noreferrer" href={pending.result.explorerUrl}>Confirmed — view transaction</a></p>}
            </div>
          )}
        </Card>
      </div>
    </AppFrame>
  );
}
