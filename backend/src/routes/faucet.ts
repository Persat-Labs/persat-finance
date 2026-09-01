import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireDatabase, type UnifiedDb } from "../database.js";
import { config } from "../config.js";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, createMintToInstruction, getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const faucetSchema = z.object({
  wallet: z.string().min(32).max(44),
  asset: z.enum(["SOL", "tBTC", "zBTC", "BTC", "USDC", "USDT", "ALL"]).optional(),
});

const COOLDOWN_HOURS = 24;

const MINTS = {
  tBTC: { mint: "79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg", decimals: 8 },
  zBTC: { mint: "DqQ1yzTPsfpuMMyuV6mVBvusxpq9mqmTTJZ4yMUQwQEt", decimals: 8 },
  USDC: { mint: "FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe", decimals: 6 },
  USDT: { mint: "8zdnnnuNJPNDkGTCxREnTyKnRo494By7MrDSTYtRx1aJ", decimals: 6 },
};

function getDeployerKeypair(): Keypair | null {
  const json = config.deployerKeypairJson;
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr) && arr.length === 64) {
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    if (arr && typeof arr === "object" && Array.isArray((arr as any).secret)) {
      return Keypair.fromSecretKey(Uint8Array.from((arr as any).secret));
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureFaucetTable(db: UnifiedDb): Promise<void> {
  if (db.type === "mysql") {
    await db.query(`
      CREATE TABLE IF NOT EXISTS faucet_claims (
        id VARCHAR(36) PRIMARY KEY,
        wallet VARCHAR(44) NOT NULL,
        asset VARCHAR(20) NOT NULL,
        claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_wallet_asset_time (wallet, asset, claimed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } else {
    await db.query(`
      CREATE TABLE IF NOT EXISTS faucet_claims (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        wallet TEXT NOT NULL,
        asset TEXT NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS faucet_claims_wallet_asset_time ON faucet_claims(wallet, asset, claimed_at DESC);`).catch(() => undefined);
  }
}

/** Returns remaining hours if cooldown active, otherwise null. Soft-fails open if DB unavailable. */
async function checkAndRecordCooldown(
  wallet: string,
  asset: string,
): Promise<{ blocked: true; remainingHours: number } | { blocked: false; recorded: boolean }> {
  try {
    const db = await requireDatabase();
    await ensureFaucetTable(db);

    const last = await db.query(
      `SELECT claimed_at FROM faucet_claims WHERE wallet = ? AND asset = ? ORDER BY claimed_at DESC LIMIT 1`,
      [wallet, asset],
    );
    if (last.rowCount === 1) {
      const lastAt = new Date(last.rows[0].claimed_at).getTime();
      const hoursSince = (Date.now() - lastAt) / (1000 * 60 * 60);
      if (hoursSince < COOLDOWN_HOURS) {
        return { blocked: true, remainingHours: Math.ceil(COOLDOWN_HOURS - hoursSince) };
      }
    }
    await db.query(`INSERT INTO faucet_claims (id, wallet, asset) VALUES (UUID(), ?, ?)`, [wallet, asset]);
    return { blocked: false, recorded: true };
  } catch {
    // No persistence — allow dispense without cooldown record
    return { blocked: false, recorded: false };
  }
}

async function dispenseFromServer(recipient: PublicKey, asset: string): Promise<{ signature: string; explorerUrl: string }> {
  const deployer = getDeployerKeypair();
  if (!deployer) throw new Error("Server dispenser not configured — set PERSAT_DEPLOYER_KEYPAIR");

  const connection = new Connection(config.rpcUrl, "confirmed");
  const bal = await connection.getBalance(deployer.publicKey, "confirmed");
  if (bal < 0.01 * LAMPORTS_PER_SOL) {
    throw new Error(`Deployer low SOL (${bal / LAMPORTS_PER_SOL}) — fund: ${deployer.publicKey.toBase58()} via faucet.solana.com`);
  }

  const tx = new Transaction();
  const isAll = asset === "ALL" || !asset;
  const wantSol = isAll || asset === "SOL";
  const wantTbtc = isAll || asset === "tBTC" || asset === "BTC";
  const wantZbtc = isAll || asset === "zBTC";
  const wantUsdc = isAll || asset === "USDC";
  const wantUsdt = isAll || asset === "USDT";

  if (wantSol) {
    tx.add(SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: recipient, lamports: Math.floor(0.5 * LAMPORTS_PER_SOL) }));
  }

  async function addMint(mintStr: string, decimals: number, amount: number) {
    const mint = new PublicKey(mintStr);
    const ata = getAssociatedTokenAddressSync(mint, recipient, false, TOKEN_PROGRAM_ID);
    try {
      await getAccount(connection, ata, "confirmed");
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(deployer!.publicKey, ata, recipient, mint, TOKEN_PROGRAM_ID));
    }
    const rawAmount = Math.floor(amount * 10 ** decimals);
    tx.add(createMintToInstruction(mint, ata, deployer!.publicKey, rawAmount, [], TOKEN_PROGRAM_ID));
  }

  if (wantTbtc) await addMint(MINTS.tBTC.mint, MINTS.tBTC.decimals, 0.1);
  if (wantZbtc) await addMint(MINTS.zBTC.mint, MINTS.zBTC.decimals, 0.1);
  if (wantUsdc) await addMint(MINTS.USDC.mint, MINTS.USDC.decimals, 5000);
  if (wantUsdt) await addMint(MINTS.USDT.mint, MINTS.USDT.decimals, 5000);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = deployer.publicKey;
  tx.sign(deployer);

  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

  return { signature: sig, explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=${config.cluster}` };
}

export async function faucetRoutes(app: FastifyInstance) {
  app.post("/v1/faucet/claim", async (request, reply) => {
    const parsed = faucetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid faucet request", details: parsed.error.flatten() });

    const { wallet, asset } = parsed.data;
    let walletPubkey: PublicKey;
    try {
      walletPubkey = new PublicKey(wallet);
    } catch {
      return reply.code(400).send({ error: "Invalid wallet address" });
    }

    const assetKey = asset ?? "ALL";
    const cooldown = await checkAndRecordCooldown(wallet, assetKey);
    if (cooldown.blocked) {
      return reply.code(429).send({
        error: `Faucet cooldown active — try again in ${cooldown.remainingHours}h`,
        cooldownHours: COOLDOWN_HOURS,
        remainingHours: cooldown.remainingHours,
      });
    }

    if (config.deployerConfigured) {
      try {
        const result = await dispenseFromServer(walletPubkey, assetKey);
        return {
          ok: true,
          wallet,
          asset: assetKey,
          message: `Dispensed ${assetKey === "ALL" ? "full pack (0.5 SOL + 0.1 tBTC + 0.1 zBTC + 5k USDC + 5k USDT)" : assetKey} to ${wallet.slice(0, 4)}...`,
          signature: result.signature,
          explorerUrl: result.explorerUrl,
          mode: "server_dispense",
          cooldownHours: COOLDOWN_HOURS,
        };
      } catch (e) {
        request.log.error(e, "[faucet] server dispense failed");
        return {
          ok: true,
          wallet,
          asset: assetKey,
          message: "Faucet claim recorded. Full pack mint is not available right now — try again shortly.",
          mode: "cooldown_only",
          error: (e as Error).message,
          cooldownHours: COOLDOWN_HOURS,
        };
      }
    }

    return {
      ok: true,
      wallet,
      asset: assetKey,
      message: "Faucet claim recorded.",
      mode: "cooldown_only",
      cooldownHours: COOLDOWN_HOURS,
    };
  });

  app.get("/v1/faucet/status/:wallet", async (request, reply) => {
    const { wallet } = request.params as { wallet: string };
    if (!wallet || wallet.length < 32) return reply.code(400).send({ error: "Invalid wallet" });
    try {
      const db = await requireDatabase();
      await ensureFaucetTable(db);
      const result = await db.query(`SELECT asset, claimed_at FROM faucet_claims WHERE wallet = ? ORDER BY claimed_at DESC LIMIT 10`, [wallet]);
      return { wallet, claims: result.rows, serverDispenseAvailable: config.deployerConfigured };
    } catch {
      return { wallet, claims: [], mode: "no_persistence", serverDispenseAvailable: config.deployerConfigured };
    }
  });

  app.post("/v1/faucet/auto", async (request, reply) => {
    const parsed = faucetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
    const { wallet } = parsed.data;
    let walletPubkey: PublicKey;
    try {
      walletPubkey = new PublicKey(wallet);
    } catch {
      return reply.code(400).send({ error: "Invalid wallet" });
    }

    if (!config.deployerConfigured) {
      return reply.code(503).send({ error: "Auto-faucet mint is not available on this host yet.", mode: "cooldown_only" });
    }

    const cooldown = await checkAndRecordCooldown(wallet, "ALL");
    if (cooldown.blocked) {
      return reply.code(429).send({
        error: `Faucet cooldown active — try again in ${cooldown.remainingHours}h`,
        cooldownHours: COOLDOWN_HOURS,
        remainingHours: cooldown.remainingHours,
      });
    }

    try {
      const result = await dispenseFromServer(walletPubkey, "ALL");
      return {
        ok: true,
        wallet,
        asset: "ALL",
        message: "Auto-dispensed full pack: 0.5 SOL + 0.1 tBTC + 0.1 zBTC + 5k USDC + 5k USDT",
        signature: result.signature,
        explorerUrl: result.explorerUrl,
        mode: "server_dispense",
        cooldownHours: COOLDOWN_HOURS,
        breakdown: { sol: 0.5, tbtc: 0.1, zbtc: 0.1, usdc: 5000, usdt: 5000 },
      };
    } catch (e) {
      request.log.error(e, "[faucet/auto] failed");
      return reply.code(500).send({
        error: `Auto-dispense failed: ${(e as Error).message}`,
        explorer: `https://explorer.solana.com/address/${wallet}?cluster=${config.cluster}`,
      });
    }
  });
}
