/**
 * Persat Finance backend config — fails closed, no secrets defaulted.
 * Single source of truth for all env-driven behavior.
 */

function requiredEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name] ?? fallback;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function boolEnv(name: string): boolean {
  return Boolean(process.env[name] && process.env[name]!.trim().length > 0);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  /** Devnet for MVP. See contracts/config/devnet.json for why not Solana testnet. */
  cluster: process.env.SOLANA_CLUSTER ?? "devnet",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://dapp.persat.finance",
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  databaseUrl: process.env.PERSAT_DATABASE_URL,
  adminApiKey: process.env.ADMIN_API_KEY,
  // Presence checks — never log values
  adminApiKeyConfigured: boolEnv("ADMIN_API_KEY"),
  persistentStoreConfigured: boolEnv("PERSAT_DATABASE_URL"),
  rpcConfigured: boolEnv("SOLANA_RPC_URL"),
  // Bridge provider keys (optional, health degrades to manual if missing)
  zeusApiKeyConfigured: boolEnv("ZEUS_API_KEY"),
  thresholdApiKeyConfigured: boolEnv("THRESHOLD_API_KEY"),
  // Rate limiting
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 100),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  // Oracle
  pythHermesUrl: process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network",
  btcUsdFeedId: process.env.BTC_USD_FEED_ID ?? "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  // Keeper
  keeperEnabled: boolEnv("KEEPER_KEYPAIR_PATH") || boolEnv("KEEPER_ENABLED"),
  keeperPollSeconds: Number(process.env.KEEPER_POLL_SECONDS ?? 60),
  // Deployer for auto-faucet — server-side minting so users don't need to upload bundle
  deployerKeypairJson: process.env.PERSAT_DEPLOYER_KEYPAIR,
  deployerConfigured: boolEnv("PERSAT_DEPLOYER_KEYPAIR"),
  // CORS
  corsOrigins: (process.env.CORS_ORIGINS ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export function assertProdConfig() {
  if (config.nodeEnv === "production") {
    if (!config.databaseUrl) throw new Error("PERSAT_DATABASE_URL required in production");
    if (!config.rpcUrl || config.rpcUrl.includes("api.devnet.solana.com")) {
      console.warn("[config] Using public devnet RPC in production is not recommended — provision Helius/QuickNode");
    }
  }
}
