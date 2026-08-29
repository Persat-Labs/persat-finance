/**
 * Keeper service — devnet MVP operator loop.
 * The programs have no CPI, so operator wallet signs state transitions.
 * This is a stub that logs what it would do; full implementation needs
 * deployer keypair and RPC to fetch active deals and drive them.
 *
 * Production: replace with dedicated keeper key controlled by gov multisig,
 * poll DealRegistry for Funding/Active/Defaulted, call lock_vault, begin_funding,
 * mark_active, flag_default, evaluate_position, seize, mark_liquidated, close, release.
 */

import { config } from "../config.js";

let interval: NodeJS.Timeout | null = null;
let running = false;

export function startKeeper() {
  if (!config.keeperEnabled) {
    console.log("[keeper] Disabled — set KEEPER_ENABLED or KEEPER_KEYPAIR_PATH to enable");
    return;
  }
  if (running) return;
  running = true;

  const pollMs = config.keeperPollSeconds * 1000;
  console.log(`[keeper] Starting — poll every ${config.keeperPollSeconds}s, cluster=${config.cluster}`);

  interval = setInterval(async () => {
    try {
      // In full version:
      // 1. Fetch all deals in Funding state -> check vault collateral >= required -> lock_vault + begin_funding
      // 2. Fetch Active -> check payment due -> if overdue past grace -> flag_default
      // 3. Fetch Active/Defaulted -> evaluate_position via Pyth price -> if LTV > 70% partial, >80% full -> seize + mark_liquidated
      // 4. Fetch Completed -> release_collateral + close_deal
      // All with idempotency, retry, and logging tx sigs.

      // For now, log liveness
      console.log(`[keeper] Tick ${new Date().toISOString()} — would process active deals (stub)`);
    } catch (err) {
      console.error("[keeper] Tick failed", (err as Error).message);
    }
  }, pollMs);

  // Unref so it doesn't block shutdown
  if (interval && typeof (interval as any).unref === "function") (interval as any).unref();
}

export function stopKeeper() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  running = false;
}
