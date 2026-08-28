"use client";
/**
 * Bridge health client — implements Technical Architecture rule 5:
 * Auto-routing requires 3 signals, missing data => manual, never guessed.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

export type BridgeId = "tbtc" | "zbtc";
export type BridgeHealth = {
  id: BridgeId;
  available: boolean;
  reason?: string;
  pauseStatus?: "active" | "paused";
  successRate?: number;
  liquidityUsd?: number;
  lastChecked: string;
};

export type BridgeHealthResponse = {
  mode: "auto" | "partial_auto" | "fail_closed";
  bestBridge: BridgeId | null;
  bridges: BridgeHealth[];
  timestamp: string;
};

const CACHE_TTL = 30000;
let cache: { at: number; data: BridgeHealthResponse | null } = { at: 0, data: null };

export async function getBridgeHealth(): Promise<BridgeHealthResponse> {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL) return cache.data;

  try {
    const data = await api.bridgeHealth();
    if (data?.bridges) {
      cache = { at: now, data };
      return data;
    }
  } catch {}

  // Fail-closed fallback
  const fallback: BridgeHealthResponse = {
    mode: "fail_closed",
    bestBridge: null,
    bridges: [
      { id: "tbtc", available: false, reason: "Bridge health unavailable — manual selection required.", lastChecked: new Date().toISOString() },
      { id: "zbtc", available: false, reason: "Bridge health unavailable — manual selection required.", lastChecked: new Date().toISOString() },
    ],
    timestamp: new Date().toISOString(),
  };
  return fallback;
}

export function useBridgeHealth(pollMs = 30000) {
  const [health, setHealth] = useState<BridgeHealthResponse | null>(cache.data);
  const [loading, setLoading] = useState(!cache.data);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const h = await getBridgeHealth();
      setHealth(h);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const best = health?.bestBridge ?? null;
  const isAuto = health?.mode === "auto";
  const isFailClosed = health?.mode === "fail_closed";

  return { health, bestBridge: best, isAuto, isFailClosed, loading, refresh };
}
