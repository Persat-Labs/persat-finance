/**
 * Keeper service — devnet operator loop scaffolding (B3).
 *
 * Programs have no cross-program CPI for these transitions; an operator wallet
 * signs: lock_vault, begin_funding, mark_active, flag_default, seize_*, 
 * mark_liquidated, release_collateral, close_deal, record_origination_fee.
 *
 * States:
 *  - disabled: default (no env)
 *  - stub: KEEPER_ENABLED=1 without key → liveness ticks only (safe)
 *  - live: KEEPER_KEYPAIR_PATH set → load key, sign (implement fetch+ix next)
 *
 * Production: dedicated keeper key (fee-only), never gov signer long-term;
 * controlled by 2-of-3 governance process. See docs/MAINNET_CUTOVER_3_STEP.md § B3.
 */

import fs from "fs";
import { config } from "../config.js";

let interval: NodeJS.Timeout | null = null;
let running = false;
let tickCount = 0;
let mode: "disabled" | "stub" | "live-ready" = "disabled";

function resolveMode(): typeof mode {
  if (!config.keeperEnabled) return "disabled";
  const keyPath = process.env.KEEPER_KEYPAIR_PATH;
  if (keyPath && fs.existsSync(keyPath)) return "live-ready";
  return "stub";
}

/**
 * Future: load Keypair from KEEPER_KEYPAIR_PATH, Connection from SOLANA_RPC_URL,
 * scan deal PDAs / indexer, build instructions, sign+send, log explorer URLs.
 * Do not implement signing until key path is present and tests cover dry-run.
 */
async function processTick(): Promise<void> {
  tickCount += 1;
  const ts = new Date().toISOString();

  if (mode === "stub") {
    console.log(
      `[keeper] tick=${tickCount} at=${ts} mode=stub cluster=${config.cluster} — no key loaded; would scan Funding/Active/Defaulted`,
    );
    return;
  }

  if (mode === "live-ready") {
    // Key file exists — still no automatic send until deal index + ix builders land.
    // This prevents accidental mainnet-shaped sends from a half-wired loop.
    console.log(
      `[keeper] tick=${tickCount} at=${ts} mode=live-ready cluster=${config.cluster} — key present; deal scan + sign not yet wired (B3 in progress)`,
    );
    // TODO B3: fetch candidates → build ix → sendTransaction → log sig
    return;
  }
}

export function startKeeper() {
  mode = resolveMode();
  if (mode === "disabled") {
    console.log("[keeper] Disabled — set KEEPER_ENABLED=1 and optionally KEEPER_KEYPAIR_PATH");
    return;
  }
  if (running) return;
  running = true;

  const pollMs = config.keeperPollSeconds * 1000;
  console.log(
    `[keeper] Starting mode=${mode} poll=${config.keeperPollSeconds}s cluster=${config.cluster}`,
  );

  void processTick();
  interval = setInterval(() => {
    void processTick();
  }, pollMs);

  if (interval && typeof (interval as NodeJS.Timeout & { unref?: () => void }).unref === "function") {
    (interval as NodeJS.Timeout & { unref: () => void }).unref();
  }
}

export function stopKeeper() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  running = false;
  console.log(`[keeper] Stopped after ${tickCount} ticks`);
}

/** Test/health introspection */
export function getKeeperStatus() {
  return { running, mode, tickCount, cluster: config.cluster, pollSeconds: config.keeperPollSeconds };
}
