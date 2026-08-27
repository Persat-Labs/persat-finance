"use client";
import { useState, useEffect, useCallback } from "react";

export interface UserProfile {
  wallet: string;
  username: string;
  displayName: string;
  bio: string;
  avatarSeed: string;
  reputationScore: number;
  totalDeals: number;
  activeLoans: number;
  joinedAt: string;
}

const STORAGE_PROFILES_KEY = "persat_profiles_v1";

const DEFAULT_PROFILES: Record<string, UserProfile> = {
  "8mdkcgNT2CDk5G9Pes55SUf7TkMxPpVvpu5wTL2myUWL": {
    wallet: "8mdkcgNT2CDk5G9Pes55SUf7TkMxPpVvpu5wTL2myUWL",
    username: "borrower_alpha",
    displayName: "Alpha Borrower",
    bio: "Long-term Bitcoin hodler leveraging BTC collateral for USD liquidity.",
    avatarSeed: "alpha",
    reputationScore: 98,
    totalDeals: 4,
    activeLoans: 1,
    joinedAt: "August 2026",
  },
  "2G2avktDrH2GTf5bodA6PnLK6zNhAp4Nxfxp4n3maCsX": {
    wallet: "2G2avktDrH2GTf5bodA6PnLK6zNhAp4Nxfxp4n3maCsX",
    username: "lender_prime",
    displayName: "Prime Capital",
    bio: "Providing institutional-grade USDC stablecoin liquidity for BTC-backed loans.",
    avatarSeed: "prime",
    reputationScore: 100,
    totalDeals: 8,
    activeLoans: 2,
    joinedAt: "July 2026",
  },
};

function getStoredProfiles(): Record<string, UserProfile> {
  if (typeof window === "undefined") return DEFAULT_PROFILES;
  try {
    const raw = localStorage.getItem(STORAGE_PROFILES_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(DEFAULT_PROFILES));
      return DEFAULT_PROFILES;
    }
    return { ...DEFAULT_PROFILES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFILES;
  }
}

export function saveProfile(profile: UserProfile): void {
  if (typeof window === "undefined") return;
  const current = getStoredProfiles();
  current[profile.wallet] = profile;
  // Also index by username
  current[profile.username.toLowerCase()] = profile;
  localStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(current));
}

export function getProfileByWalletOrUsername(identifier: string): UserProfile | null {
  const current = getStoredProfiles();
  const trimmed = identifier.trim().toLowerCase().replace(/^@/, "");
  return current[identifier] || current[trimmed] || null;
}

export function useProfile(walletAddress: string | null | undefined) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const load = useCallback(() => {
    if (!walletAddress) {
      setProfile(null);
      return;
    }
    const found = getProfileByWalletOrUsername(walletAddress);
    if (found) {
      setProfile(found);
    } else {
      // Create initial profile for this wallet
      const defaultHandle = `user_${walletAddress.slice(0, 4)}${walletAddress.slice(-4)}`.toLowerCase();
      const initial: UserProfile = {
        wallet: walletAddress,
        username: defaultHandle,
        displayName: `@${defaultHandle}`,
        bio: "Persat Finance protocol participant on Solana Devnet.",
        avatarSeed: walletAddress.slice(0, 6),
        reputationScore: 100,
        totalDeals: 0,
        activeLoans: 0,
        joinedAt: "Today",
      };
      saveProfile(initial);
      setProfile(initial);
    }
  }, [walletAddress]);

  useEffect(() => {
    load();
  }, [load]);

  const updateProfile = useCallback(
    (updates: Partial<UserProfile>) => {
      if (!profile) return;
      const updated = { ...profile, ...updates };
      saveProfile(updated);
      setProfile(updated);
    },
    [profile],
  );

  return { profile, updateProfile, reloadProfile: load };
}
