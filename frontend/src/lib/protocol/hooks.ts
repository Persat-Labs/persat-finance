"use client";
/**
 * React glue between the wallet-adapter context and the protocol client.
 */
import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { TransactionInstruction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { sendAndConfirm, type SendResult } from "./tx";
import { OPERATOR } from "./config";

export type PendingState = { busy: boolean; result: SendResult | null };

export function useProtocol() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [state, setState] = useState<PendingState>({ busy: false, result: null });

  const publicKey = wallet.publicKey;
  const isOperator = useMemo(() => Boolean(publicKey && publicKey.equals(OPERATOR)), [publicKey]);

  /** Send instructions, creating any missing associated token accounts first. */
  const send = useCallback(
    async (instructions: TransactionInstruction[], mintsForAtas: PublicKey[] = []): Promise<SendResult> => {
      if (!publicKey || !wallet.signTransaction) {
        const failureResult: SendResult = {
          ok: false,
          failure: { kind: "wallet-rejected", message: "Connect your wallet first." },
        };
        setState({ busy: false, result: failureResult });
        return failureResult;
      }
      setState({ busy: true, result: null });
      const prep: TransactionInstruction[] = [];
      for (const mint of mintsForAtas) {
        const ata = getAssociatedTokenAddressSync(mint, publicKey, false, TOKEN_PROGRAM_ID);
        const info = await connection.getAccountInfo(ata);
        if (!info) prep.push(createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, mint, TOKEN_PROGRAM_ID));
      }
      const all = [...prep, ...instructions];
      if (all.length === 0) {
        const emptyResult: SendResult = { ok: true, signature: "", explorerUrl: "" };
        setState({ busy: false, result: emptyResult });
        return emptyResult;
      }
      const result = await sendAndConfirm(connection, { publicKey, signTransaction: wallet.signTransaction }, all);
      setState({ busy: false, result });
      return result;
    },
    [connection, publicKey, wallet.signTransaction],
  );

  const ataOf = useCallback(
    (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID),
    [],
  );

  const clear = useCallback(() => setState({ busy: false, result: null }), []);

  return { connection, wallet, publicKey, isOperator, send, ataOf, pending: state, clear };
}

/** Encode/decode 16-byte deal ids for URLs — browser-safe base64url (no Buffer base64url dep). */
function bytesToBase64Url(bytes: Uint8Array): string {
  // Browser-safe: btoa + url-safe replace, no Buffer dependency
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa works in browser, in Node we have global Buffer fallback
  let base64: string;
  if (typeof btoa !== "undefined") {
    base64 = btoa(binary);
  } else {
    // Node fallback
    base64 = Buffer.from(bytes).toString("base64");
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(text: string): Uint8Array | null {
  try {
    let base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad) base64 += "=".repeat(4 - pad);
    let binary: string;
    if (typeof atob !== "undefined") {
      binary = atob(base64);
    } else {
      const buf = Buffer.from(base64, "base64");
      return new Uint8Array(buf);
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export const dealIdToUrl = (id: Uint8Array) => bytesToBase64Url(id);
export const dealIdFromUrl = (text: string): Uint8Array | null => {
  const bytes = base64UrlToBytes(text);
  return bytes && bytes.length === 16 ? bytes : null;
};

export function randomDealId(): Uint8Array {
  const id = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(id);
  else for (let i = 0; i < 16; i += 1) id[i] = Math.floor(Math.random() * 256);
  return id;
}
