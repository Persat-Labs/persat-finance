"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { MINTS, OPERATOR } from "./config";

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
  usdcAmount?: number;
  usdtAmount?: number;
  zbtcAmount?: number;
}

export interface DispenseResult {
  ok: boolean;
  signature?: string;
  explorerUrl?: string;
  error?: string;
}

export async function dispenseTestnetAssets(opts: DispenseOptions): Promise<DispenseResult> {
  const { connection, deployerKeypair, recipient } = opts;
  const tx = new Transaction();
  let count = 0;

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

  const tokenList = [
    { symbol: "tBTC", amount: opts.tbtcAmount, mint: MINTS.tBTC, decimals: 8 },
    { symbol: "USDC", amount: opts.usdcAmount, mint: MINTS.USDC, decimals: 6 },
    { symbol: "USDT", amount: opts.usdtAmount, mint: MINTS.USDT, decimals: 6 },
    { symbol: "zBTC", amount: opts.zbtcAmount, mint: MINTS.zBTC, decimals: 8 },
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
      preflightCommitment: "confirmed",
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
      // Ignore storage access errors
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
      // Corrupt storage
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
