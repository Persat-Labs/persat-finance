"use client";
import { useMemo, useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input } from "@/lib/design-system";
import { MINTS } from "@/lib/protocol/config";
import { dealPda } from "@/lib/protocol/pdas";
import { proposeDeal, Side, Visibility } from "@/lib/protocol/instructions";
import { dealIdToUrl, randomDealId, useProtocol } from "@/lib/protocol/hooks";
import { PublicKey } from "@solana/web3.js";
import { DealShareModal } from "@/components/deal/DealShareModal";
import { saveListing } from "@/lib/marketplace/marketplaceStore";
import { getProfileByWalletOrUsername } from "@/lib/profile/userProfile";
import { FundWalletModal } from "@/components/wallet/FundWalletModal";

export default function NewDealPage() {
  const { publicKey, send, pending } = useProtocol();
  const [side, setSide] = useState<"borrower" | "lender">("borrower");
  const [currency, setCurrency] = useState<"USDC" | "USDT">("USDC");
  const [principal, setPrincipal] = useState("1000");
  const [rateBps, setRateBps] = useState("820");
  const [durationChoice, setDurationChoice] = useState<"6" | "12" | "24" | "custom">("12");
  const [customMonths, setCustomMonths] = useState("18");
  const [collateralBtc, setCollateralBtc] = useState("0.05");
  const [counterparty, setCounterparty] = useState("");
  const [createdDeal, setCreatedDeal] = useState<{ dealUrlId: string; signature?: string } | null>(null);
  const [fundingOpen, setFundingOpen] = useState(false);

  const months = durationChoice === "custom" ? Math.max(1, Number(customMonths) || 1) : Number(durationChoice);

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
      try {
        counterpartyKey = new PublicKey(counterparty.trim());
      } catch {
        return;
      }
    }
    await send([
      proposeDeal({
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
      }),
    ]);

    const urlId = dealIdToUrl(dealId);

    // If public deal (no counterparty), publish to live marketplace
    if (!counterpartyKey) {
      const myProfile = getProfileByWalletOrUsername(publicKey.toBase58());
      const handle = myProfile ? myProfile.username : `user_${publicKey.toBase58().slice(0, 4)}`;
      saveListing({
        id: `list_${urlId}`,
        dealId: Buffer.from(dealId).toString("hex"),
        creatorWallet: publicKey.toBase58(),
        creatorHandle: handle,
        side: side === "borrower" ? "borrow" : "lend",
        principal: Number(principal).toLocaleString(),
        currency,
        rateBps: Number(rateBps) || 0,
        months,
        collateralBtc,
        reputation: myProfile?.reputationScore ?? 100,
        dealUrlId: urlId,
        createdAt: Date.now(),
      });
    }

    setCreatedDeal({ dealUrlId: urlId });
  }

  return (
    <AppFrame eyebrow="Direct Deal" title="Propose a Loan">
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <Card>
          <div className="space-y-6">
            <fieldset>
              <legend className="eyebrow mb-3">I am the</legend>
              <div className="grid grid-cols-2 gap-3">
                {(["borrower", "lender"] as const).map((role) => (
                  <button
                    type="button"
                    key={role}
                    onClick={() => setSide(role)}
                    className={`min-h-12 rounded-full border font-mono text-xs uppercase tracking-wider transition-all ${
                      side === role
                        ? "border-amber bg-amber/15 text-white shadow-[0_0_15px_rgba(255,171,0,0.25)]"
                        : "border-white/10 bg-white/[0.02] text-white/60 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {role === "borrower" ? "Borrower (Post BTC)" : "Lender (Fund USDC)"}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label className="eyebrow mb-2 block" htmlFor="principal">
                Loan Amount
              </label>
              <div className="flex gap-2">
                <Input
                  id="principal"
                  type="number"
                  min="1"
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                  className="flex-1"
                />
                {(["USDC", "USDT"] as const).map((mint) => (
                  <button
                    type="button"
                    key={mint}
                    onClick={() => setCurrency(mint)}
                    className={`min-h-12 shrink-0 rounded-xl border px-5 font-mono text-xs transition-all ${
                      currency === mint
                        ? "border-amber bg-amber/15 text-white"
                        : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
                    }`}
                  >
                    {mint}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="eyebrow mb-2 block" htmlFor="collateral">
                  Collateral (tBTC)
                </label>
                <Input
                  id="collateral"
                  type="number"
                  step="0.00000001"
                  min="0.00000001"
                  value={collateralBtc}
                  onChange={(e) => setCollateralBtc(e.target.value)}
                />
              </div>
              <div>
                <label className="eyebrow mb-2 block" htmlFor="rate">
                  Annual Rate (basis points)
                </label>
                <div className="relative">
                  <Input
                    id="rate"
                    type="number"
                    min="1"
                    max="10000"
                    value={rateBps}
                    onChange={(e) => setRateBps(e.target.value)}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-white/40">
                    {(Number(rateBps || 0) / 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Duration with Custom Option */}
            <fieldset>
              <legend className="eyebrow mb-3">Duration</legend>
              <div className="grid grid-cols-4 gap-2">
                {(["6", "12", "24"] as const).map((m) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => setDurationChoice(m)}
                    className={`min-h-12 rounded-xl border font-mono text-xs transition-all ${
                      durationChoice === m
                        ? "border-amber bg-amber/15 text-white"
                        : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
                    }`}
                  >
                    {m} mo
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDurationChoice("custom")}
                  className={`min-h-12 rounded-xl border font-mono text-xs transition-all ${
                    durationChoice === "custom"
                      ? "border-amber bg-amber/15 text-white"
                      : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
                  }`}
                >
                  Custom
                </button>
              </div>

              {durationChoice === "custom" && (
                <div className="mt-3">
                  <label className="eyebrow mb-1.5 block text-[11px]" htmlFor="customMonths">
                    Custom Term (months)
                  </label>
                  <Input
                    id="customMonths"
                    type="number"
                    min="1"
                    max="60"
                    value={customMonths}
                    onChange={(e) => setCustomMonths(e.target.value)}
                    placeholder="Enter number of months (e.g. 18)"
                  />
                </div>
              )}
            </fieldset>

            <div>
              <label className="eyebrow mb-2 block" htmlFor="counterparty">
                Counterparty Wallet or Handle (Optional)
              </label>
              <Input
                id="counterparty"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value.trim())}
                placeholder="Leave blank for a public marketplace deal, or paste wallet address"
              />
            </div>

            {!decimalsReady && (
              <p role="status" className="rounded-xl border border-amber/30 bg-amber/5 p-3 text-xs leading-6 text-orange-50">
                Stand-in mints are loading from Devnet. Proposing unlocks momentarily.
              </p>
            )}

            {pending.result && !pending.result.ok && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 space-y-2 text-xs text-orange-50">
                <p>{pending.result.failure.message}</p>
                <button
                  type="button"
                  onClick={() => setFundingOpen(true)}
                  className="rounded-full border border-amber/50 bg-amber/15 px-3 py-1 font-mono text-[11px] text-amber hover:bg-amber/25 transition"
                >
                  ⚡ Need Test Funds? Click to Dispense SOL + Tokens
                </button>
              </div>
            )}

            <Button
              className="w-full py-4 text-xs"
              onClick={propose}
              disabled={!publicKey || pending.busy || !decimalsReady}
            >
              {pending.busy ? "Signing On Devnet…" : publicKey ? "Propose Deal On-Chain" : "Connect Wallet to Propose"}
            </Button>
          </div>
        </Card>

        {/* Live Terms Summary Card */}
        <div className="space-y-6">
          <Card>
            <p className="eyebrow">Cryptographic Terms Summary</p>
            <h2 className="mt-1 font-display-persat text-2xl uppercase text-white">Live Calculation</h2>
            <dl className="mt-6 space-y-4 font-mono text-sm">
              <div className="flex justify-between border-b border-white/5 pb-2">
                <dt className="text-white/60">Borrower receives</dt>
                <dd className="font-semibold text-white">
                  {Number(principal || 0).toLocaleString()} {currency}
                </dd>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <dt className="text-white/60">Total repayment</dt>
                <dd className="font-semibold text-amber">
                  {summary.total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}
                </dd>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <dt className="text-white/60">Monthly installment</dt>
                <dd className="text-white/90">
                  {summary.monthly.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}
                </dd>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <dt className="text-white/60">Collateral locked</dt>
                <dd className="font-semibold text-white">{collateralBtc || "0"} tBTC</dd>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <dt className="text-white/60">Duration</dt>
                <dd className="text-white/90">{months} months</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Origination LTV</dt>
                <dd className="text-emerald-400">50.00% (Safe Buffer)</dd>
              </div>
            </dl>

            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs leading-6 text-white/60">
              <p>
                <strong className="text-white">Immutable Escrow:</strong> Once proposed, terms cannot be altered. The counterparty verifies against an exact SHA-256 hash before depositing or funding.
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Share & Fulfill Modal */}
      {createdDeal && (
        <DealShareModal
          open={Boolean(createdDeal)}
          onClose={() => setCreatedDeal(null)}
          dealUrlId={createdDeal.dealUrlId}
          principal={principal}
          currency={currency}
          collateralBtc={collateralBtc}
          months={months}
          side={side}
          txSignature={pending.result?.ok ? pending.result.signature : undefined}
        />
      )}

      {/* In-Flow Fund Wallet Modal */}
      <FundWalletModal
        open={fundingOpen}
        onClose={() => setFundingOpen(false)}
        reason="Fund your connected wallet with Devnet SOL and test tokens to propose this deal on-chain."
      />
    </AppFrame>
  );
}
