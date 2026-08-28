"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pyth oracle client — real architecture, fail-closed, cached, crash-proof.
 * Mirrors backend/services/oracle.ts and contracts price_oracle logic.
 */

import { useCallback, useEffect, useState } from "react";
import { PYTH } from "./config";
import { api } from "../api";

export type BtcPrice = {
  price: number;
  conf: number;
  confBps: number;
  publishTime: number;
  ageSeconds: number;
  isStale: boolean;
  source: "backend" | "hermes_direct";
};

const CACHE_TTL = 5000;
let cache: { at: number; data: BtcPrice | null } = { at: 0, data: null };

async function fetchFromBackend(): Promise<BtcPrice | null> {
  try {
    const data = await api.btcPrice();
    if (!data || data.error) return null;
    return {
      price: data.price,
      conf: data.confidence,
      confBps: data.confidenceBps,
      publishTime: data.publishTime,
      ageSeconds: data.ageSeconds,
      isStale: data.isStale,
      source: "backend",
    };
  } catch {
    return null;
  }
}

async function fetchDirectHermes(): Promise<BtcPrice | null> {
  try {
    const url = `${PYTH.hermesUrl}/v2/updates/price/latest?ids[]=${PYTH.btcUsdFeedId}&encoding=base64`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    const parsed = json?.parsed?.[0];
    if (!parsed) return null;
    const priceRaw = Number(parsed.price?.price);
    const expo = Number(parsed.price?.expo);
    const confRaw = Number(parsed.price?.conf);
    const publishTime = Number(parsed.price?.publish_time);
    const price = priceRaw * Math.pow(10, expo);
    const conf = confRaw * Math.pow(10, expo);
    const confBps = price > 0 ? (conf / price) * 10000 : 999999;
    const ageSeconds = Math.floor(Date.now() / 1000) - publishTime;
    return {
      price,
      conf,
      confBps: Math.round(confBps),
      publishTime,
      ageSeconds,
      isStale: ageSeconds > 60,
      source: "hermes_direct",
    };
  } catch {
    return null;
  }
}

export async function getBtcPrice(): Promise<BtcPrice | null> {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL) return cache.data;

  // Try backend first (cached, rate-limited), fallback to direct Hermes
  let price = await fetchFromBackend();
  if (!price) price = await fetchDirectHermes();

  if (price) cache = { at: now, data: price };
  return price;
}

export function useBtcPrice(pollMs = 15000) {
  const [price, setPrice] = useState<BtcPrice | null>(cache.data);
  const [loading, setLoading] = useState(!cache.data);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const p = await getBtcPrice();
      if (p) {
        setPrice(p);
        setError(p.isStale ? `Price stale ${p.ageSeconds}s — oracle blocked` : p.confBps > 200 ? `Confidence too wide ${p.confBps}bps` : null);
      } else {
        setError("BTC price unavailable — Hermes unreachable");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const isFailClosed = !price || price.isStale || price.confBps > 200;

  return { price, loading, error, isFailClosed, refresh };
}
