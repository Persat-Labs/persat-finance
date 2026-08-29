import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { config, assertProdConfig } from "./config.js";
import { walletAuthRoutes } from "./routes/walletAuth.js";
import { marketplaceRoutes } from "./routes/marketplace.js";
import { dealLinkRoutes } from "./routes/dealLinks.js";
import { bridgeRoutes } from "./routes/bridge.js";
import { oracleRoutes } from "./routes/oracle.js";
import { faucetRoutes } from "./routes/faucet.js";
import { closeDatabase } from "./database.js";
import { fetchBtcUsdPrice } from "./services/oracle.js";
import { getBridgeHealth } from "./services/bridge.js";
import { startKeeper, stopKeeper } from "./services/keeper.js";

assertProdConfig();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? (config.nodeEnv === "production" ? "info" : "debug"),
  },
  trustProxy: true,
  requestIdHeader: "x-request-id",
  genReqId: () => crypto.randomUUID(),
});

// Security & sensible
await app.register(helmet, {
  contentSecurityPolicy: false, // Next.js handles CSP
});
await app.register(sensible);

// CORS — strict, no wildcard in prod
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin, curl, mobile
    if (config.corsOrigins.length === 0) return cb(null, true); // dev fallback
    if (config.corsOrigins.includes(origin)) return cb(null, true);
    // Allow vercel preview and localhost for dev
    if (origin.includes("localhost") || origin.includes("vercel.app") || origin.includes("persat")) {
      return cb(null, true);
    }
    cb(new Error("CORS not allowed"), false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
});

// Rate limiting — prevents crash under pump
await app.register(rateLimit, {
  global: true,
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindowMs,
  addHeaders: {
    "x-ratelimit-limit": true,
    "x-ratelimit-remaining": true,
    "x-ratelimit-reset": true,
  },
  errorResponseBuilder: () => ({
    error: "Too many requests — slow down to protect devnet RPC.",
    retryAfterSeconds: Math.ceil(config.rateLimitWindowMs / 1000),
  }),
});

// Health — dependency-aware, fails open for monitoring but reports status
app.get("/health", async () => {
  const checks: Record<string, string> = {
    storage: config.persistentStoreConfigured ? "configured" : "not_configured",
    rpc: config.rpcConfigured ? "configured" : "public_fallback",
    cluster: config.cluster,
  };

  let dbStatus = "not_configured";
  if (config.persistentStoreConfigured) {
    try {
      const { requireDatabase } = await import("./database.js");
      await requireDatabase();
      dbStatus = "ok";
    } catch (e) {
      dbStatus = `error: ${(e as Error).message.slice(0, 100)}`;
    }
  }

  let oracleStatus: string | null = null;
  try {
    const price = await fetchBtcUsdPrice();
    oracleStatus = price ? `${price.price.toFixed(2)} USD, stale=${price.isStale}` : "unreachable";
  } catch {
    oracleStatus = "error";
  }

  let bridgeStatus = "unknown";
  try {
    const health = await getBridgeHealth();
    const available = health.filter((h) => h.available).length;
    bridgeStatus = `${available}/${health.length} available`;
  } catch {
    bridgeStatus = "error";
  }

  return {
    ok: true,
    service: "persat-api",
    version: "0.1.0",
    cluster: config.cluster,
    checks,
    dependencies: {
      database: dbStatus,
      oracle: oracleStatus,
      bridges: bridgeStatus,
    },
    timestamp: new Date().toISOString(),
  };
});

// Routes — order matters: public first, then protected inside each module
await app.register(walletAuthRoutes);
await app.register(bridgeRoutes);
await app.register(oracleRoutes);
await app.register(faucetRoutes);
await app.register(marketplaceRoutes);
await app.register(dealLinkRoutes);

// 404 handler
app.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ error: "Not found", path: request.url });
});

// Global error handler — never leak stack in prod
app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const status = (error as any).statusCode ?? 500;
  const message = (error as any).message ?? "Internal error";
  reply.code(status).send({
    error: status >= 500 ? "Internal server error — try again." : message,
    requestId: request.id,
  });
});

const port = config.port;
await app.listen({ port, host: "0.0.0.0" });
console.log(`✅ Persat API listening on 0.0.0.0:${port} — cluster=${config.cluster} — env=${config.nodeEnv}`);

// Start keeper after server is listening (non-blocking, unrefed)
startKeeper();

// Graceful shutdown — prevents crash on deploy + stops keeper
const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const sig of signals) {
  process.on(sig, async () => {
    app.log.info(`Received ${sig}, shutting down gracefully...`);
    try {
      stopKeeper();
      await app.close();
      await closeDatabase();
      process.exit(0);
    } catch (e) {
      app.log.error(e, "Error during shutdown");
      process.exit(1);
    }
  });
}
