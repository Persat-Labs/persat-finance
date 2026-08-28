import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireDatabase } from "../database.js";
import { createDealLinkToken, hashDealLinkToken } from "../domain/dealLinks.js";
import { requireWalletSession } from "../middleware/auth.js";

const createSchema = z.object({
  dealId: z.string().min(1).max(128),
  initiatorWallet: z.string().min(32).max(44),
  expiresInMinutes: z.number().int().min(5).max(1_440).default(60),
});

const claimSchema = z.object({
  wallet: z.string().min(32).max(44),
});

export async function dealLinkRoutes(app: FastifyInstance) {
  app.post("/v1/deal-links", { preHandler: [requireWalletSession] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid deal-link request", details: parsed.error.flatten() });
    }
    try {
      const db = await requireDatabase();
      const { token, tokenHash } = createDealLinkToken();
      const p = parsed.data;

      const existing = await db.query(`SELECT id FROM deal_links WHERE deal_id = ? AND claimed_at IS NULL AND expires_at > NOW() LIMIT 1`, [p.dealId]);
      if (existing.rowCount === 1) {
        return reply.code(409).send({ error: "An active deal link already exists for this deal." });
      }

      await db.query(
        `INSERT INTO deal_links (id, deal_id, token_hash, initiator_wallet, expires_at) VALUES (UUID(), ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
        [p.dealId, tokenHash, p.initiatorWallet, p.expiresInMinutes],
      );
      return reply.code(201).send({ token, expiresInMinutes: p.expiresInMinutes, dealId: p.dealId });
    } catch (error) {
      request.log.error(error, "[deal-links] create failed");
      if ((error as Error).message.includes("not configured")) {
        return reply.code(503).send({ error: "Deal-link service requires PERSAT_DATABASE_URL (MySQL recommended)" });
      }
      return reply.code(503).send({ error: "Deal-link service unavailable — try again." });
    }
  });

  app.post("/v1/deal-links/:token/claim", async (request, reply) => {
    const parsed = claimSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid wallet" });
    }
    const token = (request.params as { token: string }).token;
    if (!token || token.length < 10) {
      return reply.code(400).send({ error: "Invalid deal-link token" });
    }
    try {
      const db = await requireDatabase();
      const tokenHash = hashDealLinkToken(token);
      // MySQL doesn't support RETURNING, so we do SELECT then UPDATE
      const check = await db.query(`SELECT deal_id FROM deal_links WHERE token_hash = ? AND claimed_at IS NULL AND expires_at > NOW() LIMIT 1`, [tokenHash]);
      if (check.rowCount !== 1) {
        return reply.code(410).send({ error: "This deal link is invalid, expired, or already used — single-use only." });
      }
      await db.query(`UPDATE deal_links SET claimed_by_wallet = ?, claimed_at = NOW() WHERE token_hash = ? AND claimed_at IS NULL`, [parsed.data.wallet, tokenHash]);
      return { dealId: check.rows[0].deal_id, claimed: true, wallet: parsed.data.wallet };
    } catch (error) {
      request.log.error(error, "[deal-links] claim failed");
      return reply.code(503).send({ error: "Deal-link service unavailable — try again." });
    }
  });

  app.get("/v1/deal-links/:token/status", async (request, reply) => {
    const token = (request.params as { token: string }).token;
    if (!token) return reply.code(400).send({ error: "token required" });
    try {
      const db = await requireDatabase();
      const tokenHash = hashDealLinkToken(token);
      const result = await db.query(`SELECT deal_id, initiator_wallet, claimed_by_wallet, expires_at, claimed_at, created_at FROM deal_links WHERE token_hash = ? LIMIT 1`, [tokenHash]);
      if (result.rowCount !== 1) return reply.code(404).send({ error: "Link not found" });
      return result.rows[0];
    } catch {
      return reply.code(503).send({ error: "Deal-link status unavailable" });
    }
  });
}
