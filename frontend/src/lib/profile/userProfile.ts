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

const STORAGE_PROFILES_KEY = "persat_profiles_live_v2";

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

export function isUsernameAvailable(
  username: string,
  myWallet: string | null | undefined,
): { available: boolean; reason?: string } {
  const clean = username.trim().toLowerCase().replace(/^@/, "");

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

  // Check if any other profile already owns this username
  for (const [, prof] of Object.entries(current)) {
    if (prof.username && prof.username.toLowerCase() === clean) {
      if (prof.wallet !== myWallet) {
        return { available: false, reason: `@${clean} is already claimed by another wallet.` };
      }
    }
  }

  return { available: true };
}

export function saveProfile(profile: UserProfile): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: true };
  const current = getStoredProfiles();
  const cleanUsername = profile.username.trim().toLowerCase().replace(/^@/, "");

  // Strict availability validation
  const check = isUsernameAvailable(cleanUsername, profile.wallet);
  if (!check.available) {
    return { ok: false, error: check.reason };
  }

  // Remove old handle index if handle changed
  const previousProfile = current[profile.wallet];
  if (previousProfile && previousProfile.username && previousProfile.username.toLowerCase() !== cleanUsername) {
    delete current[previousProfile.username.toLowerCase()];
  }

  const updatedProfile: UserProfile = {
    ...profile,
    username: cleanUsername,
  };

  current[profile.wallet] = updatedProfile;
  current[cleanUsername] = updatedProfile;

  localStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(current));
  return { ok: true };
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
      // Find an available default handle derived from address
      const baseHandle = `user_${walletAddress.slice(0, 4)}${walletAddress.slice(-4)}`.toLowerCase();
      let handle = baseHandle;
      let counter = 1;
      while (!isUsernameAvailable(handle, walletAddress).available) {
        handle = `${baseHandle}_${counter}`;
        counter++;
      }

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
      if (!profile) return { ok: false, error: "No profile loaded" };
      const updated = { ...profile, ...updates };
      const res = saveProfile(updated);
      if (res.ok) {
        setProfile(updated);
      }
      return res;
    },
    [profile],
  );

  return { profile, updateProfile, reloadProfile: load };
}
