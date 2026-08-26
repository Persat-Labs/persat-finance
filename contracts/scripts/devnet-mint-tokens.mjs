#!/usr/bin/env node
/**
 * Mint stand-in tokens to a wallet (operator/keeper utility).
 *
 * The mint authority is the deployer, whose keypair lives in repository
 * secrets / the operator's local backup — never in this repository. Run from
 * the machine holding the deployer keypair:
 *
 *   node scripts/devnet-mint-tokens.mjs \
 *     --rpc https://api.devnet.solana.com \
 *     --authority ~/keys/deployer.json \
 *     --to <WALLET_PUBKEY> \
 *     --tbtc 0.1 --usdc 5000
 *
 * Amounts are human units, converted with each mint's decimals. Mint
 * addresses come from ops/handoff/devnet-deployed.json (written by the
 * deployment initializer).
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg, index, all) => {
    if (!arg.startsWith("--")) return [arg, true];
    const key = arg.slice(2);
    const next = all[index + 1];
    return next && !next.startsWith("--") ? [key, next] : [key, true];
  }),
);

const here = dirname(fileURLToPath(import.meta.url));
const manifestPaths = [
  `${here}/../../ops/handoff/devnet-deployed.json`,
  `${here}/../ops/handoff/devnet-deployed.json`,
];
const manifest = manifestPaths
  .map((path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } })
  .find(Boolean);
if (!manifest?.mints) {
  console.error("No deployment manifest with mints found. Run the deploy workflow first.");
  process.exit(1);
}

const DECIMALS = { tbtc: { mint: "tBTC", decimals: 8 }, zbtc: { mint: "zBTC", decimals: 8 }, usdc: { mint: "USDC", decimals: 6 }, usdt: { mint: "USDT", decimals: 6 } };
const wants = Object.entries(args).filter(([key]) => key.toLowerCase() in DECIMALS);
if (!args.to || !args.authority || wants.length === 0) {
  console.error("usage: devnet-mint-tokens.mjs --rpc URL --authority deployer.json --to WALLET --tbtc 0.1 --usdc 5000");
  process.exit(1);
}

const connection = new Connection(args.rpc || "https://api.devnet.solana.com", "confirmed");
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(args.authority, "utf8"))));
const owner = new PublicKey(args.to);

for (const [flag, amountText] of wants) {
  const { mint: symbol, decimals } = DECIMALS[flag.toLowerCase()];
  const mintAddress = manifest.mints[symbol];
  if (!mintAddress) { console.error(`no mint recorded for ${symbol}`); continue; }
  const mint = new PublicKey(mintAddress);
  const amount = BigInt(Math.round(Number(amountText) * 10 ** decimals));
  if (amount <= 0n) continue;

  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
  const tx = new Transaction();
  if (!(await connection.getAccountInfo(ata))) {
    tx.add(createAssociatedTokenAccountInstruction(authority.publicKey, ata, owner, mint, TOKEN_PROGRAM_ID));
  }
  tx.add(createMintToInstruction(mint, ata, authority.publicKey, amount, [], TOKEN_PROGRAM_ID));
  const signature = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log(`✓ ${symbol}: minted ${amountText} to ${owner.toBase58()} — https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}
