import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireDatabase } from "../database.js";
import { createDealLinkToken, hashDealLinkToken } from "../domain/dealLinks.js";

const createSchema = z.object({ dealId: z.string().min(1), initiatorWallet: z.string().min(32).max(44), expiresInMinutes: z.number().int().min(5).max(1_440).default(60) });
const claimSchema = z.object({ wallet: z.string().min(32).max(44) });
export async function dealLinkRoutes(app: FastifyInstance) {
  app.post("/v1/deal-links", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid deal-link request" });
    try { const db = await requireDatabase(); const { token, tokenHash } = createDealLinkToken(); const p = parsed.data;
      await db.query("insert into deal_links (deal_id, token_hash, initiator_wallet, expires_at) values ($1, $2, $3, now() + ($4 || ' minutes')::interval)", [p.dealId, tokenHash, p.initiatorWallet, p.expiresInMinutes]);
      return reply.code(201).send({ token, expiresInMinutes: p.expiresInMinutes });
    } catch (error) { request.log.error(error); return reply.code(503).send({ error: "Deal-link service requires persistent storage." }); }
  });
  app.post("/v1/deal-links/:token/claim", async (request, reply) => {
    const parsed = claimSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "Invalid wallet" });
    try { const db = await requireDatabase(); const tokenHash = hashDealLinkToken((request.params as { token: string }).token); const result = await db.query(
      `update deal_links set claimed_by_wallet = $1, claimed_at = now() where token_hash = $2 and claimed_at is null and expires_at > now() returning deal_id`, [parsed.data.wallet, tokenHash]);
      if (result.rowCount !== 1) return reply.code(410).send({ error: "This deal link is invalid, expired, or already used." });
      return { dealId: result.rows[0].deal_id, claimed: true };
    } catch (error) { request.log.error(error); return reply.code(503).send({ error: "Deal-link service requires persistent storage." }); }
  });
}
