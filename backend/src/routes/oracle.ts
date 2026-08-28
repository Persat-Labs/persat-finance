import type { FastifyInstance } from "fastify";
import { fetchBtcUsdPrice } from "../services/oracle.js";

export async function oracleRoutes(app: FastifyInstance) {
  app.get("/v1/oracle/btc-usd", async (request, reply) => {
    const price = await fetchBtcUsdPrice();
    if (!price) {
      return reply.code(503).send({
        error: "BTC/USD price unavailable — Hermes unreachable",
        isStale: true,
        timestamp: new Date().toISOString(),
      });
    }
    return {
      price: price.price,
      confidence: price.conf,
      confidenceBps: price.maxConfidenceBps,
      publishTime: price.publishTime,
      ageSeconds: Math.floor(Date.now() / 1000) - price.publishTime,
      isStale: price.isStale,
      timestamp: new Date().toISOString(),
    };
  });
}
