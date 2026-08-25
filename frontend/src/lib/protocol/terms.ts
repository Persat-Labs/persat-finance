/**
 * Deal terms hashing — mirrors `DealTerms::hash()` in deal_registry exactly:
 * SHA-256 over the fixed 86-byte little-endian field layout
 * (u64 principal, loan mint, collateral mint, u64 collateral,
 *  u16 rate, u16 duration, u16 ltv).
 */
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "./sha256";

export type DealTermsInput = {
  principalAtoms: bigint;
  loanMint: PublicKey;
  collateralMint: PublicKey;
  collateralAtoms: bigint;
  rateBps: number;
  durationMonths: number;
  ltvBps: number;
};

export function serializeTerms(terms: DealTermsInput): Buffer {
  const buffer = Buffer.alloc(86);
  buffer.writeBigUInt64LE(terms.principalAtoms, 0);
  buffer.set(terms.loanMint.toBuffer(), 8);
  buffer.set(terms.collateralMint.toBuffer(), 40);
  buffer.writeBigUInt64LE(terms.collateralAtoms, 72);
  buffer.writeUInt16LE(terms.rateBps & 0xffff, 80);
  buffer.writeUInt16LE(terms.durationMonths & 0xffff, 82);
  buffer.writeUInt16LE(terms.ltvBps & 0xffff, 84);
  return buffer;
}

export function termsHash(terms: DealTermsInput): Buffer {
  return Buffer.from(sha256(serializeTerms(terms)));
}
