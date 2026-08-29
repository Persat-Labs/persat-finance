#!/usr/bin/env node
/**
 * Emit or update Pass-3 cycle evidence markdown from a JSON sig file.
 *
 * Usage:
 *   node frontend/scripts/record-cycle.mjs --template happy --json ./cycle-01.json --out security-audits/pass-3/cycles/cycle-01-happy.md
 *   node frontend/scripts/record-cycle.mjs --template default --json ./cycle-02.json --out security-audits/pass-3/cycles/cycle-02-default.md
 *   node frontend/scripts/record-cycle.mjs --print-sample-json happy
 *
 * JSON shape (public data only — never put key material here):
 * {
 *   "date": "2026-08-29",
 *   "dealIdUrl": "...",
 *   "dealIdHex": "...",
 *   "borrower": "...",
 *   "lender": "...",
 *   "operator": "99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD",
 *   "terms": { "principal": "100 USDC", "collateral": "0.01 tBTC", "rateBps": 800, "durationMonths": 3 },
 *   "steps": [
 *     { "instruction": "propose_deal", "actor": "Borrower", "signature": "<base58 sig>" }
 *   ],
 *   "final": { "deal": "completed", "vault": "released", "loan": "completed" },
 *   "notes": "optional",
 *   "status": "PASS"
 * }
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const args = process.argv.slice(2);
const get = (n) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : null;
};

const template = get("template") || "happy";
const jsonPath = get("json");
const outPath = get("out");
const printSample = args.includes("--print-sample-json");

const explorerTx = (sig) =>
  sig && sig !== "PENDING"
    ? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
    : "https://explorer.solana.com/tx/PENDING?cluster=devnet";

const SAMPLES = {
  happy: {
    date: "YYYY-MM-DD",
    dealIdUrl: "PENDING",
    dealIdHex: "PENDING",
    borrower: "PENDING",
    lender: "PENDING",
    operator: "99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD",
    terms: {
      principal: "100 USDC",
      collateral: "0.01 tBTC",
      rateBps: 800,
      durationMonths: 3,
      loanMint: "FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe",
      collateralMint: "79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg",
    },
    steps: [
      { instruction: "propose_deal", actor: "Borrower", signature: "PENDING" },
      { instruction: "confirm_deal", actor: "Lender", signature: "PENDING" },
      { instruction: "initialize_vault", actor: "Borrower", signature: "PENDING" },
      { instruction: "deposit_collateral", actor: "Borrower", signature: "PENDING" },
      { instruction: "lock_vault", actor: "Operator", signature: "PENDING" },
      { instruction: "begin_funding", actor: "Operator", signature: "PENDING" },
      { instruction: "activate_loan", actor: "Lender", signature: "PENDING" },
      { instruction: "mark_active", actor: "Operator", signature: "PENDING" },
      { instruction: "repay_in_full", actor: "Borrower", signature: "PENDING" },
      { instruction: "release_collateral", actor: "Operator", signature: "PENDING" },
      { instruction: "close_deal", actor: "Operator", signature: "PENDING" },
    ],
    final: { deal: "completed", vault: "released", loan: "completed" },
    notes: "Stand-in mints; operator = gov signer 1.",
    status: "PENDING_LIVE_SIGS",
  },
  default: {
    date: "YYYY-MM-DD",
    dealIdUrl: "PENDING",
    dealIdHex: "PENDING",
    borrower: "PENDING",
    lender: "PENDING",
    operator: "99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD",
    reporter: "PENDING",
    terms: {
      principal: "100 USDC",
      collateral: "0.01 tBTC",
      rateBps: 800,
      durationMonths: 3,
      oraclePath: "direct-seize-fallback OR pyth-price-update-v2",
    },
    steps: [
      { instruction: "propose_deal", actor: "Borrower", signature: "PENDING" },
      { instruction: "confirm_deal", actor: "Lender", signature: "PENDING" },
      { instruction: "initialize_vault", actor: "Borrower", signature: "PENDING" },
      { instruction: "deposit_collateral", actor: "Borrower", signature: "PENDING" },
      { instruction: "lock_vault", actor: "Operator", signature: "PENDING" },
      { instruction: "begin_funding", actor: "Operator", signature: "PENDING" },
      { instruction: "activate_loan", actor: "Lender", signature: "PENDING" },
      { instruction: "mark_active", actor: "Operator", signature: "PENDING" },
      { instruction: "flag_default", actor: "Reporter", signature: "PENDING" },
      { instruction: "seize_collateral_partial", actor: "Operator", signature: "PENDING" },
      { instruction: "mark_liquidated_partial", actor: "Operator", signature: "PENDING" },
      { instruction: "seize_collateral_full", actor: "Operator", signature: "PENDING" },
      { instruction: "mark_liquidated_full", actor: "Operator", signature: "PENDING" },
      { instruction: "close_deal", actor: "Operator", signature: "PENDING" },
    ],
    final: { deal: "fully_liquidated", vault: "closed", loan: "fully_liquidated" },
    notes: "Document oracle path used.",
    status: "PENDING_LIVE_SIGS",
  },
};

if (printSample) {
  console.log(JSON.stringify(SAMPLES[template] || SAMPLES.happy, null, 2));
  process.exit(0);
}

if (!jsonPath || !outPath) {
  console.log(`Usage:
  node frontend/scripts/record-cycle.mjs --template happy|default --json <file> --out <md>
  node frontend/scripts/record-cycle.mjs --print-sample-json happy
`);
  process.exit(jsonPath || outPath ? 1 : 0);
}

const raw = JSON.parse(fs.readFileSync(path.resolve(jsonPath), "utf8"));
const title =
  template === "default"
    ? "Cycle 02 — Default / liquidation path"
    : "Cycle 01 — Happy path (private direct deal)";

const stepsTable = (raw.steps || [])
  .map((s, i) => {
    const sig = s.signature || "PENDING";
    return `| ${i + 1} | \`${s.instruction}\` | ${s.actor || ""} | \`${sig}\` | ${explorerTx(sig)} |`;
  })
  .join("\n");

const allLive =
  (raw.steps || []).length > 0 &&
  (raw.steps || []).every((s) => s.signature && s.signature !== "PENDING" && s.signature.length > 40);
const status = raw.status || (allLive ? "PASS" : "PENDING_LIVE_SIGS");

const md = `# ${title}

- **Status:** \`${status}\`
- **Date:** ${raw.date || "PENDING"}
- **Cluster:** \`devnet\`
- **Deal id (base64url):** \`${raw.dealIdUrl || "PENDING"}\`
- **Deal id (hex):** \`${raw.dealIdHex || "PENDING"}\`
- **Generated by:** \`frontend/scripts/record-cycle.mjs\`

## Roles

| Role | Address |
| --- | --- |
| Borrower | \`${raw.borrower || "PENDING"}\` |
| Lender | \`${raw.lender || "PENDING"}\` |
| Operator | \`${raw.operator || "99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD"}\` |
${raw.reporter ? `| flagDefault reporter | \`${raw.reporter}\` |` : ""}

## Terms

\`\`\`json
${JSON.stringify(raw.terms || {}, null, 2)}
\`\`\`

## Steps

| # | Instruction | Actor | Signature | Explorer |
| --- | --- | --- | --- | --- |
${stepsTable}

## Final state

| Account | Observed |
| --- | --- |
| Deal | ${raw.final?.deal || "PENDING"} |
| Vault | ${raw.final?.vault || "PENDING"} |
| Loan | ${raw.final?.loan || "PENDING"} |

## Notes

${raw.notes || "_None_"}

## Result

- **Pass / fail:** ${status === "PASS" ? "PASS" : "PENDING"}
- All signatures non-PENDING: ${allLive ? "yes" : "no"}
`;

const absOut = path.resolve(root, outPath);
fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, md);
console.log(`Wrote ${absOut}`);
console.log(`Status: ${status} (live sigs: ${allLive})`);
