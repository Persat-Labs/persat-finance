/**
 * Pyth pull-oracle service — Hermes fetch with caching, staleness check, fail-closed.
 * No protocol-held pusher key: clients post signed Hermes updates themselves.
 */
import { config } from "../config.js";

type PythPrice = {
  price: number; // USD price
  conf: number;
  publishTime: number; // unix seconds
  isStale: boolean;
  maxConfidenceBps: number;
};

const CACHE_TTL_MS = 5_000; // 5s cache to avoid hammering Hermes under load
let cache: { at: number; price: PythPrice | null } = { at: 0, price: null };
let inFlight: Promise<PythPrice | null> | null = null;

export async function fetchBtcUsdPrice(): Promise<PythPrice | null> {
  const now = Date.now();
  if (cache.price && now - cache.at < CACHE_TTL_MS) return cache.price;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const url = `${config.pythHermesUrl}/v2/updates/price/latest?ids[]=${config.btcUsdFeedId}&encoding=base64`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Hermes ${res.status}`);
      const json: any = await res.json();
      // Hermes returns parsed[].price.price, conf, publish_time
      const parsed = json?.parsed?.[0];
      if (!parsed) throw new Error("No parsed price in Hermes response");
      const priceRaw = Number(parsed.price?.price);
      const expo = Number(parsed.price?.expo);
      const confRaw = Number(parsed.price?.conf);
      const publishTime = Number(parsed.price?.publish_time);

      // Pyth price = price * 10^expo
      const price = priceRaw * Math.pow(10, expo);
      const conf = confRaw * Math.pow(10, expo);
      const confBps = price > 0 ? (conf / price) * 10_000 : 999_999;
      const ageSec = Math.floor(Date.now() / 1000) - publishTime;
      const isStale = ageSec > 60; // matches contracts/config/devnet.json stalenessThreshold

      const result: PythPrice = {
        price,
        conf,
        publishTime,
        isStale,
        maxConfidenceBps: Math.round(confBps),
      };
      cache = { at: Date.now(), price: result };
      return result;
    } catch (err) {
      console.warn("[oracle] Hermes fetch failed", (err as Error).message);
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function getBtcUsdPriceOrFail(): Promise<PythPrice> {
  const price = await fetchBtcUsdPrice();
  if (!price) throw new Error("BTC/USD price unavailable — oracle unreachable");
  if (price.isStale) throw new Error(`BTC/USD price stale — ${Math.floor(Date.now() / 1000) - price.publishTime}s old`);
  if (price.maxConfidenceBps > 200) throw new Error(`BTC/USD confidence too wide — ${price.maxConfidenceBps}bps > 200bps`);
  return price;
}
