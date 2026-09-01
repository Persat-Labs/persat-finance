#!/usr/bin/env node
/**
 * Safe env check — prints KEY NAMES and whether they are set.
 * Never prints secret values. Run from backend/:
 *   node scripts/check-env.mjs
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, "..");
const repoRoot = resolve(backendRoot, "..");

for (const p of [
  resolve(backendRoot, ".env"),
  resolve(backendRoot, ".env.local"),
  resolve(repoRoot, ".env"),
  resolve(repoRoot, ".env.local"),
]) {
  if (existsSync(p)) {
    loadDotenv({ path: p, override: false });
    console.log(`loaded: ${p}`);
  }
}

const keys = [
  "PORT",
  "NODE_ENV",
  "SOLANA_CLUSTER",
  "SOLANA_RPC_URL",
  "PERSAT_DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_BACKEND_URL",
  "NEXT_PUBLIC_SOLANA_RPC_URL",
  "CORS_ORIGINS",
  "PERSAT_DEPLOYER_KEYPAIR",
  "KEEPER_ENABLED",
  "KEEPER_KEYPAIR_PATH",
  "ADMIN_API_KEY",
  "ZEUS_API_KEY",
  "THRESHOLD_API_KEY",
];

console.log("\nEnv status (values hidden):\n");
for (const k of keys) {
  const v = process.env[k];
  if (v === undefined || v === "") {
    console.log(`  ${k}=<missing>`);
  } else {
    const hint =
      k.includes("URL") && v.includes("://")
        ? `set (${v.split("://")[0]}://…, len=${v.length})`
        : k.includes("KEYPAIR") || k.includes("KEY") || k.includes("PASS")
          ? `set (len=${v.length})`
          : `set`;
    console.log(`  ${k}=${hint}`);
  }
}

const db = process.env.PERSAT_DATABASE_URL;
if (!db) {
  console.log("\n→ Database: NOT configured (sessions stay in memory)");
} else if (db.includes("user:pass@") || db.includes("PASSWORD") || db.includes("...")) {
  console.log("\n→ Database: URL looks like a PLACEHOLDER — replace with real credentials");
} else {
  console.log("\n→ Database: URL present — restart API and curl /health for database:ok");
}
