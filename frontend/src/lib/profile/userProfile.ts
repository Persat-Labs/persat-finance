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

const STORAGE_PROFILES_KEY = "persat_profiles_live_v1";

function getStoredProfiles(): Record<string, UserProfile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_PROFILES_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveProfile(profile: UserProfile): void {
  if (typeof window === "undefined") return;
  const current = getStoredProfiles();
  current[profile.wallet] = profile;
  // Index by lowercase username as well
  if (profile.username) {
    current[profile.username.toLowerCase().replace(/^@/, "")] = profile;
  }
  localStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(current));
}

export function getProfileByWalletOrUsername(identifier: string): UserProfile | null {
  if (!identifier) return null;
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
      // Initialize a real profile for this connected wallet
      const handle = `user_${walletAddress.slice(0, 4)}${walletAddress.slice(-4)}`.toLowerCase();
      const initial: UserProfile = {
        wallet: walletAddress,
        username: handle,
        displayName: `@${handle}`,
        bio: "",
        avatarSeed: walletAddress.slice(0, 8),
        reputationScore: 100,
        totalDeals: 0,
        activeLoans: 0,
        joinedAt: new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" }),
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
