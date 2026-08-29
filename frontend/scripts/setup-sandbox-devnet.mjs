#!/usr/bin/env node
/**
 * Setup sandbox devnet environment — creates mints and funds test wallets
 * Uses official devnet RPC, works without official deployer secret by creating NEW mints
 * For official devnet testing, use real bundle with official mints 79AL... etc.
 * For sandbox virtual environment, this creates fresh mints you control.
 */

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import fs from "fs";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");

const bundlePath = "./persat-sandbox-bundle.json";
if (!fs.existsSync(bundlePath)) {
  console.error(`Bundle not found at ${bundlePath}, run generate-sandbox-bundle.mjs first`);
  process.exit(1);
}

const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));

const deployer = Keypair.fromSecretKey(Uint8Array.from(bundle.deployer.secret));
const tbtcMintKp = Keypair.fromSecretKey(Uint8Array.from(bundle.mints.tBTC.secret));
const zbtcMintKp = Keypair.fromSecretKey(Uint8Array.from(bundle.mints.zBTC.secret));
const usdcMintKp = Keypair.fromSecretKey(Uint8Array.from(bundle.mints.USDC.secret));
const usdtMintKp = Keypair.fromSecretKey(Uint8Array.from(bundle.mints.USDT.secret));
const borrower = Keypair.fromSecretKey(Uint8Array.from(bundle.testWallets.borrower.secret));
const lender = Keypair.fromSecretKey(Uint8Array.from(bundle.testWallets.lender.secret));

console.log(`\n=== Persat Sandbox Devnet Setup ===`);
console.log(`RPC: ${RPC}`);
console.log(`Deployer: ${deployer.publicKey.toBase58()}`);
console.log(`Borrower: ${borrower.publicKey.toBase58()}`);
console.log(`Lender: ${lender.publicKey.toBase58()}`);

async function airdrop(pubkey, amount = 1) {
  try {
    console.log(`Airdropping ${amount} SOL to ${pubkey.toBase58().slice(0, 8)}...`);
    const sig = await connection.requestAirdrop(pubkey, amount * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`  ✅ Airdrop sig: ${sig}`);
    return true;
  } catch (e) {
    console.log(`  ⚠️ Airdrop failed (rate-limited): ${e.message.slice(0, 100)} — try faucet.solana.com`);
    return false;
  }
}

async function ensureMint(mintKp, decimals, authority) {
  try {
    const existing = await connection.getAccountInfo(mintKp.publicKey);
    if (existing) {
      console.log(`Mint ${mintKp.publicKey.toBase58().slice(0, 8)}... already exists`);
      return mintKp.publicKey;
    }
    console.log(`Creating mint ${mintKp.publicKey.toBase58()} decimals=${decimals}...`);
    const mint = await createMint(
      connection,
      authority,
      authority.publicKey,
      authority.publicKey,
      decimals,
      mintKp,
      { commitment: "confirmed" },
    );
    console.log(`  ✅ Mint created: ${mint.toBase58()}`);
    return mint;
  } catch (e) {
    console.error(`  ❌ Mint creation failed: ${e.message}`);
    throw e;
  }
}

async function mintToWallet(mint, wallet, amount, decimals) {
  try {
    const ata = await getOrCreateAssociatedTokenAccount(connection, deployer, mint, wallet.publicKey);
    const rawAmount = amount * 10 ** decimals;
    const sig = await mintTo(connection, deployer, mint, ata.address, deployer, rawAmount);
    console.log(`  Minted ${amount} to ${wallet.publicKey.toBase58().slice(0, 8)}... sig ${sig.slice(0, 16)}...`);
  } catch (e) {
    console.error(`  MintTo failed: ${e.message.slice(0, 200)}`);
  }
}

(async () => {
  console.log(`\n--- Step 1: Fund deployer ---`);
  await airdrop(deployer.publicKey, 2);
  await new Promise((r) => setTimeout(r, 2000));
  const bal = await connection.getBalance(deployer.publicKey);
  console.log(`Deployer balance: ${bal / LAMPORTS_PER_SOL} SOL`);
  if (bal < 0.1 * LAMPORTS_PER_SOL) {
    console.log(`\n⚠️ Deployer needs SOL. Go to https://faucet.solana.com and paste: ${deployer.publicKey.toBase58()}`);
    console.log(`Then re-run this script.`);
    process.exit(0);
  }

  console.log(`\n--- Step 2: Create mints (if not exist) ---`);
  const tbtcMint = await ensureMint(tbtcMintKp, 8, deployer);
  const zbtcMint = await ensureMint(zbtcMintKp, 8, deployer);
  const usdcMint = await ensureMint(usdcMintKp, 6, deployer);
  const usdtMint = await ensureMint(usdtMintKp, 6, deployer);

  console.log(`\n--- Step 3: Fund test wallets with SOL ---`);
  await airdrop(borrower.publicKey, 1);
  await airdrop(lender.publicKey, 1);

  console.log(`\n--- Step 4: Mint full pack to test wallets ---`);
  console.log(`Borrower ${borrower.publicKey.toBase58()}:`);
  await mintToWallet(tbtcMint, borrower, 0.1, 8);
  await mintToWallet(zbtcMint, borrower, 0.1, 8);
  await mintToWallet(usdcMint, borrower, 5000, 6);
  await mintToWallet(usdtMint, borrower, 5000, 6);

  console.log(`\nLender ${lender.publicKey.toBase58()}:`);
  await mintToWallet(tbtcMint, lender, 0.1, 8);
  await mintToWallet(zbtcMint, lender, 0.1, 8);
  await mintToWallet(usdcMint, lender, 5000, 6);
  await mintToWallet(usdtMint, lender, 5000, 6);

  console.log(`\n=== Sandbox Setup Complete ===`);
  console.log(`\nTest wallets funded with full pack: 1 SOL + 0.1 tBTC + 0.1 zBTC + 5000 USDC + 5000 USDT`);
  console.log(`You can now run Day 2 liquidation simulation using these wallets.`);
  console.log(`\nFrontend: Update frontend/src/lib/protocol/config.ts MINTS to:`);
  console.log(`  tBTC: ${tbtcMint.toBase58()}`);
  console.log(`  zBTC: ${zbtcMint.toBase58()}`);
  console.log(`  USDC: ${usdcMint.toBase58()}`);
  console.log(`  USDT: ${usdtMint.toBase58()}`);
  console.log(`\nOr use official mints for official devnet testing:`);
  console.log(`  tBTC: 79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg`);
  console.log(`  zBTC: DqQ1yzTPsfpuMMyuV6mVBvusxpq9mqmTTJZ4yMUQwQEt`);
  console.log(`  USDC: FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe`);
  console.log(`  USDT: 8zdnnnuNJPNDkGTCxREnTyKnRo494By7MrDSTYtRx1aJ`);
})();
