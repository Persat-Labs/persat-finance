#!/usr/bin/env node
/**
 * Persat Finance — apply a Devnet deployment manifest to repository config.
 *
 * Consumes `ops/handoff/devnet-deployed.json` (written by the deploy
 * workflow's initializer step, also uploaded as the `devnet-deployment`
 * artifact) and fills in every placeholder it can:
 *
 *   1. frontend/src/lib/protocol/config.ts   MINTS.tBTC/.zBTC/.USDC/.USDT
 *   2. contracts/config/devnet.json          assets[*].mint, governance.treasury
 *
 * Idempotent: placeholders already filled are left alone; a mint that already
 * matches is reported as "already applied". No secrets are involved — the
 * manifest contains public keys and transaction signatures only.
 *
 * Usage:
 *   node ops/handoff/apply-manifest.mjs [--manifest path/to/devnet-deployed.json]
 *
 * Defaults to ops/handoff/devnet-deployed.json next to this script.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((arg, index, all) => {
    if (!arg.startsWith("--")) return [arg, true];
    const key = arg.slice(2);
    const next = all[index + 1];
    return next && !next.startsWith("--") ? [key, next] : [key, true];
  }),
);

const manifestPath = args.manifest || `${here}/devnet-deployed.json`;
if (!existsSync(manifestPath)) {
  console.error(`manifest not found: ${manifestPath}`);
  console.error("Download the `devnet-deployment` artifact from the deploy run, or pass --manifest.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!manifest.mints || typeof manifest.mints !== "object") {
  console.error("manifest has no .mints — not a devnet-init manifest?");
  process.exit(1);
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const symbols = ["tBTC", "zBTC", "USDC", "USDT"];
const changes = [];
const skipped = [];

/* 1. Frontend MINTS ------------------------------------------------------ */

const frontendPath = `${here}/../../frontend/src/lib/protocol/config.ts`;
let frontend = readFileSync(frontendPath, "utf8");

for (const symbol of symbols) {
  const mint = manifest.mints[symbol];
  if (!mint || !BASE58.test(mint)) {
    skipped.push(`frontend MINTS.${symbol}: no valid address in manifest`);
    continue;
  }
  const nullRe = new RegExp(`(MINTS[^;]*?\\{[^}]*?${symbol}:\\s*)null(,?)`, "s");
  const filledRe = new RegExp(`(MINTS[^;]*?\\{[^}]*?${symbol}:\\s*)new PublicKey\\("([1-9A-HJ-NP-Za-km-z]{32,44})"\\)(,?)`, "s");
  if (nullRe.test(frontend)) {
    frontend = frontend.replace(nullRe, `$1new PublicKey("${mint}")$2`);
    changes.push(`frontend/src/lib/protocol/config.ts  MINTS.${symbol} = ${mint}`);
  } else {
    const existing = frontend.match(filledRe);
    if (existing && existing[2] === mint) {
      skipped.push(`frontend MINTS.${symbol}: already ${mint}`);
    } else if (existing) {
      console.error(`frontend MINTS.${symbol} holds ${existing[2]} but manifest says ${mint} — resolve by hand.`);
      process.exit(1);
    } else {
      console.error(`could not locate MINTS.${symbol} in ${frontendPath} — layout changed?`);
      process.exit(1);
    }
  }
}

/* 2. contracts/config/devnet.json ---------------------------------------- */

const devnetPath = `${here}/../../contracts/config/devnet.json`;
let devnet = readFileSync(devnetPath, "utf8");

for (const symbol of symbols) {
  const mint = manifest.mints[symbol];
  if (!mint || !BASE58.test(mint)) continue;
  const blockRe = new RegExp(
    `("symbol"\\s*:\\s*"${symbol}"[\\s\\S]{0,400}?"mint"\\s*:\\s*)"(PLACEHOLDER_CREATE_DEVNET_MINT|[^"]*)"`,
  );
  const match = devnet.match(blockRe);
  if (!match) {
    console.error(`could not locate the ${symbol} mint field in contracts/config/devnet.json`);
    process.exit(1);
  }
  if (match[2] === mint) {
    skipped.push(`devnet.json ${symbol} mint: already ${mint}`);
  } else {
    devnet = devnet.replace(blockRe, `$1"${mint}"`);
    changes.push(`contracts/config/devnet.json          assets.${symbol}.mint = ${mint}`);
  }
}

if (manifest.governance?.treasury && BASE58.test(manifest.governance.treasury)) {
  const treasury = manifest.governance.treasury;
  if (devnet.includes("PLACEHOLDER_TREASURY_PUBKEY")) {
    devnet = devnet.replace('"PLACEHOLDER_TREASURY_PUBKEY"', `"${treasury}"`);
    changes.push(`contracts/config/devnet.json          governance.treasury = ${treasury}`);
  } else {
    skipped.push("devnet.json governance.treasury: already filled");
  }
}

/* Validate JSON round-trip before writing anything. */
JSON.parse(devnet);

if (changes.length) {
  writeFileSync(frontendPath, frontend);
  writeFileSync(devnetPath, devnet + (devnet.endsWith("\n") ? "" : "\n"));
}

console.log("Applied changes:");
for (const c of changes) console.log(`  + ${c}`);
if (!changes.length) console.log("  (none — everything already applied)");
for (const s of skipped) console.log(`  = ${s}`);
console.log("\nNext: commit, push, and the faucet + deal flows go live against Devnet.");
