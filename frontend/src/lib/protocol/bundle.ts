"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { MINTS, OPERATOR } from "./config";

const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const STORAGE_KEY = "persat_devnet_bundle_v1";
const AUTOFUND_KEY = "persat_autofund_enabled_v1";

export function extractKeypair(raw: unknown): Keypair | null {
  try {
    if (!raw) return null;
    let data: unknown = raw;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return null;
      }
    }
    if (data && typeof data === "object" && "keypair" in data) {
      const nested = (data as { keypair: unknown }).keypair;
      return extractKeypair(nested);
    }
    if (Array.isArray(data)) {
      if (data.length === 64) {
        return Keypair.fromSecretKey(Uint8Array.from(data as number[]));
      }
      if (data.length === 32) {
        return Keypair.fromSeed(Uint8Array.from(data as number[]));
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface DispenseOptions {
  connection: Connection;
  deployerKeypair: Keypair;
  recipient: PublicKey;
  solAmount?: number;
  tbtcAmount?: number;
  zbtcAmount?: number;
  btcAmount?: number;
  usdcAmount?: number;
  usdtAmount?: number;
}

export interface DispenseResult {
  ok: boolean;
  signature?: string;
  explorerUrl?: string;
  error?: string;
}

function borshString(s: string) {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}

export function createMetadataInstruction(opts: {
  metadataPda: PublicKey;
  mint: PublicKey;
  authority: PublicKey;
  name: string;
  symbol: string;
  uri: string;
}): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([33]), // CreateMetadataAccountV3 instruction discriminator
    borshString(opts.name),
    borshString(opts.symbol),
    borshString(opts.uri),
    Buffer.from([0, 0]), // sellerFeeBasisPoints = 0
    Buffer.from([0]), // creators = None
    Buffer.from([0]), // collection = None
    Buffer.from([0]), // uses = None
    Buffer.from([1]), // isMutable = true
    Buffer.from([0]), // collectionDetails = None
  ]);

  return new TransactionInstruction({
    programId: METAPLEX_PROGRAM_ID,
    keys: [
      { pubkey: opts.metadataPda, isSigner: false, isWritable: true },
      { pubkey: opts.mint, isSigner: false, isWritable: false },
      { pubkey: opts.authority, isSigner: true, isWritable: false },
      { pubkey: opts.authority, isSigner: true, isWritable: true },
      { pubkey: opts.authority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export async function registerAllMetadata(opts: {
  connection: Connection;
  deployerKeypair: Keypair;
}): Promise<{ ok: boolean; message: string; explorerUrl?: string }> {
  const { connection, deployerKeypair } = opts;
  const tokenMetadataList = [
    {
      symbol: "tBTC",
      name: "Threshold Bitcoin",
      mint: MINTS.tBTC,
      uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/6DNSN2T0GmgSm8gQAbPaK0MmKKhwNsmkXJkE2p0D9z44/metadata.json",
    },
    {
      symbol: "zBTC",
      name: "Zeus Bitcoin",
      mint: MINTS.zBTC,
      uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/metadata.json",
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      mint: MINTS.USDC,
      uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/metadata.json",
    },
    {
      symbol: "USDT",
      name: "Tether USD",
      mint: MINTS.USDT,
      uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/metadata.json",
    },
  ];

  const tx = new Transaction();
  let count = 0;

  for (const item of tokenMetadataList) {
    if (!item.mint) continue;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), item.mint.toBuffer()],
      METAPLEX_PROGRAM_ID,
    );
    const existing = await connection.getAccountInfo(pda);
    if (!existing) {
      tx.add(
        createMetadataInstruction({
          metadataPda: pda,
          mint: item.mint,
          authority: deployerKeypair.publicKey,
          name: item.name,
          symbol: item.symbol,
          uri: item.uri,
        }),
      );
      count++;
    }
  }

  if (count === 0) {
    return { ok: true, message: "Metadata already registered on Devnet for all tokens." };
  }

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = deployerKeypair.publicKey;
    tx.sign(deployerKeypair);

    const raw = tx.serialize();
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

    return {
      ok: true,
      message: `Registered on-chain token metadata & logos for ${count} tokens!`,
      explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to register metadata: ${msg}` };
  }
}

export async function dispenseTestnetAssets(opts: DispenseOptions): Promise<DispenseResult> {
  const { connection, deployerKeypair, recipient } = opts;
  const tx = new Transaction();
  let count = 0;

  // 1. Transfer Devnet SOL for gas
  if (opts.solAmount && opts.solAmount > 0) {
    const lamports = BigInt(Math.round(opts.solAmount * LAMPORTS_PER_SOL));
    tx.add(
      SystemProgram.transfer({
        fromPubkey: deployerKeypair.publicKey,
        toPubkey: recipient,
        lamports,
      }),
    );
    count++;
  }

  // 2. All tokens: tBTC, zBTC, BTC, USDC, USDT
  const tokenList = [
    {
      symbol: "tBTC",
      name: "Threshold Bitcoin",
      amount: opts.tbtcAmount ?? opts.btcAmount,
      mint: MINTS.tBTC,
      decimals: 8,
      uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/6DNSN2T0GmgSm8gQAbPaK0MmKKhwNsmkXJkE2p0D9z44/metadata.json",
    },
    {
      symbol: "zBTC",
      name: "Zeus Bitcoin",
      amount: opts.zbtcAmount,
      mint: MINTS.zBTC,
      decimals: 8,
      uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/metadata.json",
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      amount: opts.usdcAmount,
      mint: MINTS.USDC,
      decimals: 6,
      uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/metadata.json",
    },
    {
      symbol: "USDT",
      name: "Tether USD",
      amount: opts.usdtAmount,
      mint: MINTS.USDT,
      decimals: 6,
      uri: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/metadata.json",
    },
  ];

  for (const item of tokenList) {
    if (!item.amount || item.amount <= 0 || !item.mint) continue;
    const atoms = BigInt(Math.round(item.amount * 10 ** item.decimals));
    const ata = getAssociatedTokenAddressSync(item.mint, recipient, false, TOKEN_PROGRAM_ID);
    const ataInfo = await connection.getAccountInfo(ata);
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          deployerKeypair.publicKey,
          ata,
          recipient,
          item.mint,
          TOKEN_PROGRAM_ID,
        ),
      );
      count++;
    }
    tx.add(
      createMintToInstruction(
        item.mint,
        ata,
        deployerKeypair.publicKey,
        atoms,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
    count++;
  }

  if (count === 0) {
    return { ok: false, error: "No assets selected to dispense." };
  }

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = deployerKeypair.publicKey;
    tx.sign(deployerKeypair);

    const raw = tx.serialize();
    const signature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );

    return {
      ok: true,
      signature,
      explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function useDevnetBundle() {
  const [bundleRaw, setBundleRaw] = useState<string | null>(null);
  const [autoFund, setAutoFund] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setBundleRaw(stored);
      const af = localStorage.getItem(AUTOFUND_KEY);
      if (af !== null) setAutoFund(af === "true");
    } catch {
      //
    }
  }, []);

  const loadBundle = useCallback((jsonString: string) => {
    try {
      const parsed = JSON.parse(jsonString);
      const deployerKp = extractKeypair(parsed.deployer ?? parsed);
      if (!deployerKp) {
        return { ok: false, message: "Could not find a valid deployer keypair in the JSON." };
      }
      localStorage.setItem(STORAGE_KEY, jsonString);
      setBundleRaw(jsonString);
      return { ok: true, message: `Loaded bundle with deployer ${deployerKp.publicKey.toBase58().slice(0, 8)}…` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Invalid JSON file." };
    }
  }, []);

  const unloadBundle = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setBundleRaw(null);
  }, []);

  const setAutoFundEnabled = useCallback((val: boolean) => {
    setAutoFund(val);
    localStorage.setItem(AUTOFUND_KEY, String(val));
  }, []);

  let deployerKeypair: Keypair | null = null;
  let operatorKeypair: Keypair | null = null;

  if (bundleRaw) {
    try {
      const parsed = JSON.parse(bundleRaw);
      deployerKeypair = extractKeypair(parsed.deployer ?? parsed);
      operatorKeypair = extractKeypair(parsed["gov-signer-1"] ?? parsed.gov1);
    } catch {
      //
    }
  }

  const isOperatorAvailable = Boolean(operatorKeypair && operatorKeypair.publicKey.equals(OPERATOR));

  return {
    isLoaded: Boolean(deployerKeypair),
    deployerKeypair,
    operatorKeypair,
    isOperatorAvailable,
    deployerPubkey: deployerKeypair ? deployerKeypair.publicKey.toBase58() : null,
    operatorPubkey: operatorKeypair ? operatorKeypair.publicKey.toBase58() : null,
    loadBundle,
    unloadBundle,
    autoFund,
    setAutoFundEnabled,
  };
}
