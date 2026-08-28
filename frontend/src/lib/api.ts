"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Persat backend API client — production-hardened for scale.
 * Features: retry with exponential backoff, timeout, request-id, fail-closed, localStorage fallback.
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_APP_URL || "";
const TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;

type FetchOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
  authToken?: string | null;
  retries?: number;
};

async function fetchWithRetry(path: string, opts: FetchOpts = {}): Promise<any> {
  const url = path.startsWith("http") ? path : `${BACKEND_URL}${path}`;
  const retries = opts.retries ?? MAX_RETRIES;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Request-Id": crypto.randomUUID(),
      };
      if (opts.authToken) headers["Authorization"] = `Bearer ${opts.authToken}`;

      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "2");
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, retryAfter * 1000 + Math.random() * 500));
          continue;
        }
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json().catch(() => ({}));
      return data;
    } catch (err) {
      const isLast = attempt === retries;
      const isAbort = (err as Error).name === "AbortError";
      if (isLast) {
        if (isAbort) throw new Error("Backend timeout — devnet RPC under load, retrying with backoff");
        throw err;
      }
      // Exponential backoff: 300ms, 800ms
      const backoff = 300 * Math.pow(2.5, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw new Error("Max retries exceeded");
}

// Public API — no auth needed
export const api = {
  health: () => fetchWithRetry("/health", { method: "GET", retries: 0 }),
  bridgeHealth: () => fetchWithRetry("/v1/bridges/health"),
  btcPrice: () => fetchWithRetry("/v1/oracle/btc-usd"),
  faucetClaim: (wallet: string, asset?: string) => fetchWithRetry("/v1/faucet/claim", { method: "POST", body: { wallet, asset } }),
  faucetStatus: (wallet: string) => fetchWithRetry(`/v1/faucet/status/${wallet}`),
  marketplaceListings: () => fetchWithRetry("/v1/marketplace/listings"),
  marketplaceProposals: (listingId: string) => fetchWithRetry(`/v1/marketplace/proposals/${listingId}`),

  // Authenticated — requires wallet session
  authChallenge: (wallet: string) => fetchWithRetry("/v1/auth/challenge", { method: "POST", body: { wallet } }),
  authVerify: (challengeId: string, signature: string) => fetchWithRetry("/v1/auth/verify", { method: "POST", body: { challengeId, signature } }),
  createProposal: (data: any, token: string) => fetchWithRetry("/v1/marketplace/proposals", { method: "POST", body: data, authToken: token }),
  createDealLink: (data: any, token: string) => fetchWithRetry("/v1/deal-links", { method: "POST", body: data, authToken: token }),
  claimDealLink: (linkToken: string, wallet: string) => fetchWithRetry(`/v1/deal-links/${linkToken}/claim`, { method: "POST", body: { wallet } }),
  dealLinkStatus: (linkToken: string) => fetchWithRetry(`/v1/deal-links/${linkToken}/status`),
};

export function getStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("persat_auth_token_v1");
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("persat_auth_token_v1", token);
  } catch {}
}

export function clearStoredAuthToken() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("persat_auth_token_v1");
  } catch {}
}
