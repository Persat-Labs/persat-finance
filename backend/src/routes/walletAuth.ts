import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireDatabase } from "../database.js";
import { createChallenge, createSessionToken, verifySolanaMessage } from "../domain/walletAuth.js";

const walletSchema = z.object({ wallet: z.string().min(32).max(44) });
const verifySchema = z.object({ challengeId: z.string().uuid(), signature: z.string().min(64) });
export async function walletAuthRoutes(app: FastifyInstance) {
  app.post("/v1/auth/challenge", async (request, reply) => {
    const parsed = walletSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "Invalid Solana wallet" });
    try { const db = await requireDatabase(); const challenge = createChallenge(parsed.data.wallet, process.env.NEXT_PUBLIC_APP_URL ?? "https://persat.finance");
      const result = await db.query("insert into wallet_auth_challenges (wallet, nonce_hash, message, expires_at) values ($1,$2,$3,now() + interval '5 minutes') returning id, expires_at", [parsed.data.wallet, challenge.nonceHash, challenge.message]);
      return { challengeId: result.rows[0].id, message: challenge.message, expiresAt: result.rows[0].expires_at };
    } catch (error) { request.log.error(error); return reply.code(503).send({ error: "Wallet authentication is unavailable." }); }
  });
  app.post("/v1/auth/verify", async (request, reply) => {
    const parsed = verifySchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "Invalid authentication response" });
    try { const db = await requireDatabase(); const client = await db.connect();
      try { await client.query("begin"); const result = await client.query("select wallet, message from wallet_auth_challenges where id=$1 and used_at is null and expires_at > now() for update", [parsed.data.challengeId]);
        if (result.rowCount !== 1 || !verifySolanaMessage(result.rows[0].wallet, result.rows[0].message, parsed.data.signature)) { await client.query("rollback"); return reply.code(401).send({ error: "Signature verification failed." }); }
        await client.query("update wallet_auth_challenges set used_at=now() where id=$1", [parsed.data.challengeId]); const session = createSessionToken();
        await client.query("insert into wallet_sessions (wallet, token_hash, expires_at) values ($1,$2,now() + interval '24 hours')", [result.rows[0].wallet, session.tokenHash]); await client.query("commit"); return { token: session.token, wallet: result.rows[0].wallet, expiresInSeconds: 86400 };
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    } catch (error) { request.log.error(error); return reply.code(503).send({ error: "Wallet authentication is unavailable." }); }
  });
}
