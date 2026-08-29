import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireDatabase } from "../database.js";
import { createChallenge, createSessionToken, verifySolanaMessage } from "../domain/walletAuth.js";

const walletSchema = z.object({ wallet: z.string().min(32).max(44) });
const verifySchema = z.object({ challengeId: z.string().uuid(), signature: z.string().min(64) });

export async function walletAuthRoutes(app: FastifyInstance) {
  app.post("/v1/auth/challenge", async (request, reply) => {
    const parsed = walletSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid Solana wallet" });
    try {
      const db = await requireDatabase();
      const challenge = createChallenge(parsed.data.wallet, process.env.NEXT_PUBLIC_APP_URL ?? "https://persat.finance");
      // MySQL and PG compatible — use ? placeholders, wrapper converts $1 to ?
      await db.query(
        "INSERT INTO wallet_auth_challenges (id, wallet, nonce_hash, message, expires_at) VALUES (UUID(), ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))",
        [parsed.data.wallet, challenge.nonceHash, challenge.message],
      );
      // For MySQL, we need to fetch the inserted row — use wallet + nonce_hash to get id
      const fetch = await db.query("SELECT id, expires_at FROM wallet_auth_challenges WHERE wallet = ? AND nonce_hash = ? ORDER BY created_at DESC LIMIT 1", [parsed.data.wallet, challenge.nonceHash]);
      const row = fetch.rows[0] || { id: "unknown", expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
      return { challengeId: row.id, message: challenge.message, expiresAt: row.expires_at };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ error: "Wallet authentication is unavailable." });
    }
  });

  app.post("/v1/auth/verify", async (request, reply) => {
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid authentication response" });
    try {
      const db = await requireDatabase();
      // Fetch challenge
      const result = await db.query("SELECT wallet, message FROM wallet_auth_challenges WHERE id = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1", [parsed.data.challengeId]);
      if (result.rowCount !== 1 || !verifySolanaMessage(result.rows[0].wallet, result.rows[0].message, parsed.data.signature)) {
        return reply.code(401).send({ error: "Signature verification failed." });
      }
      await db.query("UPDATE wallet_auth_challenges SET used_at = NOW() WHERE id = ?", [parsed.data.challengeId]);
      const session = createSessionToken();
      await db.query("INSERT INTO wallet_sessions (id, wallet, token_hash, expires_at) VALUES (UUID(), ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))", [result.rows[0].wallet, session.tokenHash]);
      return { token: session.token, wallet: result.rows[0].wallet, expiresInSeconds: 86400 };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ error: "Wallet authentication is unavailable." });
    }
  });
}
