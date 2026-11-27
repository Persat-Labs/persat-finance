// oxlint-disable
// BTC/USD price used by the UI.
// 1. The on-chain Chainlink feed the vault itself uses (same number the contract checks).
// 2. Pyth Hermes, then CoinGecko, as display-only fallbacks if the RPC is unreachable.
// Never falls back to a hardcoded value: priceUsd stays 0 and hasPrice false until a source answers.

import { useState, useEffect, useRef } from 'react'
import { getArcClient } from '../lib/arcClient'
import { getAddresses, ARC_MAINNET_CHAIN_ID } from '../contracts/addresses'

const BTC_USD_FEED_ID = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'
const REFRESH_INTERVAL_MS = 30_000
const ORACLE_STALE_AFTER_S = 93_600

const FEED_ABI = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
] as const

export interface BtcPriceResult {
  priceUsd: number
  priceUsdBigInt: bigint
  hasPrice: boolean
  isLoading: boolean
  isStale: boolean
  source: string
  lastUpdated: number
}

async function tryOnchainOracle(): Promise<{ price: number; updatedAt: number }> {
  const client = getArcClient()
  const feed = getAddresses(ARC_MAINNET_CHAIN_ID).priceFeed
  const [round, decimals] = await Promise.all([
    client.readContract({ address: feed, abi: FEED_ABI, functionName: 'latestRoundData' }),
    client.readContract({ address: feed, abi: FEED_ABI, functionName: 'decimals' }),
  ])
  const price = Number(round[1]) / 10 ** Number(decimals)
  if (!(price > 0)) throw new Error('bad price')
  return { price, updatedAt: Number(round[3]) }
}

async function tryPyth(): Promise<number> {
  const res = await fetch(
    `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${BTC_USD_FEED_ID}`,
    { signal: AbortSignal.timeout(5000) }
  )
  if (!res.ok) throw new Error(`Pyth ${res.status}`)
  const data = await res.json()
  const p = data?.parsed?.[0]
  if (!p) throw new Error('no data')
  const price = parseInt(p.price.price, 10) * Math.pow(10, parseInt(p.price.expo, 10))
  if (price <= 0) throw new Error('bad price')
  return price
}

async function tryCoinGecko(): Promise<number> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    { signal: AbortSignal.timeout(5000) }
  )
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
  const data = await res.json()
  const price = data?.bitcoin?.usd
  if (!price || price <= 0) throw new Error('bad price')
  return price
}

export function useBtcPrice(): BtcPriceResult {
  const [priceUsd, setPriceUsd] = useState<number>(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isStale, setIsStale] = useState(false)
  const [source, setSource] = useState<string>('loading')
  const [lastUpdated, setLastUpdated] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    try {
      const { price, updatedAt } = await tryOnchainOracle()
      setPriceUsd(price)
      setSource('chainlink')
      setIsStale(Math.floor(Date.now() / 1000) - updatedAt > ORACLE_STALE_AFTER_S)
      setLastUpdated(updatedAt)
      setIsLoading(false)
      return
    } catch {
      // fall through to display-only sources
    }

    const sources: Array<[() => Promise<number>, string]> = [
      [tryPyth, 'pyth (off-chain)'],
      [tryCoinGecko, 'coingecko (off-chain)'],
    ]
    for (const [fn, name] of sources) {
      try {
        const price = await fn()
        setPriceUsd(price)
        setSource(name)
        setIsStale(false)
        setLastUpdated(Math.floor(Date.now() / 1000))
        setIsLoading(false)
        return
      } catch {
        // try next source
      }
    }

    setIsStale(true)
    setSource(priceUsd > 0 ? 'last known' : 'unavailable')
    setIsLoading(false)
  }

  useEffect(() => {
    void load()
    timerRef.current = setInterval(() => void load(), REFRESH_INTERVAL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return {
    priceUsd,
    priceUsdBigInt: BigInt(Math.floor(priceUsd)),
    hasPrice: priceUsd > 0,
    isLoading,
    isStale,
    source,
    lastUpdated,
  }
}
