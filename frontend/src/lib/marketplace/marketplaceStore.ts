"use client";
import { useState, useEffect, useCallback } from "react";
import { getProfileByWalletOrUsername } from "@/lib/profile/userProfile";
import { api } from "@/lib/api";

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
  source: "onchain" | "client" | "backend";
}

const STORAGE_KEY = "persat_marketplace_listings_live_v2";
const CACHE_TTL_MS = 15000;

function getStored(): MarketplaceListing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function setStored(listings: MarketplaceListing[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(listings.slice(0, 200)));
  } catch {}
}

export function saveListing(listing: MarketplaceListing): void {
  if (typeof window === "undefined") return;
  const current = getStored().filter((l) => l.dealId !== listing.dealId);
  current.unshift(listing);
  setStored(current);
}

let backendCache: { at: number; data: MarketplaceListing[] } | null = null;

async function fetchBackendListings(): Promise<MarketplaceListing[] | null> {
  const now = Date.now();
  if (backendCache && now - backendCache.at < CACHE_TTL_MS) return backendCache.data;
  try {
    const res = await api.marketplaceListings();
    if (!res?.listings) return null;
    // Backend returns proposals, map to listings if needed — for now return null to keep client as source
    // In full indexer, this would query Deal Registry public deals via RPC
    return null;
  } catch {
    return null;
  }
}

export function useMarketplaceListings() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Try backend first, fallback to localStorage (crash-proof)
      const backend = await fetchBackendListings();
      const stored = getStored();

      // Merge: backend wins, but keep client listings that aren't in backend yet
      let merged: MarketplaceListing[] = [];
      if (backend && backend.length > 0) {
        const backendIds = new Set(backend.map((l) => l.dealId));
        merged = [...backend, ...stored.filter((s) => !backendIds.has(s.dealId))];
      } else {
        merged = stored;
      }

      // Sort by recency, cap at 100 to prevent render crash under pump
      merged = merged.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
      setListings(merged);
      setStored(merged);
      if (backend) backendCache = { at: Date.now(), data: backend };
    } catch (e) {
      setError((e as Error).message);
      setListings(getStored());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Poll every 30s for live marketplace — with backoff if tab hidden
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load();
    }, 30000);
    return () => clearInterval(id);
  }, [load]);

  const postListing = useCallback(
    (data: Omit<MarketplaceListing, "id" | "creatorHandle" | "reputation" | "createdAt" | "source">) => {
      const prof = getProfileByWalletOrUsername(data.creatorWallet);
      const handle = prof?.username ?? `user_${data.creatorWallet.slice(0, 4)}`;
      const newListing: MarketplaceListing = {
        ...data,
        id: `list_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        creatorHandle: handle,
        reputation: prof?.reputationScore ?? 100,
        createdAt: Date.now(),
        source: "client",
      };
      saveListing(newListing);
      setListings(getStored());
      return newListing;
    },
    [],
  );

  const removeListing = useCallback((dealId: string) => {
    const filtered = getStored().filter((l) => l.dealId !== dealId);
    setStored(filtered);
    setListings(filtered);
  }, []);

  return { listings, loading, error, postListing, removeListing, reloadListings: load };
}
