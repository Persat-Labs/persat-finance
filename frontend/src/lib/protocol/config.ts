/**
 * Devnet protocol configuration — public information only.
 *
 * Program addresses match `contracts/Anchor.toml` and `contracts/config/devnet.json`
 * (the deploy keypairs live in repository secrets; only public keys appear here).
 * Mint addresses are created by the deployment initializer and recorded in
 * `ops/handoff/devnet-deployed.json`; they are pasted here after the first
 * deploy. Nothing in this file is secret.
 */
import { PublicKey } from "@solana/web3.js";

export const CLUSTER = "devnet" as const;
export const DEFAULT_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const PROGRAM_IDS = {
  governance: new PublicKey("gSCWC42bnn8XbRNXt7FdoGPGqG5dkfMihqYj8xhGwuj"),
  priceOracle: new PublicKey("8udyx5YywfH7KTk6WyaECzaqenyni4JQrWpF5y774qgc"),
  assetWhitelist: new PublicKey("F9m5MaeNeLurf1A3fuwL9EEP6ZNJ6e46UqnW26LvjqSe"),
  dealRegistry: new PublicKey("2jGypEsuyB31ZFUfgLvLLEEAJHdWdMoVimeWWTrzGks2"),
  escrowVault: new PublicKey("ETZyNBxrn43GApFkiAwfEimzWC93P7nEdSQMcT8Snmy3"),
  loanLifecycle: new PublicKey("HLsDiU1oABybsQhXxnodvoG9tngwTDZGeKwMG5i9Lo3p"),
  liquidationEngine: new PublicKey("C2nL9d8EyyeEz5XQiJVLACMjN9S8GVBvxV9FQ65VTtUx"),
  feeTreasury: new PublicKey("Gnq8qb2Rmnua296VcQ7KHZsuav5ZnWTsP39xCYv8aK5V"),
} as const;

/**
 * The operator (keeper) wallet. The programs contain no cross-program CPIs,
 * so these transitions are signed directly by this wallet:
 * lock_vault, begin_funding, mark_active, close_deal, release_collateral,
 * seize_collateral, mark_liquidated, record_origination_fee.
 * Vaults MUST be initialized with this address as both authorities.
 * Devnet MVP: governance signer 1 doubles as the operator.
 */
export const OPERATOR = new PublicKey("99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD");

/**
 * Fee destination wallet (devnet: governance signer 1, matching the
 * initializer's placeholder fallback). Origination fees flow to this wallet's
 * associated token accounts, which the keeper prepares once after deploy.
 */
export const TREASURY = OPERATOR;

/** Stand-in mint addresses, filled from devnet-deployed.json after first deploy. */
export const MINTS: Record<"tBTC" | "zBTC" | "BTC" | "USDC" | "USDT", PublicKey | null> = {
  tBTC: new PublicKey("79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg"),
  zBTC: new PublicKey("DqQ1yzTPsfpuMMyuV6mVBvusxpq9mqmTTJZ4yMUQwQEt"),
  BTC: new PublicKey("79ALd5ZPZNRLSwaWgFKbtffSSNFDS3TZh3faVbgdNhDg"),
  USDC: new PublicKey("FsSPdkdWnb8R7oziaiYFvhMbhHT7Sd9Uq55t88B7Muqe"),
  USDT: new PublicKey("8zdnnnuNJPNDkGTCxREnTyKnRo494By7MrDSTYtRx1aJ"),
};

/** Pyth pull-oracle constants (identical on every cluster). */
export const PYTH = {
  receiverProgram: new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"),
  btcUsdFeedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  hermesUrl: "https://hermes.pyth.network",
} as const;

export const explorerAddress = (key: string | PublicKey, cluster = CLUSTER) =>
  `https://explorer.solana.com/address/${key.toString()}?cluster=${cluster}`;

export const explorerTx = (signature: string, cluster = CLUSTER) =>
  `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
