#!/usr/bin/env node
/**
 * Mint stand-in tokens & fund SOL to a wallet (operator/keeper utility).
 *
 * The mint authority is the deployer, whose keypair lives in repository
 * secrets / the operator's local backup — never in this repository. Run from
 * the machine holding the deployer keypair:
 *
 *   node scripts/devnet-mint-tokens.mjs \
 *     --rpc https://api.devnet.solana.com \
 *     --authority ~/path/to/persat-devnet-keypairs-KEEP-SECRET.json \
 *     --to <WALLET_PUBKEY> \
 *     --sol 1 --tbtc 0.1 --usdc 5000
 *
 * Accepts either the full persat-devnet-keypairs-KEEP-SECRET.json bundle or an
 * extracted deployer keypair JSON.
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
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

const DECIMALS = {
  tbtc: { mint: "tBTC", decimals: 8 },
  zbtc: { mint: "zBTC", decimals: 8 },
  usdc: { mint: "USDC", decimals: 6 },
  usdt: { mint: "USDT", decimals: 6 },
};
const wants = Object.entries(args).filter(([key]) => key.toLowerCase() in DECIMALS);
const wantsSol = args.sol && Number(args.sol) > 0;

if (!args.to || !args.authority || (wants.length === 0 && !wantsSol)) {
  console.error("usage: devnet-mint-tokens.mjs --authority <keypair.json> --to <WALLET_PUBKEY> [--sol 1] [--tbtc 0.1] [--usdc 5000]");
  process.exit(1);
}

const connection = new Connection(args.rpc || "https://api.devnet.solana.com", "confirmed");

let rawKey = JSON.parse(readFileSync(args.authority, "utf8"));
if (rawKey.deployer) {
  rawKey = typeof rawKey.deployer.keypair === "string" ? JSON.parse(rawKey.deployer.keypair) : rawKey.deployer.keypair;
}
const authority = Keypair.fromSecretKey(Uint8Array.from(rawKey));
const owner = new PublicKey(args.to);

console.log(`Deployer authority: ${authority.publicKey.toBase58()}`);
console.log(`Target wallet:       ${owner.toBase58()}`);

if (wantsSol) {
  const solAmount = Number(args.sol);
  const lamports = BigInt(Math.round(solAmount * LAMPORTS_PER_SOL));
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: owner,
      lamports,
    }),
  );
  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(`✓ SOL: transferred ${solAmount} SOL to ${owner.toBase58()}`);
    console.log(`  https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  } catch (err) {
    console.error(`✖ SOL transfer failed:`, err?.message ?? err);
  }
}

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
  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(`✓ ${symbol}: minted ${amountText} to ${owner.toBase58()}`);
    console.log(`  https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  } catch (err) {
    console.error(`✖ ${symbol} mint failed:`, err?.message ?? err);
  }
}
