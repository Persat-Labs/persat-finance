/**
 * Instruction builders for the Persat lifecycle.
 *
 * Account orders and argument orders mirror the `#[derive(Accounts)]` structs
 * and handler signatures in the program sources exactly. Builders are pure:
 * they return TransactionInstructions; signing, fees, and confirmation are
 * handled by tx.ts.
 *
 * Flow model (the programs contain no cross-program CPIs, so some transitions
 * are signed by the operator wallet recorded in each program's config):
 *
 *   borrower   : proposeDeal → (confirm) initializeVault → depositCollateral
 *   operator   : lockVault → beginFunding
 *   lender     : activateLoan
 *   operator   : markActive
 *   borrower   : makePayment / repayInFull
 *   anyone     : flagDefault (state check grants authority, not identity)
 *   keeper     : evaluate / executePartialLiquidation / executeFullLiquidation
 *   operator   : seizeCollateral → markLiquidated → closeDeal, releaseCollateral
 */
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { bool, dealIdBytes, disc, enumVariant, optionPubkey, pubkey, u16, u64 } from "./encoding";
import { OPERATOR, PROGRAM_IDS } from "./config";
import { loanConfigPda, registryConfigPda, TOKEN_PROGRAM_ID } from "./pdas";
import type { DealTermsInput } from "./terms";

const ix = (programId: PublicKey, data: Buffer, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]): TransactionInstruction =>
  new TransactionInstruction({ programId, keys, data });

const signer = (p: PublicKey, writable = true) => ({ pubkey: p, isSigner: true, isWritable: writable });
const writer = (p: PublicKey) => ({ pubkey: p, isSigner: false, isWritable: true });
const reader = (p: PublicKey) => ({ pubkey: p, isSigner: false, isWritable: false });
const SYS = SystemProgram.programId;

/* ------------------------------------------------------------------ deal registry */

export const Visibility = { Private: 0, Public: 1 } as const;
export const Side = { Borrower: 0, Lender: 1 } as const;
export const CloseOutcome = { Completed: 0, PartiallyLiquidated: 1, FullyLiquidated: 2 } as const;

/** propose_deal(deal_id, terms, visibility, creator_side, counterparty) */
export function proposeDeal(input: {
  creator: PublicKey;
  dealId: Uint8Array;
  terms: DealTermsInput;
  visibility: (typeof Visibility)[keyof typeof Visibility];
  creatorSide: (typeof Side)[keyof typeof Side];
  counterparty: PublicKey | null;
  dealPda: PublicKey;
}): TransactionInstruction {
  const terms = input.terms;
  return ix(
    PROGRAM_IDS.dealRegistry,
    Buffer.concat([
      disc("proposeDeal"),
      dealIdBytes(input.dealId),
      u64(terms.principalAtoms),
      pubkey(terms.loanMint),
      pubkey(terms.collateralMint),
      u64(terms.collateralAtoms),
      u16(terms.rateBps),
      u16(terms.durationMonths),
      u16(terms.ltvBps),
      enumVariant(input.visibility),
      enumVariant(input.creatorSide),
      optionPubkey(input.counterparty),
    ]),
    [signer(input.creator), writer(input.dealPda), reader(SYS)],
  );
}

/** confirm_deal(expected_terms_hash) */
export function confirmDeal(input: { confirmer: PublicKey; dealPda: PublicKey; expectedTermsHash: Uint8Array }): TransactionInstruction {
  if (input.expectedTermsHash.length !== 32) throw new Error("terms hash must be 32 bytes");
  return ix(
    PROGRAM_IDS.dealRegistry,
    Buffer.concat([disc("confirmDeal"), Buffer.from(input.expectedTermsHash)]),
    [signer(input.confirmer), writer(input.dealPda)],
  );
}

export function cancelDeal(input: { creator: PublicKey; dealPda: PublicKey }): TransactionInstruction {
  return ix(PROGRAM_IDS.dealRegistry, disc("cancelDeal"), [signer(input.creator), writer(input.dealPda)]);
}

/** begin_funding / mark_active — signed by the operator (escrow/loan authority). */
export function beginFunding(input: { operator: PublicKey; dealPda: PublicKey }): TransactionInstruction {
  return ix(PROGRAM_IDS.dealRegistry, disc("beginFunding"), [
    signer(input.operator), writer(input.dealPda), reader(registryConfigPda()),
  ]);
}

export function markActive(input: { operator: PublicKey; dealPda: PublicKey }): TransactionInstruction {
  return ix(PROGRAM_IDS.dealRegistry, disc("markActive"), [
    signer(input.operator), writer(input.dealPda), reader(registryConfigPda()),
  ]);
}

/** close_deal(outcome) — authority is the loan (Completed) or liquidation (FullyLiquidated) authority. */
export function closeDeal(input: { operator: PublicKey; dealPda: PublicKey; outcome: (typeof CloseOutcome)[keyof typeof CloseOutcome] }): TransactionInstruction {
  return ix(
    PROGRAM_IDS.dealRegistry,
    Buffer.concat([disc("closeDeal"), enumVariant(input.outcome)]),
    [signer(input.operator), writer(input.dealPda), reader(registryConfigPda())],
  );
}

/* ------------------------------------------------------------------ escrow vault */

/** initialize_vault(deal_id, loan_authority, liquidation_authority) — borrower creates the vault. */
export function initializeVault(input: {
  borrower: PublicKey;
  dealId: Uint8Array;
  vaultPda: PublicKey;
  vaultTokenAccount: PublicKey;
  collateralMint: PublicKey;
}): TransactionInstruction {
  return ix(
    PROGRAM_IDS.escrowVault,
    Buffer.concat([
      disc("initializeVault"),
      dealIdBytes(input.dealId),
      pubkey(OPERATOR), // loan authority: the operator signs lock/release
      pubkey(OPERATOR), // liquidation authority: the operator signs seizure
    ]),
    [
      signer(input.borrower),
      writer(input.vaultPda),
      reader(input.collateralMint),
      writer(input.vaultTokenAccount),
      reader(TOKEN_PROGRAM_ID),
      reader(SYS),
    ],
  );
}

/** deposit_collateral(amount) — borrower → vault token account. */
export function depositCollateral(input: {
  borrower: PublicKey;
  vaultPda: PublicKey;
  collateralMint: PublicKey;
  borrowerTokenAccount: PublicKey;
  vaultTokenAccount: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  return ix(
    PROGRAM_IDS.escrowVault,
    Buffer.concat([disc("depositCollateral"), u64(input.amount)]),
    [
      writer(input.vaultPda),
      signer(input.borrower),
      reader(input.collateralMint),
      writer(input.borrowerTokenAccount),
      writer(input.vaultTokenAccount),
      reader(TOKEN_PROGRAM_ID),
    ],
  );
}

/** lock_vault(required_atoms) — operator only. */
export function lockVault(input: { operator: PublicKey; vaultPda: PublicKey; requiredAtoms: bigint }): TransactionInstruction {
  return ix(
    PROGRAM_IDS.escrowVault,
    Buffer.concat([disc("lockVault"), u64(input.requiredAtoms)]),
    [writer(input.vaultPda), signer(input.operator)],
  );
}

/** release_collateral() — operator only, on completion. */
export function releaseCollateral(input: {
  operator: PublicKey;
  vaultPda: PublicKey;
  collateralMint: PublicKey;
  vaultTokenAccount: PublicKey;
  borrowerTokenAccount: PublicKey;
}): TransactionInstruction {
  return ix(
    PROGRAM_IDS.escrowVault,
    disc("releaseCollateral"),
    [
      writer(input.vaultPda),
      signer(input.operator),
      reader(input.collateralMint),
      writer(input.vaultTokenAccount),
      writer(input.borrowerTokenAccount),
      reader(TOKEN_PROGRAM_ID),
    ],
  );
}

/** seize_collateral(amount) — operator only, driving liquidation outcomes. */
export function seizeCollateral(input: {
  operator: PublicKey;
  vaultPda: PublicKey;
  collateralMint: PublicKey;
  vaultTokenAccount: PublicKey;
  recipientTokenAccount: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  return ix(
    PROGRAM_IDS.escrowVault,
    Buffer.concat([disc("seizeCollateral"), u64(input.amount)]),
    [
      writer(input.vaultPda),
      signer(input.operator),
      reader(input.collateralMint),
      writer(input.vaultTokenAccount),
      writer(input.recipientTokenAccount),
      reader(TOKEN_PROGRAM_ID),
    ],
  );
}

/* ------------------------------------------------------------------ loan lifecycle */

/** activate_loan(deal_id, principal, rate, duration, collateral, treasury_fee) — lender funds. */
export function activateLoan(input: {
  lender: PublicKey;
  borrower: PublicKey;
  dealId: Uint8Array;
  loanPda: PublicKey;
  loanMint: PublicKey;
  lenderTokenAccount: PublicKey;
  borrowerTokenAccount: PublicKey;
  treasuryTokenAccount: PublicKey;
  principalAtoms: bigint;
  rateBps: number;
  durationMonths: number;
  collateralAtoms: bigint;
  treasuryFeeAtoms: bigint;
}): TransactionInstruction {
  return ix(
    PROGRAM_IDS.loanLifecycle,
    Buffer.concat([
      disc("activateLoan"),
      dealIdBytes(input.dealId),
      u64(input.principalAtoms),
      u16(input.rateBps),
      u16(input.durationMonths),
      u64(input.collateralAtoms),
      u64(input.treasuryFeeAtoms),
    ]),
    [
      signer(input.lender),
      reader(input.borrower),
      writer(input.loanPda),
      reader(input.loanMint),
      writer(input.lenderTokenAccount),
      writer(input.borrowerTokenAccount),
      writer(input.treasuryTokenAccount),
      reader(TOKEN_PROGRAM_ID),
      reader(SYS),
    ],
  );
}

/** make_payment(amount) — borrower pays the exact installment. */
export function makePayment(input: {
  loanPda: PublicKey;
  borrower: PublicKey;
  loanMint: PublicKey;
  borrowerTokenAccount: PublicKey;
  lenderTokenAccount: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  return ix(
    PROGRAM_IDS.loanLifecycle,
    Buffer.concat([disc("makePayment"), u64(input.amount)]),
    [
      writer(input.loanPda),
      signer(input.borrower),
      reader(input.loanMint),
      writer(input.borrowerTokenAccount),
      writer(input.lenderTokenAccount),
      reader(TOKEN_PROGRAM_ID),
    ],
  );
}

/** repay_in_full() — borrower settles the whole remaining schedule. */
export function repayInFull(input: {
  loanPda: PublicKey;
  borrower: PublicKey;
  loanMint: PublicKey;
  borrowerTokenAccount: PublicKey;
  lenderTokenAccount: PublicKey;
}): TransactionInstruction {
  return ix(
    PROGRAM_IDS.loanLifecycle,
    disc("repayInFull"),
    [
      writer(input.loanPda),
      signer(input.borrower),
      reader(input.loanMint),
      writer(input.borrowerTokenAccount),
      writer(input.lenderTokenAccount),
      reader(TOKEN_PROGRAM_ID),
    ],
  );
}

/** flag_default() — anyone may report a genuinely overdue loan. */
export function flagDefault(input: { reporter: PublicKey; loanPda: PublicKey }): TransactionInstruction {
  return ix(PROGRAM_IDS.loanLifecycle, disc("flagDefault"), [writer(input.loanPda), signer(input.reporter)]);
}

/** mark_liquidated(fully) — operator (configured liquidation authority) only. */
export function markLiquidated(input: { operator: PublicKey; loanPda: PublicKey; fully: boolean }): TransactionInstruction {
  return ix(
    PROGRAM_IDS.loanLifecycle,
    Buffer.concat([disc("markLiquidated"), bool(input.fully)]),
    [writer(input.loanPda), signer(input.operator), reader(loanConfigPda())],
  );
}

export { SYSTEM_PROGRAM_ID } from "./pdas";
