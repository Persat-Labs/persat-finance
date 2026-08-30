import type { FastifyInstance } from "fastify";
import { requireDatabase } from "../database.js";
import { proposalSchema } from "../domain/terms.js";
import { getRequestWallet, requireWalletSession } from "../middleware/auth.js";
export async function marketplaceRoutes(app: FastifyInstance) {
  app.get("/v1/marketplace/listings", async (request) => {
    try {
      const db = await requireDatabase();
      const result = await db.query(
        `SELECT id, listing_id, proposer_wallet, principal_atoms, loan_mint, rate_bps, duration_months, collateral_ltv_bps, status, created_at
         FROM marketplace_proposals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100`,
      );
      return { listings: result.rows, count: result.rowCount };
    } catch (err) {
      return { listings: [], count: 0, mode: "no_persistence_fallback_to_client" };
    }
  });

  app.post("/v1/marketplace/proposals", { preHandler: [requireWalletSession] }, async (request, reply) => {
    const parsed = proposalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid structured proposal", details: parsed.error.flatten() });
    }
    try {
      const sessionWallet = getRequestWallet(request);
      if (!sessionWallet) {
        return reply.code(401).send({ error: "Wallet session required." });
      }
      // If client sent a proposerWallet, it must match session — never trust DevTools-edited body alone
      if (parsed.data.proposerWallet && parsed.data.proposerWallet !== sessionWallet) {
        return reply.code(403).send({
          error: "proposerWallet does not match authenticated session.",
          sessionWallet,
        });
      }
      const proposerWallet = sessionWallet;
      const { listingId, terms } = parsed.data;

      const db = await requireDatabase();
      const existing = await db.query(
        `SELECT id FROM marketplace_proposals WHERE listing_id = ? AND proposer_wallet = ? AND status = 'pending' LIMIT 1`,
        [listingId, proposerWallet],
      );
      if (existing.rowCount === 1) {
        return reply.code(409).send({ error: "You already have a pending proposal for this listing." });
      }

      await db.query(
        `INSERT INTO marketplace_proposals (id, listing_id, proposer_wallet, principal_atoms, loan_mint, rate_bps, duration_months, collateral_ltv_bps) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
        [listingId, proposerWallet, terms.principalAtoms, terms.loanMint, terms.rateBps, terms.durationMonths, terms.collateralLtvBps],
      );
      const result = await db.query(
        `SELECT id, status, created_at FROM marketplace_proposals WHERE listing_id = ? AND proposer_wallet = ? ORDER BY created_at DESC LIMIT 1`,
        [listingId, proposerWallet],
      );
      return reply.code(201).send({ proposal: result.rows[0], proposerWallet });
    } catch (error) {
      request.log.error(error, "[marketplace] proposal failed");
      if ((error as Error).message.includes("not configured")) {
        return reply.code(503).send({ error: "Marketplace persistence requires PERSAT_DATABASE_URL (MySQL) — using client fallback." });
      }
      return reply.code(503).send({ error: "Marketplace proposals unavailable — try again." });
    }
  });

  app.get("/v1/marketplace/proposals/:listingId", async (request, reply) => {
    const { listingId } = request.params as { listingId: string };
    if (!listingId) return reply.code(400).send({ error: "listingId required" });
    try {
      const db = await requireDatabase();
      const result = await db.query(
        `SELECT id, proposer_wallet, principal_atoms, loan_mint, rate_bps, duration_months, collateral_ltv_bps, status, created_at FROM marketplace_proposals WHERE listing_id = ? ORDER BY created_at DESC LIMIT 50`,
        [listingId],
      );
      return { listingId, proposals: result.rows };
    } catch {
      return { listingId, proposals: [], mode: "no_persistence" };
    }
  });
}
