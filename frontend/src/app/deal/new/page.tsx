"use client";
import { useMemo, useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input } from "@/lib/design-system";
import { MINTS } from "@/lib/protocol/config";
import { dealPda } from "@/lib/protocol/pdas";
import { proposeDeal, Side, Visibility } from "@/lib/protocol/instructions";
import { dealIdToUrl, randomDealId, useProtocol } from "@/lib/protocol/hooks";
import { PublicKey } from "@solana/web3.js";

export default function NewDealPage() {
  const { publicKey, send, pending } = useProtocol();
  const [side, setSide] = useState<"borrower" | "lender">("borrower");
  const [currency, setCurrency] = useState<"USDC" | "USDT">("USDC");
  const [principal, setPrincipal] = useState("1000");
  const [rateBps, setRateBps] = useState("820");
  const [months, setMonths] = useState<6 | 12 | 24>(12);
  const [collateralBtc, setCollateralBtc] = useState("0.05");
  const [counterparty, setCounterparty] = useState("");
  const [created, setCreated] = useState<{ dealUrlId: string } | null>(null);

  const loanMint = MINTS[currency];
  const collateralMint = MINTS.tBTC;
  const decimalsReady = Boolean(loanMint && collateralMint);

  const summary = useMemo(() => {
    const principalNum = Number(principal) || 0;
    const rate = (Number(rateBps) || 0) / 10_000;
    const total = principalNum * (1 + (rate * months) / 12);
    return { total, monthly: total / months };
  }, [principal, rateBps, months]);

  async function propose() {
    if (!publicKey || !loanMint || !collateralMint) return;
    const dealId = randomDealId();
    let counterpartyKey: PublicKey | null = null;
    if (counterparty.trim()) {
      try { counterpartyKey = new PublicKey(counterparty.trim()); }
      catch { return; }
    }
    await send(
      [proposeDeal({
        creator: publicKey,
        dealId,
        terms: {
          principalAtoms: BigInt(Math.round((Number(principal) || 0) * 1e6)),
          loanMint,
          collateralMint,
          collateralAtoms: BigInt(Math.round((Number(collateralBtc) || 0) * 1e8)),
          rateBps: Number(rateBps) || 0,
          durationMonths: months,
          ltvBps: 5_000,
        },
        visibility: counterpartyKey ? Visibility.Private : Visibility.Public,
        creatorSide: side === "borrower" ? Side.Borrower : Side.Lender,
        counterparty: counterpartyKey,
        dealPda: dealPda(dealId),
      })],
    );
    setCreated({ dealUrlId: dealIdToUrl(dealId) });
  }

  return (
    <AppFrame eyebrow="Direct deal" title="Propose a loan">
      <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <Card>
          <div className="space-y-6">
            <fieldset>
              <legend className="eyebrow mb-3">I am the</legend>
              <div className="grid grid-cols-2 gap-3">
                {(["borrower", "lender"] as const).map((role) => (
                  <button type="button" key={role} onClick={() => setSide(role)}
                    className={`min-h-12 border font-mono text-xs tracking-widest ${side === role ? "border-amber bg-amber/10 text-white" : "border-amber/20 bg-ink text-orange-50"}`}>
                    {role === "borrower" ? "Borrower (post BTC)" : "Lender (fund USDC)"}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label className="eyebrow block pb-2" htmlFor="principal">Loan amount</label>
              <div className="flex gap-2">
                <Input id="principal" type="number" min="1" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
                {(["USDC", "USDT"] as const).map((mint) => (
                  <button type="button" key={mint} onClick={() => setCurrency(mint)}
                    className={`min-h-12 shrink-0 border px-4 font-mono text-xs ${currency === mint ? "border-amber bg-amber/10 text-white" : "border-amber/20 bg-ink text-orange-50"}`}>{mint}</button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="eyebrow block pb-2" htmlFor="collateral">Collateral (tBTC)</label>
                <Input id="collateral" type="number" step="0.00000001" min="0.00000001" value={collateralBtc} onChange={(e) => setCollateralBtc(e.target.value)} />
              </div>
              <div>
                <label className="eyebrow block pb-2" htmlFor="rate">Annual rate (bps)</label>
                <Input id="rate" type="number" min="1" max="10000" value={rateBps} onChange={(e) => setRateBps(e.target.value)} />
              </div>
            </div>

            <fieldset>
              <legend className="eyebrow mb-3">Duration</legend>
              <div className="grid grid-cols-3 gap-3">
                {([6, 12, 24] as const).map((m) => (
                  <button type="button" key={m} onClick={() => setMonths(m)}
                    className={`min-h-14 border font-mono text-xs ${months === m ? "border-amber bg-amber/10 text-white" : "border-amber/20 bg-ink text-orange-50"}`}>{m} months</button>
                ))}
              </div>
            </fieldset>

            <div>
              <label className="eyebrow block pb-2" htmlFor="counterparty">Counterparty wallet — optional</label>
              <Input id="counterparty" value={counterparty} onChange={(e) => setCounterparty(e.target.value.trim())} placeholder="Leave blank for a public listing" />
            </div>

            {!decimalsReady && (
              <p role="status" className="border-l-2 border-amber bg-amber/5 p-3 text-sm leading-6 text-orange-50">
                Stand-in mints are published right after the first Devnet deployment. Proposing unlocks then.
              </p>
            )}
            {pending.result && !pending.result.ok && (
              <p role="alert" className="border-l-2 border-red-500 bg-red-500/5 p-3 text-sm text-orange-50">{pending.result.failure.message}</p>
            )}
            {pending.result?.ok && created && (
              <p role="status" className="border-l-2 border-emerald-500 bg-emerald-500/5 p-3 text-sm text-white">
                Deal proposed. <a className="text-amber underline" href={`/deal/${created.dealUrlId}`}>Open the deal →</a> ·{" "}
                <a className="text-amber underline" target="_blank" rel="noopener noreferrer" href={pending.result.explorerUrl}>View transaction</a>
              </p>
            )}

            <Button className="w-full" onClick={propose} disabled={!publicKey || pending.busy || !decimalsReady}>
              {pending.busy ? "Signing…" : publicKey ? "Propose deal" : "Connect wallet to propose"}
            </Button>
          </div>
        </Card>

        <Card>
          <p className="eyebrow">Live terms summary</p>
          <dl className="mt-6 space-y-4 font-mono text-sm">
            <div className="flex justify-between"><dt className="text-orange-50">Borrower receives</dt><dd>{Number(principal || 0).toLocaleString()} {currency}</dd></div>
            <div className="flex justify-between"><dt className="text-orange-50">Total repayment</dt><dd>{summary.total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</dd></div>
            <div className="flex justify-between"><dt className="text-orange-50">Monthly installment</dt><dd>{summary.monthly.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</dd></div>
            <div className="flex justify-between"><dt className="text-orange-50">Collateral required</dt><dd>{collateralBtc || "0"} tBTC</dd></div>
            <div className="flex justify-between"><dt className="text-orange-50">Origination LTV</dt><dd>50.00%</dd></div>
          </dl>
          <p className="mt-6 text-sm leading-6 text-orange-50">
            Terms are immutable once proposed. The counterparty confirms against a hash of these exact terms,
            and collateral locks only after the operator verifies the vault.
          </p>
        </Card>
      </div>
    </AppFrame>
  );
}
