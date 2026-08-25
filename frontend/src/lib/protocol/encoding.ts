/**
 * Minimal borsh encoding for Persat program instructions.
 *
 * The programs are Anchor 1.x, but npm ships no 1.x JS client, so instructions
 * are serialized directly — the same scheme `contracts/scripts/devnet-init.mjs`
 * uses and the LiteSVM suites exercise on-chain: an 8-byte discriminator
 * (see discriminators.ts) followed by borsh arguments in declaration order.
 * Fixed-width types are little-endian, pubkeys are 32 raw bytes, enums are
 * their u8 variant index, and options are 0x00/0x01-prefixed.
 */
import { PublicKey } from "@solana/web3.js";
import { DISCRIMINATORS, type InstructionName } from "./discriminators";

export const disc = (name: InstructionName): Buffer =>
  Buffer.from(DISCRIMINATORS[name], "hex");

export const u8 = (n: number): Buffer => {
  const b = Buffer.alloc(1);
  b.writeUInt8(n & 0xff, 0);
  return b;
};

export const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
};

export const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
};

export const u64 = (n: number | bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
};

export const bool = (v: boolean): Buffer => u8(v ? 1 : 0);

export const pubkey = (p: PublicKey): Buffer => Buffer.from(p.toBuffer());

export const zeroPubkey = (): Buffer => Buffer.alloc(32);

/** borsh Option<Pubkey>: 0x00 for none, 0x01 + 32 bytes for some. */
export const optionPubkey = (p: PublicKey | null): Buffer =>
  p === null ? u8(0) : Buffer.concat([u8(1), pubkey(p)]);

/** Anchor unit-variant enum: just the variant index. */
export const enumVariant = (index: number): Buffer => u8(index);

/** 16-byte deal identifier. */
export const dealIdBytes = (id: Uint8Array): Buffer => {
  if (id.length !== 16) throw new Error("deal id must be exactly 16 bytes");
  return Buffer.from(id);
};
