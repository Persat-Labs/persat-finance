/**
 * Human-readable transaction failures.
 *
 * Two layers: wallet/RPC-level failures (rejected signature, insufficient
 * funds, expired blockhash, wrong network…) and Anchor custom errors, which
 * are 6000 + variant index for the program that raised them. Anchor logs
 * attribute failures as `Program <pubkey> failed: custom program error: 0x…`,
 * so the failing program is identified by comparing against PROGRAM_IDS.
 * The per-program message lists mirror the `#[error_code]` enums in
 * declaration order.
 */
import type { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS } from "./config";

export type FailureKind =
  | "wallet-rejected"
  | "insufficient-funds"
  | "blockhash-expired"
  | "wrong-network"
  | "state-changed"
  | "program-error"
  | "rpc-unavailable"
  | "timeout"
  | "unknown";

export type Failure = {
  kind: FailureKind;
  message: string;        // shown to the user
  raw?: string;           // for logs and support
  programErrorCode?: number;
};

// Variant order mirrors each #[error_code] enum exactly.
const VAULT_ERRORS = [
  "Authority must not be the default public key.",
  "Amount must be greater than zero.",
  "The vault is not accepting deposits.",
  "The vault is not locked.",
  "The vault does not hold enough collateral for this action.",
  "Only the borrower recorded on this vault may deposit.",
  "Only the authorized protocol program may perform this action.",
  "The token mint does not match the collateral recorded for this vault.",
  "The supplied vault token account is not the one recorded for this vault.",
  "Collateral may only be released to the borrower who posted it.",
  "A vault arithmetic operation overflowed.",
];

const DEAL_ERRORS = [
  "Invalid authority.",
  "Invalid principal.",
  "Invalid collateral.",
  "The rate is above the protocol maximum.",
  "Unsupported duration.",
  "Invalid LTV.",
  "Invalid counterparty.",
  "A wallet cannot be both sides of its own loan.",
  "A public listing cannot bind a counterparty up front.",
  "Invalid state transition.",
  "Counterparty not bound yet.",
  "The terms do not match the deal being confirmed.",
  "Unauthorized program authority.",
  "Already confirmed.",
  "The deal is no longer open.",
];

const LOAN_ERRORS = [
  "Invalid authority.",
  "Invalid terms.",
  "The fee would leave the borrower with nothing.",
  "Arithmetic overflow.",
  "The loan is not in a repayable state.",
  "Only the borrower may make a payment.",
  "Mint mismatch.",
  "Invalid token account owner.",
  "The payment must match the installment exactly.",
  "Nothing is due yet.",
  "The loan is already fully paid.",
  "The loan is not overdue.",
  "The default grace window has not closed.",
];

const ERROR_TABLES: { id: PublicKey; messages: string[] }[] = [
  { id: PROGRAM_IDS.escrowVault, messages: VAULT_ERRORS },
  { id: PROGRAM_IDS.dealRegistry, messages: DEAL_ERRORS },
  { id: PROGRAM_IDS.loanLifecycle, messages: LOAN_ERRORS },
];

export function describeFailure(error: unknown): Failure {
  const err = error as { message?: string; logs?: string[]; toString?: () => string };
  const raw = [err?.message ?? (typeof error === "string" ? error : err?.toString?.() ?? ""), ...(err?.logs ?? [])].join("\n");
  const text = raw.toLowerCase();

  if (text.includes("user rejected") || text.includes("userdenied") || text.includes("user rejected the request")) {
    return { kind: "wallet-rejected", message: "You rejected the transaction in your wallet.", raw };
  }
  const systemError1 = /custom program error: 0x1(?![0-9a-f])/i.test(raw);
  if (text.includes("insufficient lamports") || text.includes("insufficient funds") || systemError1) {
    return { kind: "insufficient-funds", message: "Not enough SOL or tokens for this action (remember transaction fees).", raw };
  }
  if (text.includes("blockhash not found") || text.includes("transaction expired") || text.includes("block height exceeded")) {
    return { kind: "blockhash-expired", message: "The transaction expired before confirming. Nothing was spent — please try again.", raw };
  }
  if (text.includes("unsupported rpc") || (text.includes("cluster") && text.includes("mismatch"))) {
    return { kind: "wrong-network", message: "Your wallet is connected to the wrong network. Switch to Devnet.", raw };
  }
  if (text.includes("fetch failed") || text.includes("econnrefused") || text.includes("socket hang up") || text.includes("failed to fetch")) {
    return { kind: "rpc-unavailable", message: "Cannot reach the Devnet RPC endpoint. Please retry in a moment.", raw };
  }
  if (text.includes("account in use") || text.includes("already in use") || text.includes("has been previously processed")) {
    return { kind: "state-changed", message: "The on-chain state changed while submitting. Refresh and try again.", raw };
  }

  // Anchor custom errors: `Program <pubkey> failed: custom program error: 0x…`
  const codeMatch = raw.match(/custom program error: 0x([0-9a-f]+)/i);
  if (codeMatch) {
    const code = parseInt(codeMatch[1], 16);
    if (code >= 6000) {
      const programLine = raw.split("\n").find((line) => line.includes("failed: custom program error"));
      const programEntry = programLine
        ? ERROR_TABLES.find(({ id }) => programLine.includes(id.toBase58()))
        : undefined;
      const index = code - 6000;
      const message = programEntry?.messages[index] ?? "The program rejected this action.";
      return { kind: "program-error", message, raw, programErrorCode: code };
    }
    return { kind: "program-error", message: "The program rejected this action.", raw, programErrorCode: code };
  }

  if (text.includes("timeout")) {
    return { kind: "timeout", message: "Confirmation timed out. Check the transaction in explorer before retrying.", raw };
  }
  return { kind: "unknown", message: "Something went wrong. Please try again.", raw };
}
