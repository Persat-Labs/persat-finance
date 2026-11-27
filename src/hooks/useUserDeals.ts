// oxlint-disable
import { useState, useEffect, useCallback } from 'react'
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem'
import { useArcNetwork } from './useArcNetwork'
import { getArcClient } from '../lib/arcClient'
import { REGISTRY_ABI } from '../contracts/abis'
import { getStoredDeals, saveStoredDeal, StoredDeal } from '../lib/dealStorage'
import { normalizeDealId, DealState, deriveSaltForCounterparty } from '../lib/utils'

export interface LiveDeal {
  dealId: `0x${string}`
  borrower: `0x${string}`
  lender: `0x${string}`
  principal: bigint
  collateral: bigint
  rateBps: bigint
  durationMonths: number
  visibility: number
  state: number
  termsHash: `0x${string}`
  claimToken: `0x${string}`
  reservedFor: `0x${string}`
  activatedAt: bigint
  blockNumber?: bigint
  salt?: `0x${string}`
}

// Per-wallet cooldown: prevent multiple page mounts from hammering the RPC
const lastScanTime = new Map<string, number>()
const dealCache = new Map<string, LiveDeal[]>()
const SCAN_COOLDOWN_MS = 10_000

export function useUserDeals() {
  const { address, chainId, addresses, isMainnet } = useArcNetwork()

  // Use the standalone read-only Arc client — works regardless of connected wallet chain
  const client = getArcClient(isMainnet)

  const [deals, setDeals] = useState<LiveDeal[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDeals = useCallback(async (force = false) => {
    if (!addresses.registry) return
    if (!address) {
      setDeals([])
      return
    }

    const key = address.toLowerCase()
    const now = Date.now()
    if (!force && now - (lastScanTime.get(key) ?? 0) < SCAN_COOLDOWN_MS) {
      setDeals(dealCache.get(key) ?? [])
      return
    }
    lastScanTime.set(key, now)

    setIsLoading(true)
    setError(null)

    try {
      // Always use mainnet chain ID for storage — wallet may briefly show wrong chain on reconnect
      const ARC_MAINNET_ID = 5042
      const stored = getStoredDeals(ARC_MAINNET_ID)
      const storedMap = new Map<string, StoredDeal>()
      for (const s of stored) {
        storedMap.set(s.dealId.toLowerCase(), s)
      }

      // N-01: the registry keeps an on-chain index of each user's deals, so no event-log scan is needed.
      const dealIdSet = new Set<string>()
      {
        const count = (await client.readContract({
          address: addresses.registry,
          abi: REGISTRY_ABI,
          functionName: 'userDealCount',
          args: [address],
        })) as bigint
        const PAGE = 200n
        const offset = count > PAGE ? count - PAGE : 0n
        const ids = (await client.readContract({
          address: addresses.registry,
          abi: REGISTRY_ABI,
          functionName: 'getUserDeals',
          args: [address, offset, PAGE],
        })) as readonly `0x${string}`[]
        for (const id of ids) dealIdSet.add(normalizeDealId(id).toLowerCase())

        // Invitations reserved for this wallet live in their own index, so strangers cannot flood the deal list.
        const invCount = (await client.readContract({
          address: addresses.registry,
          abi: REGISTRY_ABI,
          functionName: 'invitationCount',
          args: [address],
        })) as bigint
        const invOffset = invCount > PAGE ? invCount - PAGE : 0n
        const invitations = (await client.readContract({
          address: addresses.registry,
          abi: REGISTRY_ABI,
          functionName: 'getInvitations',
          args: [address, invOffset, PAGE],
        })) as readonly `0x${string}`[]
        for (const id of invitations) dealIdSet.add(normalizeDealId(id).toLowerCase())
      }

      for (const s of stored) {
        dealIdSet.add(normalizeDealId(s.dealId).toLowerCase())
      }

      const blockMap = new Map<string, bigint>()

      // Fetch live deal structs from contract
      const dealList: LiveDeal[] = []

      await Promise.all(
        Array.from(dealIdSet).map(async (idLower) => {
          try {
            const raw = (await client.readContract({
              address: addresses.registry,
              abi: REGISTRY_ABI,
              functionName: 'getDeal',
              args: [idLower as `0x${string}`],
            })) as any

            if (raw.borrower === '0x0000000000000000000000000000000000000000' && raw.lender === '0x0000000000000000000000000000000000000000') return

            const storedInfo = storedMap.get(idLower)
            let salt = storedInfo?.salt

            // Recover salt for counterparty so they can claim seamlessly
            if (!salt && raw.visibility === 0 && raw.state === DealState.Proposed) {
              if (raw.reservedFor && raw.reservedFor !== '0x0000000000000000000000000000000000000000') {
                const candidate = deriveSaltForCounterparty(raw.dealId, raw.reservedFor)
                const expectedToken = keccak256(
                  encodeAbiParameters(parseAbiParameters('bytes16, bytes32'), [raw.dealId, candidate])
                )
                if (expectedToken.toLowerCase() === raw.claimToken.toLowerCase()) {
                  salt = candidate
                }
              }

              // Security fix F-07: open-link secrets are never recovered from on-chain calldata.
              // The proposeDeal calldata only holds the ephemeral signer address; the claim key
              // exists solely in the creator's share link / localStorage.

              if (salt) {
                saveStoredDeal({
                  dealId: raw.dealId,
                  salt,
                  role: address && raw.borrower.toLowerCase() === address.toLowerCase() ? 'borrower' : 'lender',
                  principal: (Number(raw.principal) / 1e6).toString(),
                  collateral: (Number(raw.collateral) / 1e8).toString(),
                  rateBps: (Number(raw.rateBps) / 100).toString(),
                  durationMonths: raw.durationMonths,
                  visibility: 'private',
                  reservedFor: raw.reservedFor,
                  chainId: 5042,
                  createdAt: Date.now(),
                })
              }
            }

            dealList.push({
              dealId: raw.dealId,
              borrower: raw.borrower,
              lender: raw.lender,
              principal: raw.principal,
              collateral: raw.collateral,
              rateBps: raw.rateBps,
              durationMonths: raw.durationMonths,
              visibility: raw.visibility,
              state: raw.state,
              termsHash: raw.termsHash,
              claimToken: raw.claimToken,
              reservedFor: raw.reservedFor,
              activatedAt: raw.activatedAt,
              blockNumber: blockMap.get(idLower),
              salt,
            })
          } catch {
            // Deal does not exist on this chain
          }
        })
      )

      const position = new Map(Array.from(dealIdSet).map((id, i) => [id, i]))
      dealList.sort((a, b) =>
        (position.get(b.dealId.toLowerCase()) ?? -1) - (position.get(a.dealId.toLowerCase()) ?? -1))

      dealCache.set(key, dealList)
      setDeals(dealList)
    } catch (err: any) {
      console.error('Error fetching on-chain deals:', err)
      setError(err?.message ?? 'Failed to load deals')
    } finally {
      setIsLoading(false)
    }
  }, [addresses.registry, chainId, isMainnet, address, client])

  useEffect(() => {
    void fetchDeals()
  }, [fetchDeals])

  const userLower = address ? address.toLowerCase() : ''

  const borrowedDeals = deals.filter((d) => d.borrower.toLowerCase() === userLower)
  const fundedDeals = deals.filter((d) => d.lender.toLowerCase() === userLower)
  const incomingDeals = deals.filter(
    (d) =>
      d.reservedFor.toLowerCase() === userLower &&
      d.state === DealState.Proposed &&
      d.borrower.toLowerCase() !== userLower
  )

  const userActiveBorrowed = borrowedDeals.filter(
    (d) => d.state === DealState.Active || d.state === DealState.Confirmed
  )
  const totalCollateralLocked = userActiveBorrowed.reduce((acc, d) => acc + d.collateral, 0n)
  const totalBorrowedUsdc = userActiveBorrowed.reduce((acc, d) => acc + d.principal, 0n)

  return {
    deals,
    borrowedDeals,
    fundedDeals,
    incomingDeals,
    totalCollateralLocked,
    totalBorrowedUsdc,
    isLoading,
    error,
    refetch: () => fetchDeals(true),
  }
}
