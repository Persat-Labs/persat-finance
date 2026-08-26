#!/usr/bin/env node
/**
 * Persat Finance — Devnet protocol initialization.
 *
 * Runs AFTER `solana program deploy` has placed the eight programs on Devnet.
 * It initializes every configuration PDA, mints the four stand-in assets, and
 * registers them in the asset whitelist, then writes a public deployment
 * manifest with every address and transaction signature.
 *
 * Design notes:
 *   - Instructions are hand-serialized (8-byte `sha256("global:<name>")`
 *     discriminator + borsh arguments) against the exact `#[derive(Accounts)]`
 *     layouts in the program sources. The npm registry has no JS client for
 *     Anchor 1.x, and this path needs no IDL, so it cannot drift with client
 *     versions. The LiteSVM suites verify the same discriminators on-chain.
 *   - Idempotent: every step checks whether its account already exists and
 *     skips, so the script can be re-run safely (e.g. after a partial failure).
 *   - No secrets are printed or written. The manifest contains public keys
 *     and signatures only.
 *
 * Usage:
 *   node scripts/devnet-init.mjs \
 *     --rpc https://api.devnet.solana.com \
 *     --deployer keys/deployer.json \
 *     --governance-signer keys/gov-signer-1.json \
 *     --out ../ops/handoff/devnet-deployed.json
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createMint } from "@solana/spl-token";

/* ------------------------------------------------------------------ args */

const args = Object.fromEntries(
  process.argv.slice(2).map((arg, index, all) => {
    if (!arg.startsWith("--")) return [arg, true];
    const key = arg.slice(2);
    const next = all[index + 1];
    return next && !next.startsWith("--") ? [key, next] : [key, true];
  }),
);

const rpcUrl = args.rpc || "https://api.devnet.solana.com";
const deployerPath = args.deployer;
const govSignerPath = args["governance-signer"];
const keysDir = args["keys-dir"] || "target/deploy";
const outPath = args.out || "../ops/handoff/devnet-deployed.json";

if (!deployerPath || !govSignerPath) {
  console.error("usage: devnet-init.mjs --rpc URL --deployer KEYPAIR.json --governance-signer KEYPAIR.json [--keys-dir DIR] [--out FILE]");
  process.exit(1);
}

/* ------------------------------------------------------------- primitives */

const disc = (name) => Buffer.from(createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(Number(n) & 0xffff, 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(Number(n) >>> 0, 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; };
const pk = (p) => Buffer.from(p.toBuffer());
const zeroPk = () => Buffer.alloc(32);

const pda = (seeds, programId) => PublicKey.findProgramAddressSync(seeds.map((s) => (typeof s === "string" ? Buffer.from(s, "utf8") : s)), programId)[0];

const loadKeypair = (path) => {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw) || raw.length !== 64) throw new Error(`${path} is not a 64-byte keypair JSON`);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
};

const PROGRAMS = ["governance", "price_oracle", "asset_whitelist", "deal_registry", "escrow_vault", "loan_lifecycle", "liquidation_engine", "fee_treasury"];

function loadProgramIds() {
  const ids = {};
  for (const name of PROGRAMS) {
    const keypairPath = `${keysDir}/${name}-keypair.json`;
    if (!existsSync(keypairPath)) throw new Error(`missing ${keypairPath} — run the deploy workflow first or pass --keys-dir`);
    ids[name] = loadKeypair(keypairPath).publicKey;
  }
  return ids;
}

/* ---------------------------------------------------------------- config */

const here = dirname(fileURLToPath(import.meta.url));
const configPath = `${here}/../config/devnet.json`;
const config = JSON.parse(readFileSync(configPath, "utf8"));

const manifest = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { initialized: [], signatures: {}, mints: {} };

function saveManifest() {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
}

/* ------------------------------------------------------------ tx plumbing */

const connection = new Connection(rpcUrl, "confirmed");
const deployer = loadKeypair(deployerPath);
const govSigner1 = loadKeypair(govSignerPath);

const signersConfig = config.governance.signers;
if (signersConfig.some((s) => String(s).includes("PLACEHOLDER"))) {
  console.error("config/devnet.json still has PLACEHOLDER governance signers 2/3.");
  console.error("Paste the public-key block from the keypair generator into the Arena session so the config can be filled in.");
  process.exit(1);
}

async function send(name, buildInstruction) {
  const ix = buildInstruction();
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = deployer.publicKey;
  tx.partialSign(...ix.keys.some((k) => k.pubkey.equals(govSigner1.publicKey) && k.isSigner) ? [deployer, govSigner1] : [deployer]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  manifest.signatures[name] = signature;
  console.log(`  ✓ ${name}: ${signature}`);
}

const exists = async (address) => (await connection.getAccountInfo(address)) !== null;

async function step(name, address, run) {
  if (await exists(address)) {
    console.log(`  = ${name}: already initialized, skipping (${address.toBase58()})`);
    return;
  }
  await run();
  manifest.initialized.push(name);
}

/* ------------------------------------------------------------------- run */

const ids = loadProgramIds();
console.log("Programs:");
for (const name of PROGRAMS) console.log(`  ${name.padEnd(20)} ${ids[name].toBase58()}`);

console.log("\nDeployer:", deployer.publicKey.toBase58());
const balance = (await connection.getBalance(deployer.publicKey)) / LAMPORTS_PER_SOL;
console.log(`Deployer balance: ${balance} SOL`);
if (balance < 0.5) {
  console.error("Deployer needs at least ~1 SOL for initialization (deploy rent is spent in the deploy step). Fund it and rerun.");
  process.exit(1);
}

/* PDAs */
const governancePda = pda(["governance"], ids.governance);
const oraclePda = pda(["oracle"], ids.price_oracle);
const registryPda = pda(["asset-registry"], ids.asset_whitelist);
const dealConfigPda = pda(["registry-config"], ids.deal_registry);
const loanConfigPda = pda(["loan-config"], ids.loan_lifecycle);
const enginePda = pda(["liquidation-engine"], ids.liquidation_engine);
const treasuryPda = pda(["treasury"], ids.fee_treasury);
const SYSTEM = SystemProgram.programId;

const govSigners = [
  govSigner1.publicKey,
  new PublicKey(signersConfig[1]),
  new PublicKey(signersConfig[2]),
];
/**
 * The operator (keeper) wallet signs state transitions the programs cannot
 * drive themselves — the workspace contains no cross-program CPIs, so
 * begin_funding / mark_active / close_deal (deal registry), lock_vault /
 * release_collateral / seize_collateral (escrow), mark_liquidated (loan
 * lifecycle), and record_origination_fee (treasury) are all signed directly
 * by the wallet recorded in each program's configuration. Governance signer 1
 * doubles as the operator for devnet; production uses a dedicated keeper.
 */
const operatorRaw = config.keeper && !String(config.keeper.pubkey).includes("PLACEHOLDER") ? config.keeper.pubkey : null;
const operator = operatorRaw ? new PublicKey(operatorRaw) : govSigner1.publicKey;
if (!operatorRaw) {
  console.log("note: keeper.pubkey is a placeholder; governance signer 1 acts as the operator for devnet");
}
const treasuryWallet = String(config.governance.treasury).includes("PLACEHOLDER") ? govSigner1.publicKey : new PublicKey(config.governance.treasury);
if (String(config.governance.treasury).includes("PLACEHOLDER")) {
  console.log("note: governance.treasury is a placeholder; using governance signer 1 as the fee destination for devnet");
}

const payerMeta = { pubkey: deployer.publicKey, isSigner: true, isWritable: true };

console.log("\nInitializing configuration PDAs…");

await step("governance", governancePda, () =>
  send("initialize_governance", () => new TransactionInstruction({
    programId: ids.governance,
    keys: [payerMeta, { pubkey: governancePda, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }],
    data: Buffer.concat([disc("initialize_governance"), ...govSigners.map(pk)]),
  })));

await step("price_oracle", oraclePda, () =>
  send("initialize_oracle", () => new TransactionInstruction({
    programId: ids.price_oracle,
    keys: [payerMeta, { pubkey: oraclePda, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }],
    data: Buffer.concat([
      disc("initialize_oracle"),
      pk(govSigner1.publicKey),
      u32(config.oracle.stalenessThresholdSeconds),
      u64(config.oracle.maxConfidenceBps),
    ]),
  })));

await step("asset_whitelist", registryPda, () =>
  send("initialize_asset_registry", () => new TransactionInstruction({
    programId: ids.asset_whitelist,
    keys: [payerMeta, { pubkey: registryPda, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }],
    data: Buffer.concat([disc("initialize_registry"), pk(govSigner1.publicKey)]),
  })));

await step("deal_registry", dealConfigPda, () =>
  send("initialize_deal_registry", () => new TransactionInstruction({
    programId: ids.deal_registry,
    keys: [payerMeta, { pubkey: dealConfigPda, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }],
    // The registry's "program authorities" are off-chain operator wallets
    // (the keeper): the programs never CPI each other, so state transitions
    // are signed directly by the operator recorded here. For devnet the
    // governance signer 1 doubles as the operator.
    data: Buffer.concat([disc("initialize_registry"), pk(operator), pk(operator), pk(operator)]),
  })));

await step("loan_lifecycle", loanConfigPda, () =>
  send("initialize_loan_config", () => new TransactionInstruction({
    programId: ids.loan_lifecycle,
    keys: [payerMeta, { pubkey: loanConfigPda, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }],
    data: Buffer.concat([disc("initialize_loan_config"), pk(operator)]),
  })));

await step("liquidation_engine", enginePda, () =>
  send("initialize_engine", () => new TransactionInstruction({
    programId: ids.liquidation_engine,
    keys: [payerMeta, { pubkey: enginePda, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }],
    data: Buffer.concat([disc("initialize_engine"), pk(govSigner1.publicKey), pk(oraclePda)]),
  })));

await step("fee_treasury", treasuryPda, () =>
  send("initialize_treasury", () => new TransactionInstruction({
    programId: ids.fee_treasury,
    keys: [payerMeta, { pubkey: treasuryPda, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }],
    data: Buffer.concat([
      disc("initialize_treasury"),
      pk(govSigner1.publicKey),
      pk(treasuryWallet),
      pk(operator),
      u16(config.fees.directOriginationFeeBps),
      u16(config.fees.marketplaceOriginationFeeBps),
    ]),
  })));

/* Stand-in assets: create mints, then register them in the whitelist.
 *
 * Note: validate_asset_policy runs the full threshold validation for BOTH
 * categories (the loan-currency unit test registers USDC with a complete,
 * ordered risk record), so loan currencies carry the collateral risk set.
 */
console.log("\nCreating stand-in mints…");

const defaultRisk = config.assets.collateral[0].riskParameters;
const assetPlans = [
  ...config.assets.collateral.map((asset) => ({ ...asset, kind: "collateral" })),
  ...config.assets.loanCurrency.map((asset) => ({ ...asset, kind: "loanCurrency", riskParameters: asset.riskParameters || defaultRisk })),
];
manifest.assetPlans = assetPlans.map((a) => ({ symbol: a.symbol, kind: a.kind, decimals: a.decimals, risk: a.riskParameters }));

for (const asset of assetPlans) {
  const existing = manifest.mints?.[asset.symbol];
  let mint;
  if (existing && (await exists(new PublicKey(existing)))) {
    mint = new PublicKey(existing);
    console.log(`  = ${asset.symbol}: mint exists, reusing ${mint.toBase58()}`);
  } else {
    mint = await createMint(connection, deployer, deployer.publicKey, null, asset.decimals);
    console.log(`  ✓ ${asset.symbol} mint (${asset.decimals} dp): ${mint.toBase58()}`);
  }
  manifest.mints[asset.symbol] = mint.toBase58();
  saveManifest();

  const recordPda = pda(["asset", ...pk(registryPda), ...pk(mint)], ids.asset_whitelist);
  await step(`asset:${asset.symbol}`, recordPda, () =>
    send(`add_asset_${asset.symbol}`, () => new TransactionInstruction({
      programId: ids.asset_whitelist,
      keys: [
        { pubkey: registryPda, isSigner: false, isWritable: true },
        { pubkey: govSigner1.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: recordPda, isSigner: false, isWritable: true },
        { pubkey: SYSTEM, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        disc("add_asset_type"),
        Buffer.from([asset.kind === "collateral" ? 0 : 1]),
        asset.kind === "collateral" ? pk(oraclePda) : zeroPk(),
        u16(asset.riskParameters.maxLtvBps),
        u16(asset.riskParameters.partialLiquidationLtvBps),
        u16(asset.riskParameters.fullLiquidationLtvBps),
        u16(asset.riskParameters.liquidationPenaltyBps),
        u16(asset.riskParameters.maxPartialLiquidationBps),
      ]),
    })));
}

/* ---------------------------------------------------------------- output */

manifest.cluster = "devnet";
manifest.rpcUrl = rpcUrl;
manifest.deployedAt = new Date().toISOString();
manifest.programs = Object.fromEntries(PROGRAMS.map((name) => [name, ids[name].toBase58()]));
manifest.pdas = {
  governance: governancePda.toBase58(),
  oracle: oraclePda.toBase58(),
  assetRegistry: registryPda.toBase58(),
  dealConfig: dealConfigPda.toBase58(),
  loanConfig: loanConfigPda.toBase58(),
  engine: enginePda.toBase58(),
  treasury: treasuryPda.toBase58(),
};
manifest.governance = { signers: govSigners.map((s) => s.toBase58()), treasury: treasuryWallet.toBase58() };
manifest.operator = {
  pubkey: operator.toBase58(),
  note: "Signs lock_vault, begin_funding, mark_active, close_deal, release_collateral, seize_collateral, mark_liquidated, and record_origination_fee. Vaults MUST be initialized with this address as both the loan and liquidation authority.",
  actions: ["lock_vault", "begin_funding", "mark_active", "close_deal", "release_collateral", "seize_collateral", "mark_liquidated", "record_origination_fee"],
};
manifest.explorer = Object.fromEntries(PROGRAMS.map((name) => [name, `https://explorer.solana.com/address/${ids[name].toBase58()}?cluster=devnet`]));
saveManifest();

console.log(`\nManifest written to ${outPath}`);
console.log("Initialization complete.");
