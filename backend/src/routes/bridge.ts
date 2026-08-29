import type { FastifyInstance } from "fastify";
import { getBridgeHealth, getBestBridge } from "../services/bridge.js";

export async function bridgeRoutes(app: FastifyInstance) {
  app.get("/v1/bridges/health", async (request) => {
    try {
      const health = await getBridgeHealth();
      const best = getBestBridge(health);
      const allAvailable = health.every((h) => h.available);
      return {
        mode: allAvailable ? "auto" : health.some((h) => h.available) ? "partial_auto" : "fail_closed",
        bestBridge: best?.id ?? null,
        bridges: health,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      request.log.error(err, "[bridge] health check failed");
      // Fail-closed per architecture
      return {
        mode: "fail_closed",
        bestBridge: null,
        bridges: [
          { id: "tbtc", available: false, reason: "Bridge health service unavailable — manual selection required.", lastChecked: new Date().toISOString() },
          { id: "zbtc", available: false, reason: "Bridge health service unavailable — manual selection required.", lastChecked: new Date().toISOString() },
        ],
        timestamp: new Date().toISOString(),
      };
    }
  });
}
