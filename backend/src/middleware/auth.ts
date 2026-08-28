import type { FastifyRequest, FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import { requireDatabase } from "../database.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function requireWalletSession(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Wallet authentication required — connect wallet and sign challenge." });
  }
  const token = auth.slice(7).trim();
  if (token.length < 20) {
    return reply.code(401).send({ error: "Invalid session token." });
  }
  try {
    const db = await requireDatabase();
    const tokenHash = hashToken(token);
    const result = await db.query(`SELECT wallet FROM wallet_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`, [tokenHash]);
    if (result.rowCount !== 1) {
      return reply.code(401).send({ error: "Session expired or revoked — please re-authenticate." });
    }
    (request as any).wallet = result.rows[0].wallet;
  } catch (err) {
    request.log.error(err, "[auth] session verification failed");
    return reply.code(503).send({ error: "Authentication service unavailable — try again." });
  }
}

export function getRequestWallet(request: FastifyRequest): string | null {
  return (request as any).wallet ?? null;
}
