#!/usr/bin/env node
/**
 * Generate a sandbox bundle for virtual environment testing
 * Creates deployer keypair + stand-in mints (tBTC, zBTC, USDC, USDT) with correct decimals
 * This bundle works for local testing without needing the official devnet deployer secret
 * Architecture is identical to mainnet — only mint addresses differ (which is exactly the mainnet swap)
 */

import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

function keypairToArray(kp) {
  return Array.from(kp.secretKey);
}

const deployer = Keypair.generate();
const gov1 = Keypair.generate();
const gov2 = Keypair.generate();
const gov3 = Keypair.generate();

// Generate stand-in mints — in real devnet these would be created on-chain via createMint
// For sandbox, we generate keypairs for mints; actual on-chain creation happens via bundle.ts dispense which uses deployer as mint authority
const tbtcMint = Keypair.generate();
const zbtcMint = Keypair.generate();
const usdcMint = Keypair.generate();
const usdtMint = Keypair.generate();

const borrower = Keypair.generate();
const lender = Keypair.generate();

const bundle = {
  deployer: {
    pubkey: deployer.publicKey.toBase58(),
    secret: keypairToArray(deployer),
  },
  governance: {
    signer1: { pubkey: gov1.publicKey.toBase58(), secret: keypairToArray(gov1) },
    signer2: { pubkey: gov2.publicKey.toBase58(), secret: keypairToArray(gov2) },
    signer3: { pubkey: gov3.publicKey.toBase58(), secret: keypairToArray(gov3) },
  },
  mints: {
    tBTC: { pubkey: tbtcMint.publicKey.toBase58(), secret: keypairToArray(tbtcMint), decimals: 8, bridge: "Threshold" },
    zBTC: { pubkey: zbtcMint.publicKey.toBase58(), secret: keypairToArray(zbtcMint), decimals: 8, bridge: "Zeus" },
    BTC: { pubkey: tbtcMint.publicKey.toBase58(), secret: keypairToArray(tbtcMint), decimals: 8, alias: "tBTC" },
    USDC: { pubkey: usdcMint.publicKey.toBase58(), secret: keypairToArray(usdcMint), decimals: 6 },
    USDT: { pubkey: usdtMint.publicKey.toBase58(), secret: keypairToArray(usdtMint), decimals: 6 },
  },
  testWallets: {
    borrower: { pubkey: borrower.publicKey.toBase58(), secret: keypairToArray(borrower) },
    lender: { pubkey: lender.publicKey.toBase58(), secret: keypairToArray(lender) },
  },
  // Format expected by frontend bundle loader (persat-devnet-keypairs-KEEP-SECRET.json)
  // The frontend's extractKeypair looks for nested keypair arrays
  persat_devnet_keypairs: {
    deployer: keypairToArray(deployer),
    governance_signer_1: keypairToArray(gov1),
    tbtc_mint: keypairToArray(tbtcMint),
    zbtc_mint: keypairToArray(zbtcMint),
    usdc_mint: keypairToArray(usdcMint),
    usdt_mint: keypairToArray(usdtMint),
  },
  cluster: "devnet",
  note: "SANDBOX ONLY — mainnet swap = change mint addresses to canonical tBTC/zBTC/USDC/USDT. This bundle is for virtual environment testing without needing official deployer secret. For official devnet, use the real persat-devnet-keypairs-KEEP-SECRET.json from Day 0.",
};

const outPath = path.join(process.cwd(), "persat-sandbox-bundle.json");
fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));
console.log(`\n✅ Sandbox bundle generated: ${outPath}`);
console.log(`\nDeployer (mint authority): ${deployer.publicKey.toBase58()}`);
console.log(`tBTC mint: ${tbtcMint.publicKey.toBase58()} (8 decimals)`);
console.log(`zBTC mint: ${zbtcMint.publicKey.toBase58()} (8 decimals)`);
console.log(`USDC mint: ${usdcMint.publicKey.toBase58()} (6 decimals)`);
console.log(`USDT mint: ${usdtMint.publicKey.toBase58()} (6 decimals)`);
console.log(`Borrower test wallet: ${borrower.publicKey.toBase58()}`);
console.log(`Lender test wallet: ${lender.publicKey.toBase58()}`);
console.log(`\n--- Frontend compatible format ---`);
console.log(`The file ${outPath} contains 'persat_devnet_keypairs' field that frontend can load via /faucet upload.`);
console.log(`For official devnet, you still need real bundle with official mints 79AL... etc.`);
console.log(`\n--- To use in sandbox ---`);
console.log(`1. Download ${outPath}`);
console.log(`2. Go to /faucet in frontend preview and upload it`);
console.log(`3. Or use test wallets directly via CLI scripts`);
console.log(`\n--- Test wallets (for CLI) ---`);
console.log(`Borrower secret: [${keypairToArray(borrower).slice(0, 5).join(",")}...] full in file`);
console.log(`Lender secret: [${keypairToArray(lender).slice(0, 5).join(",")}...] full in file`);
