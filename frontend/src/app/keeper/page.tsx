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
import { MINTS, OPERATOR } from "@/lib/protocol/config";
import { useDevnetBundle } from "@/lib/protocol/bundle";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { SendResult } from "@/lib/protocol/tx";

export default function KeeperPage() {
  const { connection, publicKey, isOperator: isWalletOperator, send, ataOf, pending: walletPending } = useProtocol();
  const { operatorKeypair, operatorPubkey } = useDevnetBundle();

  const [query, setQuery] = useState("");
  const [dealId, setDealId] = useState<Uint8Array | null>(null);
  const [deal, setDeal] = useState<DecodedDeal | null>(null);
  const [vault, setVault] = useState<DecodedVault | null>(null);
  const [loan, setLoan] = useState<DecodedLoan | null>(null);

  const [localPending, setLocalPending] = useState<{ busy: boolean; result: SendResult | null }>({
    busy: false,
    result: null,
  });

  const pending = operatorKeypair ? localPending : walletPending;
  const operator = operatorKeypair ? operatorKeypair.publicKey : (publicKey as PublicKey);
  const isOperator = Boolean(operator && operator.equals(OPERATOR));

  const load = useCallback(async () => {
    if (!dealId) return;
    const [d, v, l] = await Promise.all([
      fetchDeal(connection, dealId), fetchVault(connection, dealId), fetchLoan(connection, dealId),
    ]);
    setDeal(d); setVault(v); setLoan(l);
  }, [connection, dealId]);

  useEffect(() => { void load(); }, [load]);

  async function act(instructions: TransactionInstruction[], mintsForAtas: PublicKey[] = []) {
    if (operatorKeypair) {
      setLocalPending({ busy: true, result: null });
      try {
        const prep: TransactionInstruction[] = [];
        for (const mint of mintsForAtas) {
          const ata = getAssociatedTokenAddressSync(mint, operatorKeypair.publicKey, false, TOKEN_PROGRAM_ID);
          const info = await connection.getAccountInfo(ata);
          if (!info) {
            prep.push(createAssociatedTokenAccountInstruction(operatorKeypair.publicKey, ata, operatorKeypair.publicKey, mint, TOKEN_PROGRAM_ID));
          }
        }
        const all = [...prep, ...instructions];
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction().add(...all);
        tx.recentBlockhash = blockhash;
        tx.feePayer = operatorKeypair.publicKey;
        tx.sign(operatorKeypair);
        const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        setLocalPending({
          busy: false,
          result: { ok: true, signature, explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet` },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setLocalPending({
          busy: false,
          result: { ok: false, failure: { kind: "program-error", message: msg } },
        });
      }
      await load();
    } else {
      await send(instructions, mintsForAtas);
      await load();
    }
  }

  const fmt = (atoms: bigint, decimals = 6) => (Number(atoms) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 8 });

  return (
    <AppFrame eyebrow="Keeper operations" title="Operator console">
      <div className="mt-8 max-w-3xl space-y-6">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Signer Authority</p>
              <h2 className="mt-1 font-display text-xl uppercase">Keeper Mode</h2>
            </div>
            <span
              className={`rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
                operatorKeypair
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : isWalletOperator
                  ? "border-amber/40 bg-amber/10 text-amber"
                  : "border-red-500/30 bg-red-500/10 text-orange-50"
              }`}
            >
              {operatorKeypair
                ? "● Auto-Signing via Bundle Keypair"
                : isWalletOperator
                ? "● Wallet Connected as Operator"
                : "○ Not Authorized"}
            </span>
          </div>

          <p className="mt-3 text-sm leading-6 text-orange-50">
            {operatorKeypair ? (
              <span>
                Authorized keeper active: <code className="text-amber">{operatorPubkey?.slice(0, 12)}…</code>. Actions will be signed directly without needing wallet approvals.
              </span>
            ) : (
              <span>
                Load the <code className="text-amber">persat-devnet-keypairs-KEEP-SECRET.json</code> bundle on the{" "}
                <a href="/faucet" className="text-amber underline">Faucet page</a> to enable automated signing, or connect the operator wallet in Phantom.
              </span>
            )}
          </p>

          <div className="mt-5 border-t border-amber/10 pt-4">
            <p className="eyebrow">One-time setup</p>
            <p className="mt-2 text-sm leading-6 text-orange-50">Create the fee destination token accounts for the treasury wallet (USDC and USDT stand-ins).</p>
            <Button
              className="mt-4"
              disabled={!isOperator || pending.busy || !MINTS.USDC || !MINTS.USDT}
              onClick={() => act([], [MINTS.USDC, MINTS.USDT].filter(Boolean) as PublicKey[])}
            >
              Prepare treasury accounts
            </Button>
          </div>
        </Card>

        <Card>
          <p className="eyebrow">Deal operations</p>
          <div className="mt-4 flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value.trim())} placeholder="Paste a deal link id" />
            <Button onClick={() => { const id = dealIdFromUrl(query); setDealId(id); }}>Load</Button>
          </div>
          {!isOperator && publicKey && !operatorKeypair && (
            <p className="mt-4 text-sm text-orange-50">Connected wallet is not the configured operator. Load the bundle on /faucet or switch wallets.</p>
          )}

          {dealId && deal && (
            <div className="mt-6 space-y-3">
              <p className="font-mono text-xs text-orange-50">state: {deal.state}{vault ? ` · vault ${vault.state} (${fmt(vault.collateralAtoms, 8)} tBTC)` : ""}{loan ? ` · loan ${loan.state}` : ""}</p>
              {deal.state === "confirmed" && vault?.state === "open" && (
                <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([lockVault({
                  operator, vaultPda: vaultPda(dealId), requiredAtoms: deal.terms.collateralAtoms,
                })])}>1 · Verify and lock vault</Button>
              )}
              {deal.state === "confirmed" && vault?.state === "locked" && (
                <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([beginFunding({ operator, dealPda: dealPda(dealId) })])}>2 · Open funding</Button>
              )}
              {deal.state === "funding" && !loan && (
                <p className="text-sm text-orange-50">Waiting for the lender to activate the loan.</p>
              )}
              {deal.state === "funding" && loan && (
                <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([markActive({ operator, dealPda: dealPda(dealId) })])}>3 · Mark deal active</Button>
              )}
              {deal.state === "active" && loan?.state === "completed" && (
                <>
                  <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([releaseCollateral({
                    operator, vaultPda: vaultPda(dealId), collateralMint: deal.terms.collateralMint,
                    vaultTokenAccount: vaultTokenPda(dealId),
                    borrowerTokenAccount: ataOf(deal.terms.collateralMint, deal.borrower as PublicKey),
                  })])}>3 · Release collateral to borrower</Button>
                  <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([closeDeal({
                    operator, dealPda: dealPda(dealId), outcome: CloseOutcome.Completed,
                  })])}>4 · Close deal (completed)</Button>
                </>
              )}
              {loan && (loan.state === "defaulted" || loan.state === "partially_liquidated") && (
                <>
                  <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([seizeCollateral({
                    operator, vaultPda: vaultPda(dealId), collateralMint: deal.terms.collateralMint,
                    vaultTokenAccount: vaultTokenPda(dealId),
                    recipientTokenAccount: ataOf(deal.terms.collateralMint, deal.lender as PublicKey),
                    amount: vault ? BigInt(Math.round(Number(vault.collateralAtoms) * 0.5)) : BigInt(0),
                  })])}>Partial seize (50% collateral)</Button>
                  <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([seizeCollateral({
                    operator, vaultPda: vaultPda(dealId), collateralMint: deal.terms.collateralMint,
                    vaultTokenAccount: vaultTokenPda(dealId),
                    recipientTokenAccount: ataOf(deal.terms.collateralMint, deal.lender as PublicKey),
                    amount: vault ? vault.collateralAtoms : BigInt(0),
                  })])}>Seize remaining collateral (full liquidation)</Button>
                  <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([markLiquidated({
                    operator, loanPda: loanPda(dealId), fully: false,
                  })])}>Mark loan partially liquidated</Button>
                  <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([markLiquidated({
                    operator, loanPda: loanPda(dealId), fully: true,
                  })])}>Mark loan fully liquidated</Button>
                </>
              )}
              {loan?.state === "partially_liquidated" && deal.state !== "partially_liquidated" && (
                <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([closeDeal({
                  operator, dealPda: dealPda(dealId), outcome: CloseOutcome.PartiallyLiquidated,
                })])}>Close deal (partially liquidated)</Button>
              )}
              {loan?.state === "fully_liquidated" && deal.state !== "fully_liquidated" && (
                <Button className="w-full" disabled={pending.busy || !isOperator} onClick={() => act([closeDeal({
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
