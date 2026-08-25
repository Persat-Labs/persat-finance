/**
 * PDA derivations — seeds mirror the `#[derive(Accounts)]` constraints exactly.
 */
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS } from "./config";

const utf8 = (s: string) => Buffer.from(s, "utf8");

/** [b"deal", deal_id] under deal_registry. */
export const dealPda = (dealId: Uint8Array) =>
  PublicKey.findProgramAddressSync([utf8("deal"), Buffer.from(dealId)], PROGRAM_IDS.dealRegistry)[0];

/** [b"vault", deal_id] under escrow_vault. */
export const vaultPda = (dealId: Uint8Array) =>
  PublicKey.findProgramAddressSync([utf8("vault"), Buffer.from(dealId)], PROGRAM_IDS.escrowVault)[0];

/** [b"vault-tokens", deal_id] under escrow_vault. */
export const vaultTokenPda = (dealId: Uint8Array) =>
  PublicKey.findProgramAddressSync([utf8("vault-tokens"), Buffer.from(dealId)], PROGRAM_IDS.escrowVault)[0];

/** [b"loan", deal_id] under loan_lifecycle. */
export const loanPda = (dealId: Uint8Array) =>
  PublicKey.findProgramAddressSync([utf8("loan"), Buffer.from(dealId)], PROGRAM_IDS.loanLifecycle)[0];

export const registryConfigPda = () =>
  PublicKey.findProgramAddressSync([utf8("registry-config")], PROGRAM_IDS.dealRegistry)[0];

export const loanConfigPda = () =>
  PublicKey.findProgramAddressSync([utf8("loan-config")], PROGRAM_IDS.loanLifecycle)[0];

export const oraclePda = () =>
  PublicKey.findProgramAddressSync([utf8("oracle")], PROGRAM_IDS.priceOracle)[0];

export const assetRegistryPda = () =>
  PublicKey.findProgramAddressSync([utf8("asset-registry")], PROGRAM_IDS.assetWhitelist)[0];

/** [b"asset", registry, mint] under asset_whitelist. */
export const assetRecordPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([utf8("asset"), assetRegistryPda().toBuffer(), mint.toBuffer()], PROGRAM_IDS.assetWhitelist)[0];

export const enginePda = () =>
  PublicKey.findProgramAddressSync([utf8("liquidation-engine")], PROGRAM_IDS.liquidationEngine)[0];

export const treasuryPda = () =>
  PublicKey.findProgramAddressSync([utf8("treasury")], PROGRAM_IDS.feeTreasury)[0];

export const governancePda = () =>
  PublicKey.findProgramAddressSync([utf8("governance")], PROGRAM_IDS.governance)[0];

export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
