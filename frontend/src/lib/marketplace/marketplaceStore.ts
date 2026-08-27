"use client";
import { useState, useEffect, useCallback } from "react";
import { getProfileByWalletOrUsername } from "@/lib/profile/userProfile";

export interface MarketplaceListing {
  id: string;
  dealId: string;
  creatorWallet: string;
  creatorHandle: string;
  side: "borrow" | "lend";
  principal: string;
  currency: "USDC" | "USDT";
  rateBps: number;
  months: number;
  collateralBtc: string;
  reputation: number;
  dealUrlId: string;
  createdAt: number;
}

const STORAGE_MARKETPLACE_KEY = "persat_marketplace_listings_live_v1";

function getStoredListings(): MarketplaceListing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_MARKETPLACE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveListing(listing: MarketplaceListing): void {
  if (typeof window === "undefined") return;
  const current = getStoredListings().filter((l) => l.dealId !== listing.dealId);
  current.unshift(listing);
  localStorage.setItem(STORAGE_MARKETPLACE_KEY, JSON.stringify(current));
}

export function useMarketplaceListings() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);

  const load = useCallback(() => {
    setListings(getStoredListings());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const postListing = useCallback(
    (data: Omit<MarketplaceListing, "id" | "creatorHandle" | "reputation" | "createdAt">) => {
      const prof = getProfileByWalletOrUsername(data.creatorWallet);
      const handle = prof?.username ? prof.username : `user_${data.creatorWallet.slice(0, 4)}`;
      const newListing: MarketplaceListing = {
        ...data,
        id: `list_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        creatorHandle: handle,
        reputation: prof?.reputationScore ?? 100,
        createdAt: Date.now(),
      };
      saveListing(newListing);
      setListings(getStoredListings());
      return newListing;
    },
    [],
  );

  return { listings, postListing, reloadListings: load };
}
