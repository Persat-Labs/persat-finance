#!/usr/bin/env node
/**
 * Create on-chain Metaplex Token Metadata for Devnet stand-in mints.
 *
 * This writes the official name, symbol, and logo metadata on-chain so that
 * Phantom, Solflare, and Solana Explorer display the official logos and names
 * (USD Coin, Tether USD, Threshold Bitcoin, Zeus Bitcoin) instead of unknown tokens.
 *
 * Usage:
 *   node scripts/devnet-create-metadata.mjs \
 *     --rpc https://api.devnet.solana.com \
 *     --authority ~/path/to/persat-devnet-keypairs-KEEP-SECRET.json
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const args = Object.fromEntries(
  process.argv.slice(2).map((arg, index, all) => {
    if (!arg.startsWith("--")) return [arg, true];
    const key = arg.slice(2);
    const next = all[index + 1];
    return next && !next.startsWith("--") ? [key, next] : [key, true];
  }),
);

if (!args.authority) {
  console.error("usage: devnet-create-metadata.mjs --authority <keypair.json> [--rpc URL]");
  process.exit(1);
}

const connection = new Connection(args.rpc || "https://api.devnet.solana.com", "confirmed");

let rawKey = JSON.parse(readFileSync(args.authority, "utf8"));
if (rawKey.deployer) {
  rawKey = typeof rawKey.deployer.keypair === "string" ? JSON.parse(rawKey.deployer.keypair) : rawKey.deployer.keypair;
}
const authority = Keypair.fromSecretKey(Uint8Array.from(rawKey));

console.log(`Deployer authority: ${authority.publicKey.toBase58()}`);

const TOKENS = [
  {
    symbol: "tBTC",
    name: "Threshold Bitcoin",
    mint: new PublicKey("79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg"),
    uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/6DNSN2T0GmgSm8gQAbPaK0MmKKhwNsmkXJkE2p0D9z44/metadata.json",
  },
  {
    symbol: "zBTC",
    name: "Zeus Bitcoin",
    mint: new PublicKey("DqQ1yzTPsfpuMMyuV6mVBvusxpq9mqmTTJZ4yMUQwQEt"),
    uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/metadata.json",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    mint: new PublicKey("FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe"),
    uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/metadata.json",
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    mint: new PublicKey("8zdnnnuNJPNDkGTCxREnTyKnRo494By7MrDSTYtRx1aJ"),
    uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/metadata.json",
  },
];

function borshString(s) {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}

for (const token of TOKENS) {
  console.log(`\nProcessing ${token.symbol} (${token.name})...`);

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), token.mint.toBuffer()],
    METAPLEX_PROGRAM_ID,
  );

  const existing = await connection.getAccountInfo(metadataPda);
  if (existing) {
    console.log(`✓ Metadata already exists for ${token.symbol} at ${metadataPda.toBase58()}`);
    continue;
  }

  const instructionData = Buffer.concat([
    Buffer.from([33]), // CreateMetadataAccountV3 instruction discriminator
    borshString(token.name),
    borshString(token.symbol),
    borshString(token.uri),
    Buffer.from([0, 0]), // sellerFeeBasisPoints = 0
    Buffer.from([0]), // creators = None
    Buffer.from([0]), // collection = None
    Buffer.from([0]), // uses = None
    Buffer.from([1]), // isMutable = true
    Buffer.from([0]), // collectionDetails = None
  ]);

  const ix = new TransactionInstruction({
    programId: METAPLEX_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: token.mint, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: authority.publicKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  const tx = new Transaction().add(ix);
  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(`✓ Created metadata for ${token.symbol}!`);
    console.log(`  Tx: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  } catch (err) {
    console.error(`✖ Failed to create metadata for ${token.symbol}:`, err?.message ?? err);
  }
}

console.log("\nDone! Phantom and Solflare will now display official names & logos.");
