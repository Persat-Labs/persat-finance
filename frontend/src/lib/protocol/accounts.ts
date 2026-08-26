/**
 * On-chain account decoding.
 *
 * Anchor stores accounts as an 8-byte `account:<Name>` discriminator followed
 * by the borsh-serialized struct in declaration order. Decoders verify the
 * discriminator and fail closed on any length mismatch.
 */
import type { Connection, PublicKey } from "@solana/web3.js";
import { PublicKey as PK } from "@solana/web3.js";
import { dealPda, loanPda, vaultPda } from "./pdas";
import { sha256 } from "./sha256";

const accountDisc = (name: string) =>
  Buffer.from(sha256(new TextEncoder().encode(`account:${name}`))).subarray(0, 8);

export const DealStates = [
  "proposed", "confirmed", "funding", "active", "repaying", "defaulted",
  "partially_liquidated", "fully_liquidated", "completed", "cancelled",
] as const;
export type DealState = (typeof DealStates)[number];

export const LoanStates = ["active", "defaulted", "partially_liquidated", "fully_liquidated", "completed"] as const;
export type LoanState = (typeof LoanStates)[number];

export const VaultStates = ["open", "locked", "closed"] as const;
export type VaultState = (typeof VaultStates)[number];

export type DecodedDeal = {
  dealId: Uint8Array;
  creator: PublicKey;
  borrower: PublicKey | null;
  lender: PublicKey | null;
  creatorSide: "borrower" | "lender";
  visibility: "private" | "public";
  origin: "direct" | "marketplace";
  state: DealState;
  createdAt: number;
  confirmedAt: number;
  bump: number;
  terms: {
    principalAtoms: bigint;
    loanMint: PublicKey;
    collateralMint: PublicKey;
    collateralAtoms: bigint;
    rateBps: number;
    durationMonths: number;
    ltvBps: number;
  };
};

const isZero = (buf: Buffer) => buf.every((byte) => byte === 0);

class Cursor {
  offset = 0;
  constructor(private buffer: Buffer) {}
  bytes(length: number): Buffer {
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    if (slice.length !== length) throw new Error("account data truncated");
    this.offset += length;
    return slice;
  }
  u16(): number { return this.bytes(2).readUInt16LE(0); }
  u64(): bigint { return this.bytes(8).readBigUInt64LE(0); }
  i64(): number { return Number(this.bytes(8).readBigInt64LE(0)); }
  u8(): number { return this.bytes(1)[0]; }
  key(): PublicKey { return new PK(this.bytes(32)); }
}

export function decodeDeal(data: Buffer): DecodedDeal {
  if (!data.subarray(0, 8).equals(accountDisc("Deal"))) throw new Error("not a Deal account");
  const c = new Cursor(data.subarray(8));
  const dealId = new Uint8Array(c.bytes(16));
  const creator = c.key();
  const borrowerRaw = c.bytes(32);
  const lenderRaw = c.bytes(32);
  const creatorSide = c.u8() === 0 ? "borrower" : "lender";
  const terms = {
    principalAtoms: c.u64(),
    loanMint: c.key(),
    collateralMint: c.key(),
    collateralAtoms: c.u64(),
    rateBps: c.u16(),
    durationMonths: c.u16(),
    ltvBps: c.u16(),
  };
  const visibility = c.u8() === 0 ? "private" : "public";
  const origin = c.u8() === 0 ? "direct" : "marketplace";
  const state = DealStates[c.u8()] ?? "proposed";
  const createdAt = c.i64();
  const confirmedAt = c.i64();
  const bump = c.u8();
  return {
    dealId, creator,
    borrower: isZero(borrowerRaw) ? null : new PK(borrowerRaw),
    lender: isZero(lenderRaw) ? null : new PK(lenderRaw),
    creatorSide, terms, visibility, origin, state, createdAt, confirmedAt, bump,
  };
}

export type DecodedLoan = {
  dealId: Uint8Array;
  borrower: PublicKey;
  lender: PublicKey;
  loanMint: PublicKey;
  principalAtoms: bigint;
  rateBps: number;
  durationMonths: number;
  collateralAtoms: bigint;
  totalRepaymentAtoms: bigint;
  installmentAtoms: bigint;
  finalInstallmentAtoms: bigint;
  paymentsMade: number;
  totalPaidAtoms: bigint;
  activatedAt: number;
  state: LoanState;
  bump: number;
};

export function decodeLoan(data: Buffer): DecodedLoan {
  if (!data.subarray(0, 8).equals(accountDisc("Loan"))) throw new Error("not a Loan account");
  const c = new Cursor(data.subarray(8));
  return {
    dealId: new Uint8Array(c.bytes(16)),
    borrower: c.key(),
    lender: c.key(),
    loanMint: c.key(),
    principalAtoms: c.u64(),
    rateBps: c.u16(),
    durationMonths: c.u16(),
    collateralAtoms: c.u64(),
    totalRepaymentAtoms: c.u64(),
    installmentAtoms: c.u64(),
    finalInstallmentAtoms: c.u64(),
    paymentsMade: c.u16(),
    totalPaidAtoms: c.u64(),
    activatedAt: c.i64(),
    state: LoanStates[c.u8()] ?? "active",
    bump: c.u8(),
  };
}

export type DecodedVault = {
  dealId: Uint8Array;
  borrower: PublicKey;
  collateralMint: PublicKey;
  tokenAccount: PublicKey;
  loanAuthority: PublicKey;
  liquidationAuthority: PublicKey;
  collateralAtoms: bigint;
  state: VaultState;
  bump: number;
};

export function decodeVault(data: Buffer): DecodedVault {
  if (!data.subarray(0, 8).equals(accountDisc("Vault"))) throw new Error("not a Vault account");
  const c = new Cursor(data.subarray(8));
  return {
    dealId: new Uint8Array(c.bytes(16)),
    borrower: c.key(),
    collateralMint: c.key(),
    tokenAccount: c.key(),
    loanAuthority: c.key(),
    liquidationAuthority: c.key(),
    collateralAtoms: c.u64(),
    state: VaultStates[c.u8()] ?? "open",
    bump: c.u8(),
  };
}

/* ------------------------------------------------------------ fetchers */

export async function fetchDeal(connection: Connection, dealId: Uint8Array): Promise<DecodedDeal | null> {
  const info = await connection.getAccountInfo(dealPda(dealId), "confirmed");
  return info ? decodeDeal(Buffer.from(info.data)) : null;
}

export async function fetchLoan(connection: Connection, dealId: Uint8Array): Promise<DecodedLoan | null> {
  const info = await connection.getAccountInfo(loanPda(dealId), "confirmed");
  return info ? decodeLoan(Buffer.from(info.data)) : null;
}

export async function fetchVault(connection: Connection, dealId: Uint8Array): Promise<DecodedVault | null> {
  const info = await connection.getAccountInfo(vaultPda(dealId), "confirmed");
  return info ? decodeVault(Buffer.from(info.data)) : null;
}
