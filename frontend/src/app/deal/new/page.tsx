"use client";
import { useMemo, useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input } from "@/lib/design-system";
import { MINTS } from "@/lib/protocol/config";
import { dealPda } from "@/lib/protocol/pdas";
import { proposeDeal, Side, Visibility } from "@/lib/protocol/instructions";
import { dealIdToUrl, randomDealId, useProtocol } from "@/lib/protocol/hooks";
import { PublicKey } from "@solana/web3.js";
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
  const [publishMode, setPublishMode] = useState<"marketplace" | "private">("marketplace");
  const [counterparty, setCounterparty] = useState("");
  const [counterpartyError, setCounterpartyError] = useState("");
  const [fundingOpen, setFundingOpen] = useState(false);
  const [showBridgeInfo, setShowBridgeInfo] = useState(false);
  const [confirmedDealUrlId, setConfirmedDealUrlId] = useState<string | null>(null);
  const [collateralType, setCollateralType] = useState<"BTC" | "tBTC" | "zBTC">("BTC");

  const months = durationChoice === "custom" ? Math.max(1, Number(customMonths) || 1) : Number(durationChoice);
  const loanMint = MINTS[currency];
  const collateralMint = collateralType === "BTC" ? MINTS.tBTC : MINTS[collateralType];
  const decimalsReady = Boolean(loanMint && collateralMint);

  const summary = useMemo(() => {
    const principalNum = Number(principal) || 0;
    const rate = (Number(rateBps) || 0) / 10_000;
    const total = principalNum * (1 + (rate * months) / 12);
    return { total, monthly: months > 0 ? total / months : 0 };
  }, [principal, rateBps, months]);

  async function propose() {
    setCounterpartyError("");
    if (!publicKey || !loanMint || !collateralMint) return;

    let counterpartyKey: PublicKey | null = null;
    if (publishMode === "private") {
      const rawInput = counterparty.trim();
      if (!rawInput) {
        setCounterpartyError("Private deal requires a counterparty handle or wallet address.");
        return;
      }
      const cleanHandle = rawInput.replace(/^@/, "");
      const prof = getProfileByWalletOrUsername(cleanHandle);
      if (prof?.wallet) {
        try {
          counterpartyKey = new PublicKey(prof.wallet);
        } catch {
          setCounterpartyError(`Resolved address for @${cleanHandle} is invalid.`);
          return;
        }
      } else {
        try {
          counterpartyKey = new PublicKey(rawInput);
        } catch {
          setCounterpartyError(`"${rawInput}" is not a recognized handle or valid 32–44 character Solana address.`);
          return;
        }
      }
    }

    const dealId = randomDealId();
    const result = await send([
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

    if (result?.ok) {
      const urlId = dealIdToUrl(dealId);
      if (!counterpartyKey) {
        const myProfile = getProfileByWalletOrUsername(publicKey.toBase58());
        const handle = myProfile ? myProfile.username : `user_${publicKey.toBase58().slice(0, 4)}`;
        saveListing({
          source: "client" as const,
          id: `list_${urlId}`,
          dealId: Array.from(dealId)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
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
      setConfirmedDealUrlId(urlId);
      if (typeof window !== "undefined") window.location.href = `/deal/${urlId}`;
    }
  }

  return (
    <AppFrame eyebrow="Direct Deal" title="Propose a Loan">
      {confirmedDealUrlId ? (
        <div className="mt-8 mx-auto max-w-xl rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-8 text-center space-y-5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 text-3xl font-bold">✓</div>
          <h2 className="font-display text-3xl font-bold uppercase text-white">Deal Confirmed On Solana Devnet!</h2>
          <p className="text-sm text-white/80 leading-6">Your loan terms are registered on-chain. Opening your deal workspace…</p>
          <a href={`/deal/${confirmedDealUrlId}`} className="inline-block w-full">
            <Button className="w-full py-4 text-xs">Open Deal Workspace Now →</Button>
          </a>
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_.9fr] pb-32 md:pb-10">
          {/* Mobile live strip — always above the fold */}
          <div className="lg:hidden col-span-full rounded-2xl border border-amber/25 bg-amber/5 p-4 font-mono text-xs text-white/80">
            <p className="eyebrow mb-2">Live Calculation</p>
            <div className="grid grid-cols-2 gap-2">
              <span>
                Receives <strong className="text-white">{Number(principal || 0).toLocaleString()} {currency}</strong>
              </span>
              <span>
                Repay <strong className="text-amber">{summary.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
              </span>
              <span>
                Collateral <strong className="text-white">{collateralBtc || "0"} BTC</strong>
              </span>
              <span>
                Term <strong className="text-white">{months} mo</strong>
              </span>
            </div>
          </div>

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
                  <Input id="principal" type="number" min="1" value={principal} onChange={(e) => setPrincipal(e.target.value)} className="flex-1" />
                  {(["USDC", "USDT"] as const).map((mint) => (
                    <button
                      type="button"
                      key={mint}
                      onClick={() => setCurrency(mint)}
                      className={`min-h-12 shrink-0 rounded-xl border px-5 font-mono text-xs transition-all ${
                        currency === mint ? "border-amber bg-amber/15 text-white" : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
                      }`}
                    >
                      {mint}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="eyebrow block" htmlFor="collateral">
                      Collateral: {collateralType} {collateralType === "BTC" ? "(auto → best bridge)" : "(manual)"}
                    </label>
                    <button type="button" onClick={() => setShowBridgeInfo(!showBridgeInfo)} className="font-mono text-[10px] text-amber hover:underline">
                      {showBridgeInfo ? "Hide Bridge" : "Bridge: Auto Live ▾"}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Input id="collateral" type="number" step="0.00000001" min="0.00000001" value={collateralBtc} onChange={(e) => setCollateralBtc(e.target.value)} className="flex-1" />
                    <div className="flex gap-1">
                      {(["BTC", "tBTC", "zBTC"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setCollateralType(t)}
                          className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] ${collateralType === t ? "border-amber bg-amber/15 text-white" : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white"}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-white/40">
                    {collateralType === "BTC"
                      ? "Default: deposit BTC → auto converts to tBTC/zBTC via live health (pause/status, success rate, liquidity)"
                      : `Manual: you already have ${collateralType}, deposit directly`}
                  </p>
                  {showBridgeInfo && (
                    <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] p-2.5 font-mono text-[11px] text-white/60 space-y-1">
                      <p className="text-white font-semibold">
                        Auto-Routed: {collateralType === "BTC" ? "Best bridge via live checker → tBTC/zBTC" : `${collateralType} direct`}
                      </p>
                      <p className="text-[10px] text-white/40">Health: 3 signals — pause/status, success rate &gt;80%, liquidity &gt;$10k — fail-closed</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="eyebrow mb-2 block" htmlFor="rate">
                    Annual Rate (basis points)
                  </label>
                  <div className="relative">
                    <Input id="rate" type="number" min="1" max="10000" value={rateBps} onChange={(e) => setRateBps(e.target.value)} />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-white/40">{(Number(rateBps || 0) / 100).toFixed(2)}%</span>
                  </div>
                </div>
              </div>

              <fieldset>
                <legend className="eyebrow mb-3">Duration</legend>
                <div className="grid grid-cols-4 gap-2">
                  {(["6", "12", "24"] as const).map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => setDurationChoice(m)}
                      className={`min-h-12 rounded-xl border font-mono text-xs transition-all ${
                        durationChoice === m ? "border-amber bg-amber/15 text-white" : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
                      }`}
                    >
                      {m} mo
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDurationChoice("custom")}
                    className={`min-h-12 rounded-xl border font-mono text-xs transition-all ${
                      durationChoice === "custom" ? "border-amber bg-amber/15 text-white" : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
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
                    <Input id="customMonths" type="number" min="1" max="60" value={customMonths} onChange={(e) => setCustomMonths(e.target.value)} placeholder="e.g. 18" />
                  </div>
                )}
              </fieldset>

              {/* Publish toggle — marketplace vs private */}
              <div className="space-y-3">
                <label className="eyebrow mb-2 block">Where should this deal go?</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPublishMode("marketplace")}
                    className={`rounded-xl border p-3 text-left transition ${publishMode === "marketplace" ? "border-amber bg-amber/15 text-white" : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white hover:border-white/20"}`}
                  >
                    <p className="font-mono text-xs font-bold uppercase">Publish to Marketplace</p>
                    <p className="mt-1 font-mono text-[10px] text-white/40">Open public listing — anyone can fulfill. Appears on Marketplace.</p>
                    {publishMode === "marketplace" && <p className="mt-1 font-mono text-[10px] text-amber">● Selected</p>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPublishMode("private")}
                    className={`rounded-xl border p-3 text-left transition ${publishMode === "private" ? "border-amber bg-amber/15 text-white" : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white hover:border-white/20"}`}
                  >
                    <p className="font-mono text-xs font-bold uppercase">Send to Handle / Wallet Only</p>
                    <p className="mt-1 font-mono text-[10px] text-white/40">Private — only the attached @handle or wallet. Not listed publicly.</p>
                    {publishMode === "private" && <p className="mt-1 font-mono text-[10px] text-amber">● Selected</p>}
                  </button>
                </div>

                {publishMode === "private" ? (
                  <div>
                    <label className="eyebrow mb-2 block" htmlFor="counterparty">
                      Counterparty Handle or Wallet Address (Required)
                    </label>
                    <Input
                      id="counterparty"
                      value={counterparty}
                      onChange={(e) => {
                        setCounterparty(e.target.value);
                        setCounterpartyError("");
                      }}
                      placeholder="e.g. @persattest1 or Solana pubkey"
                      className={counterpartyError ? "border-red-500/60 focus:border-red-500" : ""}
                    />
                    {counterpartyError ? (
                      <p className="mt-1.5 font-mono text-[11px] text-red-400">{counterpartyError}</p>
                    ) : (
                      <p className="mt-1 font-mono text-[10px] text-white/40">Accepts @username or 32–44 char Solana pubkey</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 font-mono text-[11px] text-white/60">
                    <p className="text-emerald-400 font-semibold">Marketplace mode</p>
                    <p>Real on-chain listing only — no demo deals. Watch it on /deals for earnings & due date.</p>
                  </div>
                )}
              </div>

              {pending.result && !pending.result.ok && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 space-y-2 text-xs text-orange-50">
                  <p>{pending.result.failure.message}</p>
                  <button type="button" onClick={() => setFundingOpen(true)} className="rounded-full border border-amber/50 bg-amber/15 px-3 py-1 font-mono text-[11px] text-amber">
                    ⚡ Need Test Funds?
                  </button>
                </div>
              )}

              <Button className="w-full py-4 text-xs" onClick={propose} disabled={!publicKey || pending.busy || !decimalsReady}>
                {pending.busy ? "Confirm in Phantom Wallet…" : publicKey ? "Propose Deal On-Chain" : "Connect Wallet to Propose"}
              </Button>
            </div>
          </Card>

          {/* Desktop live calculation sidebar */}
          <div className="hidden lg:block space-y-6">
            <Card>
              <p className="eyebrow">Cryptographic Terms Summary</p>
              <h2 className="mt-1 font-display text-2xl uppercase text-white font-bold">Live Calculation</h2>
              <dl className="mt-6 space-y-4 font-mono text-sm">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <dt className="text-white/60">Borrower receives</dt>
                  <dd className="font-semibold text-white">
                    {Number(principal || 0).toLocaleString()} {currency}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <dt className="text-white/60">Total repayment</dt>
                  <dd className="font-semibold text-amber">{summary.total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</dd>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <dt className="text-white/60">Monthly installment</dt>
                  <dd className="text-white/90">{summary.monthly.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</dd>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <dt className="text-white/60">Collateral required</dt>
                  <dd className="font-semibold text-white">{collateralBtc || "0"} BTC</dd>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <dt className="text-white/60">Duration</dt>
                  <dd className="text-white/90">{months} months</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-white/60">Origination LTV</dt>
                  <dd className="text-emerald-400 font-semibold">50.00% (Overcollateralized)</dd>
                </div>
              </dl>
              <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs leading-6 text-white/60">
                <p>
                  <strong className="text-white">Seamless Verification:</strong> After confirming in Phantom you go straight to the deal workspace to deposit collateral and share the private link.
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}

      <FundWalletModal open={fundingOpen} onClose={() => setFundingOpen(false)} reason="Fund your wallet with Devnet SOL and test tokens to propose on-chain." />
    </AppFrame>
  );
}
