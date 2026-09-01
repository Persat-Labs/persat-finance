import type { FastifyRequest, FastifyReply } from "fastify";
import { lookupSessionWallet } from "../domain/sessionStore.js";

export async function requireWalletSession(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return reply.code(401).send({
      error: "Wallet session required.",
      hint: "POST /v1/auth/challenge → sign message in wallet → POST /v1/auth/verify → Authorization: Bearer <token>",
    });
  }
  const token = auth.slice(7).trim();
  if (token.length < 20) {
    return reply.code(401).send({ error: "Invalid session token." });
  }
  try {
    const wallet = await lookupSessionWallet(token);
    if (!wallet) {
      return reply.code(401).send({ error: "Session expired or revoked — sign in again." });
    }
    (request as FastifyRequest & { wallet?: string }).wallet = wallet;
  } catch (err) {
    request.log.error(err, "[auth] session verification failed");
    return reply.code(503).send({ error: "Authentication service unavailable — try again." });
  }
}

export function getRequestWallet(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { wallet?: string }).wallet ?? null;
}

/**
 * Ensure body.wallet / proposerWallet / initiatorWallet matches the session.
 * Prevents "edit JSON in DevTools and post as someone else" with a stolen-looking body.
 */
export function assertBodyWalletMatchesSession(
  request: FastifyRequest,
  reply: FastifyReply,
  bodyWallet: string | undefined | null,
): boolean {
  const sessionWallet = getRequestWallet(request);
  if (!sessionWallet) {
    void reply.code(401).send({ error: "Wallet session required." });
    return false;
  }
  if (!bodyWallet || bodyWallet !== sessionWallet) {
    void reply.code(403).send({
      error: "Wallet in request body does not match authenticated session.",
      sessionWallet,
    });
    return false;
  }
  return true;
}
