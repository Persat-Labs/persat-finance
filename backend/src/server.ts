import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: config.appUrl ?? false });

app.get("/health", async () => ({
  ok: true,
  service: "persat-api",
  storage: config.persistentStoreConfigured ? "configured" : "not_configured",
  rpc: config.rpcUrl ? "configured" : "not_configured",
  timestamp: new Date().toISOString(),
}));

/** Never report a bridge as healthy until provider status, observed success rate, and liquidity are verifiably configured. */
app.get("/v1/bridges/health", async () => ({
  mode: "fail_closed",
  bridges: [
    { id: "tbtc", available: false, reason: "Bridge provider configuration is required before routing deposits." },
    { id: "zbtc", available: false, reason: "Bridge provider configuration is required before routing deposits." },
  ],
}));

// Security boundary: deal-link and marketplace write routes remain unregistered until
// wallet-signature authentication is implemented and tested against deployed programs.
// This prevents an unauthenticated server from binding a wallet or creating protocol state.

await app.listen({ port: config.port, host: "0.0.0.0" });
