"use client";
import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { Card } from "@/lib/design-system";
import { Button } from "@/lib/design-system";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function KnownLimitationsPage() {
  return (
    <ErrorBoundary>
      <AppFrame eyebrow="Audit Prep — Day 3" title="Known Limitations — Devnet Beta">
        <div className="mt-8 max-w-4xl space-y-6">
          <Card className="p-8">
            <p className="eyebrow">Real Architecture, Devnet Constraints</p>
            <h2 className="mt-2 font-display text-2xl uppercase">What Works — What&apos;s Simulated — What&apos;s Next</h2>
            <p className="mt-4 text-sm leading-7 text-orange-50">
              Persat Finance on Devnet uses the <span className="text-amber font-semibold">real 8-program architecture</span> — same PDAs, same state machine, same authority binding as mainnet. Only mint addresses differ. This page documents intentional devnet simplifications for audit Pass-3 transparency.
            </p>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                <h3 className="font-display text-lg uppercase text-emerald-400">✓ Real — Same as Mainnet</h3>
                <ul className="mt-3 space-y-2 font-mono text-xs text-white/70 list-disc pl-4">
                  <li>8 Anchor programs: governance, price_oracle, asset_whitelist, deal_registry, escrow_vault, loan_lifecycle, liquidation_engine, fee_treasury</li>
                  <li>Deal lifecycle: Proposed → Confirmed → Funding → Active → Repaying/Defaulted → Completed/Cancelled/Closed</li>
                  <li>Terms-hash binding on confirm_deal — prevents stale client binding</li>
                  <li>Vault PDA owns token account — non-custodial at every layer</li>
                  <li>Authority binding: escrow/loan/liquidation authorities recorded in config PDAs, F-1/F-2/F-4 fixed</li>
                  <li>Pyth BTC/USD feed 0xe62df...415b43, staleness 60s, confidence 200bps, Wormhole full verification — fail-closed</li>
                  <li>Bridge health 3 signals: pause/status, successRate, liquidity — manual fallback if missing</li>
                  <li>Marketplace structured terms only — no free-text, verified by script</li>
                  <li>Origination fee 2% both paths, 5% cap, governance-adjustable</li>
                  <li>Full dispenser pack: SOL + tBTC + zBTC + BTC + USDC + USDT (stand-in SPL mints on devnet)</li>
                </ul>
              </div>

              <div className="rounded-xl border border-amber/20 bg-amber/5 p-5">
                <h3 className="font-display text-lg uppercase text-amber">⚠ Simulated / Devnet-Only</h3>
                <ul className="mt-3 space-y-2 font-mono text-xs text-white/70 list-disc pl-4">
                  <li><span className="text-white">Stand-in mints:</span> Devnet has no canonical tBTC/zBTC/USDC faucet — we mint our own SPL tokens with matching decimals (8 for BTC, 6 for stables). Mainnet swap = change 4 addresses only.</li>
                  <li><span className="text-white">BTC alias:</span> MINTS.BTC = MINTS.tBTC (79AL...) for UX — same ATA, same vault, just displayed as BTC in some places. Real mainnet tBTC and zBTC will be distinct.</li>
                  <li><span className="text-white">Operator = gov signer 1:</span> Devnet MVP: 99QG...aAD signs lock_vault, begin_funding, mark_active, close_deal, release_collateral, seize_collateral, mark_liquidated, record_origination_fee. Mainnet: dedicated keeper controlled by 2-of-3 multisig.</li>
                  <li><span className="text-white">Pyth price_update:</span> On devnet, liquidation_engine evaluate requires a PriceUpdateV2 account posted via Hermes. For Day 2 simulation, keeper page also offers direct seize path that works without price_update — shows failure UX polished, then fallback.</li>
                  <li><span className="text-white">Bridge widgets:</span> Threshold/Zeus embedded widgets are simulated on devnet — real Bitcoin lock/mint happens on mainnet via their SDKs. Health check currently uses RPC + env presence, not live Threshold API.</li>
                  <li><span className="text-white">USDC/USDT = $1:</span> MVP simplification documented — no de-peg detection. Post-MVP hardening adds oracle for stable de-peg.</li>
                  <li><span className="text-white">Keeper auto:</span> Backend keeper is stub logging ticks — frontend keeper page has autonomous mode that polls and auto-progresses for demo. Production keeper runs off-chain with dedicated key and full transaction signing.</li>
                  <li><span className="text-white">Faucet cooldown:</span> 24h cooldown enforced via backend DB (faucet_claims) + client bundle mint. Public devnet RPC rate-limited 100/10s — provision Helius/QuickNode for continuous load.</li>
                </ul>
              </div>
            </div>

            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h3 className="font-display text-lg uppercase text-white">Day 2 — Liquidation & Default Verification</h3>
              <p className="mt-2 font-mono text-xs text-white/60">Executed live on Devnet, transaction signatures recorded for audit Pass-3:</p>
              <ul className="mt-3 space-y-1.5 font-mono text-xs text-white/70 list-decimal pl-5">
                <li>flagDefault — anyone can report overdue past grace window (SECONDS_PER_MONTH + GRACE_PERIOD_SECONDS). State check grants authority, not identity.</li>
                <li>Partial seizure — operator seizes 50% collateral via escrow_vault::seize_collateral, loan continues, LTV increases, warning banner at 70%.</li>
                <li>Full liquidation — operator seizes 100% collateral, repays lender, returns surplus, mark_liquidated(fully=true), closeDeal(FullyLiquidated).</li>
                <li>closeDeal — Completed, PartiallyLiquidated, FullyLiquidated outcomes, bound to loan/liquidation authority, builds marketplace reputation signal.</li>
                <li>Reload-safe state machines — /deal/[id]/manage and /deal/[id]/repay fetch deal, vault, loan on mount + 10s poll + hidden-tab backoff, no localStorage loss, error + retry + faucet suggestion.</li>
                <li>Failure UX polished — errors show friendly message + explorer link on success + faucet + reload, never crash, ErrorBoundary at layout + per-route.</li>
                <li>Keeper autonomous — frontend keeper page has auto-mode toggle polling 15s, auto-progresses lock→funding→active→release→close + liquidation on LTV breach using live BTC price from Pyth.</li>
              </ul>
            </div>

            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h3 className="font-display text-lg uppercase text-white">Day 3 Prep — Next Steps</h3>
              <ul className="mt-3 space-y-1.5 font-mono text-xs text-white/60 list-disc pl-5">
                <li>10 scripted lifecycle cycles as audit Pass-3 evidence — see scripts/day2-liquidation-sim.mjs and upcoming scripts/day3-lifecycle-cycles.mjs, each with tx signatures + cluster.</li>
                <li>Netlify deployment for waitlist + frontend — netlify.toml already present, needs env NEXT_PUBLIC_SOLANA_RPC_URL, NEXT_PUBLIC_BACKEND_URL.</li>
                <li>Load testing under pump — 100 concurrent users, verify rate limiting, caching, pagination cap 100, no crash.</li>
                <li>External audit scoping after Pass-3/4 clean.</li>
              </ul>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/keeper"><Button>Open Keeper Console →</Button></Link>
              <Link href="/faucet"><Button variant="secondary">Faucet — Full Pack</Button></Link>
              <Link href="/marketplace"><Button variant="secondary">Marketplace — Live</Button></Link>
            </div>

            <p className="mt-6 font-mono text-[11px] text-white/30">Fonts: Inter + Plus Jakarta Sans + system-ui — Phantom-style crisp antialiased, no OTF, no dramatic fonts, frosted glass cards.</p>
          </Card>
        </div>
      </AppFrame>
    </ErrorBoundary>
  );
}
