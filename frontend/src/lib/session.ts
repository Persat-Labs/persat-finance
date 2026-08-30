"use client";
/**
 * Wallet session (SIWS-style) — how Persat traces a session.
 *
 * Flow:
 *  1. Connect wallet (Phantom) — holds keys; never sent to our servers
 *  2. POST /v1/auth/challenge { wallet } → one-time message + challengeId
 *  3. wallet.signMessage(message) — user approval in extension
 *  4. POST /v1/auth/verify { challengeId, signature } → Bearer session token
 *  5. API writes send Authorization: Bearer <token>; server binds actions to session wallet
 *
 * What Inspect/DevTools CAN do: edit HTML/CSS, fake UI labels.
 * What it CANNOT do: forge Solana tx signatures, forge SIWS message sigs, or use
 * another wallet's session without their private key.
 *
 * On-chain truth never depends on this token — only wallet-signed transactions do.
 * The token only protects off-chain API (deal-links, marketplace proposals, etc.).
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import {
  api,
  clearStoredAuthToken,
  getStoredAuthToken,
  setStoredAuthToken,
} from "@/lib/api";

const TOKEN_KEY = "persat_auth_token_v1";
const WALLET_KEY = "persat_auth_wallet_v1";

export type SessionState = {
  /** Raw Bearer token (null if not signed in to API) */
  token: string | null;
  /** Wallet the token was issued for */
  sessionWallet: string | null;
  /** Connected wallet adapter pubkey */
  connectedWallet: string | null;
  /** token present and matches connected wallet */
  authenticated: boolean;
  /** challenge/verify in flight */
  busy: boolean;
  error: string | null;
  /** backend mode from last status/me call */
  mode: string | null;
  /** true when NEXT_PUBLIC_BACKEND_URL is empty — chain-only Mode W */
  apiConfigured: boolean;
};

function readStoredWallet(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(WALLET_KEY);
  } catch {
    return null;
  }
}

function writeStoredWallet(wallet: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (wallet) localStorage.setItem(WALLET_KEY, wallet);
    else localStorage.removeItem(WALLET_KEY);
  } catch {
    //
  }
}

export function useWalletSession() {
  const { publicKey, signMessage, connected, disconnecting } = useWallet();
  const connectedWallet = publicKey ? publicKey.toBase58() : null;
  // Same-origin /v1 proxy or absolute BACKEND_URL — always try session (Inspect still cannot forge sigs)
  const apiConfigured = true;

  const [token, setToken] = useState<string | null>(null);
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once
  useEffect(() => {
    setToken(getStoredAuthToken());
    setSessionWallet(readStoredWallet());
    setHydrated(true);
  }, []);

  // Drop session if wallet disconnects or switches
  useEffect(() => {
    if (!hydrated) return;
    if (!connectedWallet) {
      if (token) {
        clearStoredAuthToken();
        writeStoredWallet(null);
        setToken(null);
        setSessionWallet(null);
      }
      return;
    }
    if (sessionWallet && sessionWallet !== connectedWallet) {
      clearStoredAuthToken();
      writeStoredWallet(null);
      setToken(null);
      setSessionWallet(null);
      setError("Wallet changed — sign in again for API session.");
    }
  }, [connectedWallet, sessionWallet, token, hydrated]);

  // Validate existing token against /v1/auth/me when possible
  useEffect(() => {
    if (!hydrated || !apiConfigured || !token || !connectedWallet) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api.authMe(token);
        if (cancelled) return;
        if (me?.wallet && me.wallet === connectedWallet) {
          setSessionWallet(me.wallet);
          writeStoredWallet(me.wallet);
          setMode(me.mode ?? null);
        } else {
          clearStoredAuthToken();
          writeStoredWallet(null);
          setToken(null);
          setSessionWallet(null);
        }
      } catch {
        // stale token or API down — clear so UI shows Sign in
        clearStoredAuthToken();
        writeStoredWallet(null);
        setToken(null);
        setSessionWallet(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, apiConfigured, token, connectedWallet]);

  const signIn = useCallback(async () => {
    setError(null);
    if (!apiConfigured) {
      setError("API not configured (Mode W) — on-chain actions still use wallet signatures only.");
      return null;
    }
    if (!publicKey || !signMessage) {
      setError("Connect a wallet that supports message signing (Phantom).");
      return null;
    }
    const wallet = publicKey.toBase58();
    setBusy(true);
    try {
      const challenge = await api.authChallenge(wallet);
      if (!challenge?.challengeId || !challenge?.message) {
        throw new Error("Challenge response incomplete");
      }
      const messageBytes = new TextEncoder().encode(challenge.message as string);
      const sigBytes = await signMessage(messageBytes);
      const signature = bs58.encode(sigBytes);
      const verified = await api.authVerify(challenge.challengeId as string, signature, wallet);
      if (!verified?.token) throw new Error("No session token returned");
      setStoredAuthToken(verified.token);
      writeStoredWallet(verified.wallet || wallet);
      setToken(verified.token);
      setSessionWallet(verified.wallet || wallet);
      setMode(verified.mode ?? null);
      return verified.token as string;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("User rejected") || msg.includes("rejected") ? "Sign-in cancelled in wallet." : msg);
      return null;
    } finally {
      setBusy(false);
    }
  }, [apiConfigured, publicKey, signMessage]);

  const signOut = useCallback(async () => {
    const t = getStoredAuthToken();
    if (t && apiConfigured) {
      try {
        await api.authLogout(t);
      } catch {
        //
      }
    }
    clearStoredAuthToken();
    writeStoredWallet(null);
    setToken(null);
    setSessionWallet(null);
    setError(null);
  }, [apiConfigured]);

  const authenticated = Boolean(
    token && sessionWallet && connectedWallet && sessionWallet === connectedWallet,
  );

  return {
    token,
    sessionWallet,
    connectedWallet,
    authenticated,
    busy,
    error,
    mode,
    apiConfigured,
    hydrated,
    signIn,
    signOut,
    connected: Boolean(connected && publicKey),
    disconnecting: Boolean(disconnecting),
  } satisfies SessionState & {
    hydrated: boolean;
    signIn: () => Promise<string | null>;
    signOut: () => Promise<void>;
    connected: boolean;
    disconnecting: boolean;
  };
}

/** Prefer session token helper for API calls */
export function authHeaders(): Record<string, string> {
  const t = getStoredAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export { TOKEN_KEY };
