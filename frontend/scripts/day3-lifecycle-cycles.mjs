#!/usr/bin/env node
/**
 * Persat Finance — Day 3: 10 Scripted Lifecycle Cycles for Audit Pass-3 Evidence
 * Each cycle documents full on-chain flow with tx signatures, cluster, outcome.
 *
 * Required scenarios per testing-strategy.md:
 * - 10 private lifecycle cycles (direct deal path)
 * - 10 marketplace lifecycle cycles (post, propose, accept, fund, repay)
 * - private-link reuse attempt
 * - terms-mismatch proposal resolution
 * - missed payment/default
 * - partial liquidation
 * - full liquidation
 * - stale oracle rejection
 * - emergency pause
 * - manual bridge fallback
 *
 * For Day 2 we prepare the structure; Day 3 execution will fill tx signatures live on devnet.
 */

const cycles = [
  {
    id: 1,
    path: "private",
    description: "Direct deal — borrower creates, lender confirms, full repayment, collateral released, completed",
    steps: ["propose_deal Private borrower", "confirm_deal lender", "initializeVault", "depositCollateral", "lockVault operator", "beginFunding operator", "activateLoan lender", "markActive operator", "makePayment x12", "releaseCollateral operator", "closeDeal Completed operator"],
    outcome: "completed",
  },
  {
    id: 2,
    path: "private",
    description: "Direct deal — lender creates, borrower confirms, repay in full early",
    steps: ["propose_deal Private lender", "confirm_deal borrower", "initializeVault", "depositCollateral", "lockVault", "beginFunding", "activateLoan", "markActive", "repayInFull", "releaseCollateral", "closeDeal Completed"],
    outcome: "completed",
  },
  {
    id: 3,
    path: "marketplace",
    description: "Marketplace — borrow listing, lend proposal exact match, confirm existing, fund, repay",
    steps: ["propose_deal Public borrow", "proposal exact match lender", "confirm_deal existing", "initializeVault", "depositCollateral", "lockVault", "beginFunding", "activateLoan", "markActive", "makePayment", "repayInFull", "releaseCollateral", "closeDeal Completed"],
    outcome: "completed",
  },
  {
    id: 4,
    path: "marketplace",
    description: "Marketplace — lend listing, borrow proposal counter-offer, supersede with new private deal",
    steps: ["propose_deal Public lend", "proposal counter-offer borrow (different rate)", "cancel_deal original", "propose_deal Private new bound", "initializeVault", "depositCollateral", "lockVault", "beginFunding", "activateLoan", "markActive", "makePayment", "closeDeal Completed"],
    outcome: "completed",
  },
  {
    id: 5,
    path: "private",
    description: "Missed payment — flagDefault, partial liquidation 50%, loan continues, then full repayment",
    steps: ["propose_deal", "confirm_deal", "initializeVault", "depositCollateral", "lockVault", "beginFunding", "activateLoan", "markActive", "miss payment past grace", "flagDefault anyone", "evaluate partial", "seizeCollateral 50% operator", "markLiquidated partially", "makePayment cure", "repayInFull", "releaseCollateral", "closeDeal Completed"],
    outcome: "completed after partial",
  },
  {
    id: 6,
    path: "private",
    description: "Full liquidation — LTV breach 80% simulated, full seizure, surplus returned, fully liquidated",
    steps: ["propose_deal", "confirm_deal", "initializeVault", "depositCollateral", "lockVault", "beginFunding", "activateLoan", "markActive", "simulate BTC price drop LTV 85%", "evaluate full", "seizeCollateral 100% operator", "markLiquidated fully", "closeDeal FullyLiquidated"],
    outcome: "fully_liquidated",
  },
  {
    id: 7,
    path: "private",
    description: "Private-link reuse attempt — single-use enforcement",
    steps: ["propose_deal Private open", "create deal_link via backend", "claim deal_link wallet A -> success", "attempt reuse claim wallet B -> 410 Gone", "verify on-chain borrower bound to A only"],
    outcome: "reuse blocked",
  },
  {
    id: 8,
    path: "marketplace",
    description: "Terms-mismatch proposal resolution — 1 bps difference is counter-offer not match",
    steps: ["propose_deal Public 1000 USDC 800 bps", "proposal 1000 USDC 801 bps -> differingFields [rateBps]", "resolveProposal -> supersede_with_private_deal", "new private deal created bound to both wallets"],
    outcome: "superseded",
  },
  {
    id: 9,
    path: "private",
    description: "Stale oracle rejection — price-dependent actions fail closed",
    steps: ["propose_deal", "confirm_deal", "initializeVault", "depositCollateral", "lockVault", "beginFunding", "activateLoan", "markActive", "wait 70s no Hermes update", "attempt evaluate_position -> StalePrice error", "attempt execute_partial_liquidation -> StalePrice error", "verify fail-closed, no collateral moved"],
    outcome: "fail-closed verified",
  },
  {
    id: 10,
    path: "private",
    description: "Emergency pause + manual bridge fallback",
    steps: ["propose_deal", "confirm_deal", "initializeVault", "governance emergencyPause -> engine.paused=true", "attempt evaluate -> EnginePaused error", "emergencyUnpause -> paused=false", "bridge health unavailable -> mode fail_closed -> manual selector shown", "deposit via manual tBTC", "continue to completed"],
    outcome: "pause + fallback verified",
  },
];

console.log(`\n=== Persat Finance — Day 3: 10 Lifecycle Cycles (Audit Pass-3 Evidence Template) ===\n`);
console.log(`Cluster: devnet`);
console.log(`Programs: ${Object.entries({ governance: "gSCWC42bnn8XbRNXt7FdoGPGqG5dkfMihqYj8xhGwuj", price_oracle: "8udyx5YywfH7KTk6WyaECzaqenyni4JQrWpF5y774qgc", asset_whitelist: "F9m5MaeNeLurf1A3fuwL9EEP6ZNJ6e46UqnW26LvjqSe", deal_registry: "2jGypEsuyB31ZFUfgLvLLEEAJHdWdMoVimeWWTrzGks2", escrow_vault: "ETZyNBxrn43GApFkiAwfEimzWC93P7nEdSQMcT8Snmy3", loan_lifecycle: "HLsDiU1oABybsQhXxnodvoG9tngwTDZGeKwMG5i9Lo3p", liquidation_engine: "C2nL9d8EyyeEz5XQiJVLACMjN9S8GVBvxV9FQ65VTtUx", fee_treasury: "Gnq8qb2Rmnua296VcQ7KHZsuav5ZnWTsP39xCYv8aK5V" }).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);

cycles.forEach((c) => {
  console.log(`\n--- Cycle ${c.id}: ${c.path.toUpperCase()} — ${c.outcome.toUpperCase()} ---`);
  console.log(`Description: ${c.description}`);
  console.log(`Steps:`);
  c.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log(`\nEvidence required (to be filled live Day 3):`);
  console.log(`  - Deal ID (16 bytes hex + base64url): ________`);
  console.log(`  - Tx signatures:`);
  c.steps.forEach((s) => console.log(`    - ${s}: https://explorer.solana.com/tx/<sig>?cluster=devnet`));
  console.log(`  - Outcome: ${c.outcome}`);
  console.log(`  - Logs: security-audits/pass-3/cycle-${c.id}.json`);
});

console.log(`\n--- Full Pack Dispenser Verification ---\n`);
console.log(`
Each cycle must start with full pack dispenser:
- SOL: 0.5 SOL for gas
- tBTC: 0.1 tBTC (Threshold, 8 decimals, mint 79AL...)
- zBTC: 0.1 zBTC (Zeus, 8 decimals, mint DqQ1...)
- BTC: 0.1 BTC alias (same as tBTC mint, for UX)
- USDC: 5000 USDC (6 decimals, mint FsSP...)
- USDT: 5000 USDT (6 decimals, mint 8zdn...)

Single atomic tx, ATA creation idempotent, 24h cooldown via backend faucet_claims table.
UI: /faucet page, bundle persat-devnet-keypairs-KEEP-SECRET.json, auto-fund toggle.
`);

console.log(`\n--- Netlify Deployment Prep ---\n`);
console.log(`
Frontend: frontend/netlify.toml
[build]
  command = "npm ci && npm run build"
  publish = ".next"

[build.environment]
  NEXT_PUBLIC_SOLANA_RPC_URL = "https://api.devnet.solana.com"
  NEXT_PUBLIC_BACKEND_URL = "https://api.persat.finance"
  NEXT_PUBLIC_APP_URL = "https://persat.finance"

[[headers]]
  for = "/*"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"

Waitlist: waitlist/netlify.toml already exists with Supabase proxy.

Day 3 will deploy both to Netlify with envs.
`);

console.log(`\n=== Ready for Day 3 Execution — 10 Cycles ===\n`);
