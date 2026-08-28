"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from "react";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MINTS } from "./config";

export interface UserBalanceData {
  connected: boolean;
  solBalance: number;
  usdcBalance: number;
  usdtBalance: number;
  tbtcBalance: number;
  zbtcBalance: number;
  btcBalance: number; // alias tBTC
  lockedCollateralBtc: number;
  availableBtc: number;
  totalUsdValue: number;
  tokenList: { symbol: string; balance: number; usdValue: number; mint: PublicKey | null; locked?: number }[];
  loading: boolean;
  error: string | null;
}

const BALANCE_CACHE_TTL = 10000;
const cache = new Map<string, { at: number; data: Omit<UserBalanceData, "loading" | "error"> }>();

async function fetchWithRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 300 * Math.pow(2, i) + Math.random() * 200));
    }
  }
  throw lastErr;
}

export function useUserRealBalances(connection: Connection, publicKey: PublicKey | null) {
  const [data, setData] = useState<UserBalanceData>({
    connected: false,
    solBalance: 0,
    usdcBalance: 0,
    usdtBalance: 0,
    tbtcBalance: 0,
    zbtcBalance: 0,
    btcBalance: 0,
    lockedCollateralBtc: 0,
    availableBtc: 0,
    totalUsdValue: 0,
    tokenList: [],
    loading: false,
    error: null,
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      if (!mountedRef.current) return;
      setData({
        connected: false,
        solBalance: 0,
        usdcBalance: 0,
        usdtBalance: 0,
        tbtcBalance: 0,
        zbtcBalance: 0,
        btcBalance: 0,
        lockedCollateralBtc: 0,
        availableBtc: 0,
        totalUsdValue: 0,
        tokenList: [],
        loading: false,
        error: null,
      });
      return;
    }

    const cacheKey = publicKey.toBase58();
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < BALANCE_CACHE_TTL) {
      setData((prev) => ({ ...prev, ...cached.data, connected: true, loading: false, error: null }));
    } else {
      setData((prev) => ({ ...prev, loading: true, connected: true, error: null }));
    }

    try {
      const lamports = await fetchWithRetry(() => connection.getBalance(publicKey, "confirmed"));

      const fetchToken = async (mint: PublicKey | null): Promise<number> => {
        if (!mint) return 0;
        try {
          const ata = getAssociatedTokenAddressSync(mint, publicKey, false, TOKEN_PROGRAM_ID);
          const bal = await connection.getTokenAccountBalance(ata, "confirmed");
          return Number(bal.value.uiAmount || 0);
        } catch {
          return 0;
        }
      };

      const [usdc, usdt, tbtc, zbtc] = await Promise.all([
        fetchToken(MINTS.USDC),
        fetchToken(MINTS.USDT),
        fetchToken(MINTS.tBTC),
        fetchToken(MINTS.zBTC),
      ]);

      const sol = lamports / LAMPORTS_PER_SOL;
      // TODO: sum vaults where borrower == wallet for locked collateral — for now 0, but show available
      const lockedCollateral = 0;
      const availableBtc = tbtc + zbtc; // BTC alias shares tBTC mint
      const btcPrice = 60000; // will be replaced by live Pyth price in UI
      const solPrice = 150;
      const totalUsd = usdc + usdt + sol * solPrice + tbtc * btcPrice + zbtc * btcPrice + lockedCollateral * btcPrice;

      const tokenList = [
        { symbol: "BTC", balance: availableBtc, usdValue: availableBtc * btcPrice, mint: MINTS.BTC, locked: lockedCollateral },
        { symbol: "tBTC", balance: tbtc, usdValue: tbtc * btcPrice, mint: MINTS.tBTC, locked: 0 },
        { symbol: "zBTC", balance: zbtc, usdValue: zbtc * btcPrice, mint: MINTS.zBTC, locked: 0 },
        { symbol: "SOL", balance: sol, usdValue: sol * solPrice, mint: null, locked: 0 },
        { symbol: "USDC", balance: usdc, usdValue: usdc, mint: MINTS.USDC, locked: 0 },
        { symbol: "USDT", balance: usdt, usdValue: usdt, mint: MINTS.USDT, locked: 0 },
      ];

      const newData = {
        connected: true,
        solBalance: sol,
        usdcBalance: usdc,
        usdtBalance: usdt,
        tbtcBalance: tbtc,
        zbtcBalance: zbtc,
        btcBalance: availableBtc,
        lockedCollateralBtc: lockedCollateral,
        availableBtc,
        totalUsdValue: totalUsd,
        tokenList,
      };

      cache.set(cacheKey, { at: Date.now(), data: newData });

      if (!mountedRef.current) return;
      setData({ ...newData, loading: false, error: null });
    } catch (e) {
      if (!mountedRef.current) return;
      setData((prev) => ({ ...prev, loading: false, error: (e as Error).message.slice(0, 120) }));
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  return { ...data, refreshBalances: refresh };
}
