import type { FastifyInstance } from "fastify";
import { requireDatabase } from "../database.js";
import { proposalSchema } from "../domain/terms.js";

export async function marketplaceRoutes(app: FastifyInstance) {
  app.post("/v1/marketplace/proposals", async (request, reply) => {
    const parsed = proposalSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid structured proposal", details: parsed.error.flatten() });
    try {
      const db = await requireDatabase();
      const { listingId, proposerWallet, terms } = parsed.data;
      const result = await db.query(
        `insert into marketplace_proposals (listing_id, proposer_wallet, principal_atoms, loan_mint, rate_bps, duration_months, collateral_ltv_bps)
         values ($1, $2, $3, $4, $5, $6, $7) returning id, status, created_at`,
        [listingId, proposerWallet, terms.principalAtoms, terms.loanMint, terms.rateBps, terms.durationMonths, terms.collateralLtvBps],
      );
      return reply.code(201).send({ proposal: result.rows[0] });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ error: "Marketplace proposals are unavailable until persistent storage is configured." });
    }
  });
}
