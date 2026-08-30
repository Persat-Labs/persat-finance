import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  issueChallenge,
  lookupSessionWallet,
  revokeSession,
  sessionBackendMode,
  verifyChallengeAndCreateSession,
} from "../domain/sessionStore.js";
import { requireWalletSession, getRequestWallet } from "../middleware/auth.js";

const walletSchema = z.object({ wallet: z.string().min(32).max(44) });
const verifySchema = z.object({
  challengeId: z.string().uuid(),
  signature: z.string().min(64),
  /** Optional client-reported wallet — must match challenge wallet after verify */
  wallet: z.string().min(32).max(44).optional(),
});

export async function walletAuthRoutes(app: FastifyInstance) {
  /** Public: how sessions work + current store mode (no secrets). */
  app.get("/v1/auth/status", async () => ({
    ok: true,
    mode: sessionBackendMode(),
    scheme: "SIWS-challenge + Bearer session token",
    notes: [
      "DOM/Inspect edits never grant authority.",
      "On-chain actions require a wallet-signed Solana transaction.",
      "API writes require Authorization: Bearer <session> bound to the signing wallet.",
      "Session is issued only after verifySolanaMessage on a one-time challenge.",
    ],
  }));

  app.post("/v1/auth/challenge", async (request, reply) => {
    const parsed = walletSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid Solana wallet" });
    try {
      const challenge = await issueChallenge(parsed.data.wallet);
      return {
        challengeId: challenge.challengeId,
        message: challenge.message,
        expiresAt: challenge.expiresAt,
        mode: challenge.mode,
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ error: "Wallet authentication is unavailable." });
    }
  });

  app.post("/v1/auth/verify", async (request, reply) => {
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid authentication response" });
    try {
      const result = await verifyChallengeAndCreateSession(parsed.data.challengeId, parsed.data.signature);
      if ("error" in result) return reply.code(result.status).send({ error: result.error });
      if (parsed.data.wallet && parsed.data.wallet !== result.wallet) {
        return reply.code(401).send({ error: "Wallet mismatch — sign with the connected account only." });
      }
      return {
        token: result.token,
        wallet: result.wallet,
        expiresInSeconds: result.expiresInSeconds,
        mode: result.mode,
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ error: "Wallet authentication is unavailable." });
    }
  });

  /** Who am I — proves Bearer token maps to a wallet. */
  app.get("/v1/auth/me", { preHandler: [requireWalletSession] }, async (request) => {
    return {
      wallet: getRequestWallet(request),
      mode: sessionBackendMode(),
      authenticated: true,
    };
  });

  /** Logout — revoke this Bearer token. */
  app.post("/v1/auth/logout", async (request, reply) => {
    const auth = request.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      await revokeSession(auth.slice(7).trim());
    }
    return reply.code(204).send();
  });

  /** Dev/helper: resolve token without exposing hash (auth required). */
  app.post("/v1/auth/introspect", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.code(401).send({ active: false });
    }
    const wallet = await lookupSessionWallet(auth.slice(7).trim());
    if (!wallet) return reply.code(401).send({ active: false });
    return { active: true, wallet, mode: sessionBackendMode() };
  });
}
