"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useWalletSession } from "@/lib/session";

export interface UserProfile {
  /** Server-issued opaque UUID (stable over time) — never invented by the client. */
  id?: string;
  /** Primary identity — Solana wallet address (SIWS-bound). */
  wallet: string;
  username: string;
  displayName: string;
  bio: string;
  avatarSeed: string;
  reputationScore: number;
  totalDeals: number;
  activeLoans: number;
  joinedAt: string;
  createdAt?: string;
  updatedAt?: string;
}

const STORAGE_PROFILES_KEY = "persat_profiles_live_v2";

/** Normalize a raw username: trim, lowercase, drop leading '@'. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

export function getStoredProfiles(): Record<string, UserProfile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_PROFILES_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Low-level cache write (no availability validation) — for server-verified profiles. */
function writeCache(profile: UserProfile): void {
  if (typeof window === "undefined") return;
  const current = getStoredProfiles();
  const clean = normalizeUsername(profile.username);
  const prev = current[profile.wallet];
  if (prev && prev.username && normalizeUsername(prev.username) !== clean) {
    delete current[normalizeUsername(prev.username)];
    if (prev.id) delete current[prev.id];
  }
  const stored: UserProfile = { ...profile, username: clean };
  current[profile.wallet] = stored;
  current[clean] = stored;
  if (stored.id) current[stored.id] = stored;
  try {
    localStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(current));
  } catch {
    // storage full / private mode — ignore
  }
}

export function cacheProfile(profile: UserProfile): void {
  writeCache(profile);
}

/** Local synchronous availability check (format + cache). Server is the source of truth. */
export function isUsernameAvailable(
  username: string,
  myWallet: string | null | undefined,
): { available: boolean; reason?: string } {
  const clean = normalizeUsername(username);

  if (!clean) {
    return { available: false, reason: "Username cannot be empty." };
  }
  if (clean.length < 3) {
    return { available: false, reason: "Username must be at least 3 characters." };
  }
  if (clean.length > 20) {
    return { available: false, reason: "Username cannot exceed 20 characters." };
  }
  if (!/^[a-z0-9_]+$/.test(clean)) {
    return { available: false, reason: "Only letters, numbers, and underscores allowed." };
  }

  const current = getStoredProfiles();
  for (const [, prof] of Object.entries(current)) {
    if (prof.username && normalizeUsername(prof.username) === clean) {
      if (prof.wallet !== myWallet) {
        return { available: false, reason: `@${clean} is already claimed by another wallet.` };
      }
    }
  }

  return { available: true };
}

/**
 * Server-authoritative availability check. Calls the API; falls back to local
 * only when the backend is unreachable (so the UI stays responsive). The server
 * still enforces uniqueness on PUT (409) — this is UX only.
 */
export async function checkUsernameAvailable(
  username: string,
  myWallet?: string | null,
): Promise<{ available: boolean; reason?: string }> {
  const clean = normalizeUsername(username);
  const local = isUsernameAvailable(clean, myWallet);
  if (!local.available) return local;

  try {
    const res = await api.profilesUsernameAvailable(clean, myWallet ?? undefined);
    if (res?.available === false) {
      return { available: false, reason: res.reason ?? `@${clean} is already claimed.` };
    }
    return { available: true };
  } catch {
    // Offline — rely on the (optimistic) local check; server enforces on save.
    return local;
  }
}

/**
 * Save to the offline cache WITHOUT treating it as source of truth. This is a
 * display/local fallback only; the server PUT is what persists.
 */
export function saveProfile(profile: UserProfile): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: true };
  const cleanUsername = normalizeUsername(profile.username);
  const check = isUsernameAvailable(cleanUsername, profile.wallet);
  if (!check.available) {
    return { ok: false, error: check.reason };
  }
  const updatedProfile: UserProfile = { ...profile, username: cleanUsername };
  writeCache(updatedProfile);
  return { ok: true };
}

export function getProfileByWalletOrUsername(identifier: string): UserProfile | null {
  if (!identifier) return null;
  const current = getStoredProfiles();
  const trimmed = identifier.trim().toLowerCase().replace(/^@/, "");
  return current[identifier] || current[trimmed] || null;
}

/** Map a server profile (snake_case DB fields) to the client shape. */
export function profileFromServer(sp: Record<string, unknown>): UserProfile {
  return {
    id: (sp.id as string) ?? undefined,
    wallet: sp.wallet as string,
    username: (sp.username as string) ?? "",
    displayName: (sp.display_name as string) ?? `@${sp.username ?? ""}`,
    bio: (sp.bio as string) ?? "",
    avatarSeed: (sp.avatar_seed as string) ?? "",
    reputationScore: Number(sp.reputation_score ?? 100),
    totalDeals: Number(sp.total_deals ?? 0),
    activeLoans: Number(sp.active_loans ?? 0),
    createdAt: (sp.created_at as string | undefined) ?? undefined,
    updatedAt: (sp.updated_at as string | undefined) ?? undefined,
    joinedAt: formatJoinedAt(sp.created_at as string | undefined),
  };
}

/** Convert a created_at date to a compact "Sep 2026" label. */
function formatJoinedAt(createdAt?: string): string {
  if (!createdAt) return "New member";
  try {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return "New member";
    return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  } catch {
    return "New member";
  }
}

/** Build a default profile in-memory (display fallback only — never sent as source of truth). */
function makeLocalDefault(wallet: string): UserProfile {
  const baseHandle = `user_${wallet.slice(0, 4)}${wallet.slice(-4)}`.toLowerCase();
  return {
    wallet,
    username: baseHandle,
    displayName: `@${baseHandle}`,
    bio: "",
    avatarSeed: wallet.slice(0, 8),
    reputationScore: 100,
    totalDeals: 0,
    activeLoans: 0,
    joinedAt: "New member",
  };
}

/**
 * Fetch a profile by wallet or username from the server (public). Returns null
 * if the server has no row (or is unreachable) — caller decides the fallback.
 */
export async function fetchProfileByIdentifier(
  identifier: string,
  token?: string | null,
): Promise<UserProfile | null> {
  try {
    const res = await api.profileGet(identifier);
    if (res?.profile) {
      const p = profileFromServer(res.profile);
      cacheProfile(p);
      return p;
    }
    // Public read returned nothing — but if this is my wallet with a session,
    // get-or-create via /me.
    if (token && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(identifier)) {
      const me = await api.profilesMe(token);
      // Wallet addresses are case-sensitive base58 — compare against the raw
      // identifier, never a lowercased/normalized form.
      if (me?.profile && me.profile.wallet === identifier) {
        const p = profileFromServer(me.profile);
        cacheProfile(p);
        return p;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * React hook: after wallet connect + optional SIWS sign-in, fetch the profile
 * from the API and hydrate the UI. The server (or a server-created default row)
 * is the source of truth; localStorage is only an offline cache.
 */
export function useProfile(
  walletAddress: string | null | undefined,
  opts?: { token?: string | null },
) {
  const { token: sessionToken } = useWalletSession();
  const token = opts?.token ?? sessionToken;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!walletAddress) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    // 1) Session token → get-or-create own profile.
    if (token) {
      try {
        const res = await api.profilesMe(token);
        if (res?.profile) {
          const p = profileFromServer(res.profile);
          setProfile(p);
          cacheProfile(p);
          setLoading(false);
          return;
        }
      } catch {
        // token stale / API down → try public read below
      }
    }

    // 2) Public read by wallet (covers a profile created from another browser).
    try {
      const res = await api.profileGet(walletAddress);
      if (res?.profile) {
        const p = profileFromServer(res.profile);
        setProfile(p);
        cacheProfile(p);
        setLoading(false);
        return;
      }
    } catch {
      // 404 or network → fallback to cache
    }

    // 3) Offline cache, else a local default so the UI is never blank.
    const cached = getProfileByWalletOrUsername(walletAddress);
    setProfile(cached ?? makeLocalDefault(walletAddress));
    setLoading(false);
  }, [walletAddress, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateProfile = useCallback(
    async (updates: Partial<UserProfile>): Promise<{ ok: boolean; error?: string }> => {
      if (!profile) return { ok: false, error: "No profile loaded" };
      const updated = { ...profile, ...updates };

      // Server first — only the API can persist a profile.
      if (token) {
        try {
          const res = await api.profileUpdate(
            {
              username: normalizeUsername(updated.username),
              display_name: updated.displayName,
              bio: updated.bio,
              avatar_seed: updated.avatarSeed,
            },
            token,
          );
          if (res?.profile) {
            const p = profileFromServer(res.profile);
            setProfile(p);
            cacheProfile(p);
            return { ok: true };
          }
          if (res?.error) return { ok: false, error: res.error };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("409") || msg.includes("already taken")) {
            return { ok: false, error: "That username is already taken." };
          }
          // Offline / server unreachable → fall back to cache (not source of truth).
        }
      }

      const saved = saveProfile(updated);
      if (saved.ok) {
        setProfile(updated);
        cacheProfile(updated);
      }
      return saved;
    },
    [profile, token],
  );

  return { profile, updateProfile, reloadProfile: load, loading, error };
}
