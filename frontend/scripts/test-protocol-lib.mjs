#!/usr/bin/env node
/**
 * Protocol client library self-test.
 *
 * Compiles src/lib/protocol to a temporary directory and verifies each layer
 * against an independent implementation:
 *   - sha256 vs node:crypto over random inputs
 *   - every embedded discriminator recomputed from first principles
 *   - terms serialization layout byte-for-byte vs DealTerms::hash() in Rust
 *   - instruction builders: program, account order/flags, and argument
 *     encoding at exact offsets
 *
 * Run: node scripts/test-protocol-lib.mjs   (or: npm run test:protocol)
 */
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Compile inside the package so node_modules resolves; removed afterwards.
const out = join(process.cwd(), ".protocol-test-build");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execSync(`npx tsc src/lib/protocol/*.ts --outDir ${out} --module commonjs --target es2020 --esModuleInterop --skipLibCheck`, { stdio: "inherit" });

const { sha256 } = await import(join(out, "sha256.js"));
const { DISCRIMINATORS } = await import(join(out, "discriminators.js"));
const { serializeTerms, termsHash } = await import(join(out, "terms.js"));
const pdas = await import(join(out, "pdas.js"));
const enc = await import(join(out, "encoding.js"));
const { PROGRAM_IDS, OPERATOR } = await import(join(out, "config.js"));
const ix = await import(join(out, "instructions.js"));
const { describeFailure } = await import(join(out, "errors.js"));

let failures = 0;
const check = (name, condition, detail = "") => {
  if (condition) console.log(`  ✓ ${name}`);
  else { failures += 1; console.error(`  ✗ ${name} ${detail}`); }
};

const { PublicKey, Keypair } = await import("@solana/web3.js");

console.log("sha256 vs node:crypto");
for (let i = 0; i < 8; i += 1) {
  const input = randomBytes(1 + Math.floor(Math.random() * 300));
  const mine = Buffer.from(sha256(new Uint8Array(input))).toString("hex");
  const theirs = createHash("sha256").update(input).digest("hex");
  check(`random vector ${i} (${input.length}B)`, mine === theirs);
}

console.log("discriminators recomputed");
for (const [camel, hex] of Object.entries(DISCRIMINATORS)) {
  const snake = camel.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
  const expected = createHash("sha256").update(`global:${snake}`).digest().subarray(0, 8).toString("hex");
  check(`${camel} (${snake})`, expected === hex, `expected ${expected}`);
}

console.log("terms serialization");
{
  const terms = {
    principalAtoms: 243750000000n,
    loanMint: Keypair.generate().publicKey,
    collateralMint: Keypair.generate().publicKey,
    collateralAtoms: 125000000n,
    rateBps: 820,
    durationMonths: 12,
    ltvBps: 5000,
  };
  const buffer = serializeTerms(terms);
  check("86-byte fixed layout", buffer.length === 86);
  check("principal at 0..8 LE", buffer.readBigUInt64LE(0) === terms.principalAtoms);
  check("loan mint at 8..40", buffer.subarray(8, 40).equals(Buffer.from(terms.loanMint.toBuffer())));
  check("collateral mint at 40..72", buffer.subarray(40, 72).equals(Buffer.from(terms.collateralMint.toBuffer())));
  check("collateral atoms at 72..80", buffer.readBigUInt64LE(72) === terms.collateralAtoms);
  check("rate at 80", buffer.readUInt16LE(80) === 820);
  check("duration at 82", buffer.readUInt16LE(82) === 12);
  check("ltv at 84", buffer.readUInt16LE(84) === 5000);
  const digest = Buffer.from(termsHash(terms)).toString("hex");
  const independent = createHash("sha256").update(buffer).digest("hex");
  check("terms hash = sha256(layout)", digest === independent);
}

console.log("PDA derivations");
{
  const dealId = randomBytes(16);
  const deal = pdas.dealPda(dealId);
  check("deal pda under deal registry", deal.equals(PublicKey.findProgramAddressSync([Buffer.from("deal"), Buffer.from(dealId)], PROGRAM_IDS.dealRegistry)[0]));
  check("vault pda", pdas.vaultPda(dealId).equals(PublicKey.findProgramAddressSync([Buffer.from("vault"), Buffer.from(dealId)], PROGRAM_IDS.escrowVault)[0]));
  check("vault tokens pda", pdas.vaultTokenPda(dealId).equals(PublicKey.findProgramAddressSync([Buffer.from("vault-tokens"), Buffer.from(dealId)], PROGRAM_IDS.escrowVault)[0]));
  check("loan pda", pdas.loanPda(dealId).equals(PublicKey.findProgramAddressSync([Buffer.from("loan"), Buffer.from(dealId)], PROGRAM_IDS.loanLifecycle)[0]));
  check("registry config pda", pdas.registryConfigPda().equals(PublicKey.findProgramAddressSync([Buffer.from("registry-config")], PROGRAM_IDS.dealRegistry)[0]));
}

console.log("instruction builders");
{
  const creator = Keypair.generate().publicKey;
  const other = Keypair.generate().publicKey;
  const dealId = randomBytes(16);
  const mint = Keypair.generate().publicKey;
  const dealAddr = pdas.dealPda(dealId);
  const terms = {
    principalAtoms: 1000000000n,
    loanMint: mint,
    collateralMint: Keypair.generate().publicKey,
    collateralAtoms: 200000000n,
    rateBps: 1000,
    durationMonths: 12,
    ltvBps: 5000,
  };

  const propose = ix.proposeDeal({
    creator, dealId, terms, visibility: ix.Visibility.Private, creatorSide: ix.Side.Borrower,
    counterparty: other, dealPda: dealAddr,
  });
  check("propose: program", propose.programId.equals(PROGRAM_IDS.dealRegistry));
  check("propose: accounts [creator signer, deal writable, system]",
    propose.keys.length === 3 && propose.keys[0].pubkey.equals(creator) && propose.keys[0].isSigner
    && propose.keys[1].pubkey.equals(dealAddr) && propose.keys[1].isWritable && !propose.keys[1].isSigner);
  const data = Buffer.from(propose.data);
  check("propose: discriminator", data.subarray(0, 8).equals(Buffer.from(DISCRIMINATORS.proposeDeal, "hex")));
  check("propose: deal id at 8..24", data.subarray(8, 24).equals(Buffer.from(dealId)));
  check("propose: principal at 24", data.readBigUInt64LE(24) === 1000000000n);
  // 8 disc + 16 id + 8 principal + 32 + 32 mints + 8 collateral = 104
  check("propose: total length 145", data.length === 145, `got ${data.length}`);
  check("propose: rate at 104", data.readUInt16LE(104) === 1000);
  check("propose: visibility index at 110", data[110] === 0);
  check("propose: side index at 111", data[111] === 0);
  check("propose: some(counterparty) at 112", data[112] === 1 && data.subarray(113, 145).equals(Buffer.from(other.toBuffer())));

  const confirm = ix.confirmDeal({ confirmer: other, dealPda: dealAddr, expectedTermsHash: Buffer.from(termsHash(terms)) });
  check("confirm: program + 2 accounts", confirm.programId.equals(PROGRAM_IDS.dealRegistry) && confirm.keys.length === 2);
  check("confirm: hash payload", Buffer.from(confirm.data).subarray(8, 40).equals(Buffer.from(termsHash(terms))));

  const vault = ix.initializeVault({
    borrower: creator, dealId, vaultPda: pdas.vaultPda(dealId), vaultTokenAccount: pdas.vaultTokenPda(dealId), collateralMint: terms.collateralMint,
  });
  check("vault init: 6 accounts in order",
    vault.keys.length === 6 && vault.keys[0].pubkey.equals(creator) && vault.keys[0].isSigner
    && vault.keys[1].pubkey.equals(pdas.vaultPda(dealId)) && vault.keys[2].pubkey.equals(terms.collateralMint)
    && vault.keys[3].pubkey.equals(pdas.vaultTokenPda(dealId)) && vault.keys[3].isWritable);
  const vdata = Buffer.from(vault.data);
  check("vault init: operator authorities at 24 and 56",
    vdata.subarray(24, 56).equals(Buffer.from(OPERATOR.toBuffer())) && vdata.subarray(56, 88).equals(Buffer.from(OPERATOR.toBuffer())));

  const payment = ix.makePayment({
    loanPda: pdas.loanPda(dealId), borrower: creator, loanMint: mint,
    borrowerTokenAccount: Keypair.generate().publicKey, lenderTokenAccount: Keypair.generate().publicKey,
    amount: 83333334n,
  });
  check("payment: program + amount at 8", payment.programId.equals(PROGRAM_IDS.loanLifecycle) && Buffer.from(payment.data).readBigUInt64LE(8) === 83333334n);
  check("payment: 6 accounts", payment.keys.length === 6);

  const lock = ix.lockVault({ operator: OPERATOR, vaultPda: pdas.vaultPda(dealId), requiredAtoms: 200000000n });
  check("lock: operator signer + vault writable", lock.keys.length === 2 && lock.keys[0].isWritable && lock.keys[1].isSigner && lock.keys[1].pubkey.equals(OPERATOR));
}

console.log("error mapping");
{
  const rejected = describeFailure({ message: "User rejected the request." });
  check("wallet rejection", rejected.kind === "wallet-rejected");
  const anchorError = describeFailure({
    message: `Program ${PROGRAM_IDS.escrowVault.toBase58()} failed: custom program error: 0x1789`,
    logs: [`Program ${PROGRAM_IDS.escrowVault.toBase58()} failed: custom program error: 0x1789`],
  });
  check("anchor 0x1789 = 6025 beyond table falls back", anchorError.kind === "program-error");
  const anchorError2 = describeFailure({
    message: "failed",
    logs: [`Program ${PROGRAM_IDS.dealRegistry.toBase58()} failed: custom program error: 0x1789`],
  });
  check("anchor error generic mapping", anchorError2.kind === "program-error" && anchorError2.programErrorCode === 0x1789);
  const expired = describeFailure({ message: "Blockhash not found" });
  check("blockhash expiry", expired.kind === "blockhash-expired");
}

rmSync(out, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL PROTOCOL LIB CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
