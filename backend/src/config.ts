/** Server configuration deliberately fails closed. Secrets are never defaulted. */
export const config = {
  port: Number(process.env.PORT ?? 4000),
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  rpcUrl: process.env.SOLANA_RPC_URL,
  adminApiKeyConfigured: Boolean(process.env.ADMIN_API_KEY),
  persistentStoreConfigured: Boolean(process.env.PERSAT_DATABASE_URL),
} as const;
