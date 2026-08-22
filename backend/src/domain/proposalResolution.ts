/**
 * Marketplace terms-mismatch resolution.
 *
 * Technical Architecture section 8.3 defines exactly two outcomes when a
 * listing owner accepts a proposal:
 *
 *  1. Terms match the listing exactly -> call `confirm_deal` on the existing
 *     on-chain Deal. No new deal is created.
 *  2. Terms differ (a genuine counter-negotiation) -> call `cancel_deal` on the
 *     original public listing and create a new Private deal bound to both known
 *     wallets, skipping the deal-link step because both parties are already
 *     established through the marketplace interaction.
 *
 * The second path exists so that `confirm_deal` stays binding-only and never
 * term-mutating. That keeps the audited on-chain surface smaller than adding a
 * term-amendment instruction would.
 *
 * This module is the decision rule alone. It performs no I/O and signs nothing,
 * so the comparison that decides whether someone is bound to different numbers
 * than they posted is directly unit-testable.
 */

import type { StructuredTerms } from "./terms.js";

/** The on-chain action an accepted proposal resolves to. */
export type ResolutionAction = "confirm_existing" | "supersede_with_private_deal";

export type Resolution = {
  action: ResolutionAction;
  /** Fields that differ, for display and audit. Empty when terms match. */
  differingFields: TermField[];
};

export type TermField = keyof StructuredTerms;

/**
 * Every field that forms part of the agreement.
 *
 * Listed explicitly rather than derived from `Object.keys` so that adding a
 * term to the schema cannot silently skip comparison and let a mismatched
 * value through as an exact match.
 */
export const COMPARED_TERM_FIELDS: readonly TermField[] = [
  "principalAtoms",
  "loanMint",
  "rateBps",
  "durationMonths",
  "collateralLtvBps",
] as const;

/**
 * Compare proposed terms against the listing.
 *
 * Comparison is strict and exact. There is deliberately no tolerance band: a
 * proposal that differs by a single basis point is a counter-offer, not a
 * match, and must go down the supersede path where both parties re-confirm.
 */
export function resolveProposal(
  listingTerms: StructuredTerms,
  proposedTerms: StructuredTerms,
): Resolution {
  const differingFields = COMPARED_TERM_FIELDS.filter(
    (field) => !isSameValue(listingTerms[field], proposedTerms[field]),
  );
  return {
    action: differingFields.length === 0 ? "confirm_existing" : "supersede_with_private_deal",
    differingFields,
  };
}

/**
 * Exact equality for a term value.
 *
 * `principalAtoms` is carried as a decimal string because a u64 amount can
 * exceed `Number.MAX_SAFE_INTEGER`. Two strings denoting the same integer must
 * compare equal even if written differently ("100" vs "0100"), so numeric
 * strings are compared as BigInt rather than by text.
 */
function isSameValue(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") {
    if (isUnsignedInteger(left) && isUnsignedInteger(right)) {
      return BigInt(left) === BigInt(right);
    }
    return left === right;
  }
  return left === right;
}

function isUnsignedInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Both wallets in a superseded deal, in borrower/lender order.
 *
 * A listing declares which side its poster is taking, so the proposer always
 * takes the opposite side. Binding both wallets here is what lets the new
 * private deal skip the deal-link step entirely.
 */
export function bindCounterparties(
  listingSide: "borrow" | "lend",
  posterWallet: string,
  proposerWallet: string,
): { borrower: string; lender: string } {
  if (posterWallet === proposerWallet) {
    // A wallet cannot take both sides of its own loan. Allowing it would let
    // one party manufacture repayment history for the reputation signal at no
    // real risk. The on-chain program rejects this too; catching it here gives
    // a clear error before a transaction is ever built.
    throw new Error("A wallet cannot be both borrower and lender on the same deal.");
  }
  return listingSide === "borrow"
    ? { borrower: posterWallet, lender: proposerWallet }
    : { borrower: proposerWallet, lender: posterWallet };
}
