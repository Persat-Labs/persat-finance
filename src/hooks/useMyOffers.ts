import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { getArcClient } from '../lib/arcClient'
import { REGISTRY_ABI } from '../contracts/abis'
import { getAddresses, ARC_MAINNET_CHAIN_ID } from '../contracts/addresses'
import { DealState, normalizeDealId } from '../lib/utils'

const SCAN_PAGE = 100n
const OFFER_PAGE = 200n

export type OfferStatus = 'pending' | 'accepted' | 'not_selected' | 'expired' | 'cancelled' | 'withdrawn' | 'declined'

export interface MyOffer {
  dealId: `0x${string}`
  offerId: bigint
  principal: bigint
  collateral: bigint
  rateBps: bigint
  durationMonths: number
  // the side the offer author would take
  side: 'lend' | 'borrow'
  status: OfferStatus
}

// Offers are only indexed per order on-chain, so we walk the latest public orders and keep the ones this wallet made.
export function useMyOffers() {
  const { address } = useAccount()
  const [offers, setOffers] = useState<MyOffer[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async () => {
    if (!address) { setOffers([]); return }
    setIsLoading(true)
    try {
      const client = getArcClient()
      const { registry } = getAddresses(ARC_MAINNET_CHAIN_ID)
      const read = (functionName: string, args: unknown[] = []) =>
        client.readContract({ address: registry, abi: REGISTRY_ABI, functionName, args } as any) as Promise<any>
      const me = address.toLowerCase()
      const count = (await read('publicDealCount')) as bigint
      const offset = count > SCAN_PAGE ? count - SCAN_PAGE : 0n
      const ids = ((await read('getPublicDeals', [offset, SCAN_PAGE])) as readonly `0x${string}`[])
        .map((id) => normalizeDealId(id))
        .reverse()

      const perDeal = await Promise.all(ids.map(async (dealId) => {
        try {
          const total = (await read('counterOfferCount', [dealId])) as bigint
          const from = total > OFFER_PAGE ? total - OFFER_PAGE : 0n
          const list = (await read('getCounterOffersPage', [dealId, from, OFFER_PAGE])) as any[]
          const mine = list.filter((o) => o.proposer.toLowerCase() === me)
          if (mine.length === 0) return []
          const [deal, expired, declined] = await Promise.all([
            read('getDeal', [dealId]), read('isExpired', [dealId]), read('rejectedProposer', [dealId, address]),
          ])
          const now = BigInt(Math.floor(Date.now() / 1000))
          const iAmParty = deal.borrower.toLowerCase() === me || deal.lender.toLowerCase() === me
          const side: 'lend' | 'borrow' = deal.borrower !== '0x0000000000000000000000000000000000000000' ? 'lend' : 'borrow'
          return mine.map((o): MyOffer => {
            let status: OfferStatus
            if (declined && !o.active && !iAmParty) status = 'declined'
            else if (deal.state === DealState.Cancelled) status = 'cancelled'
            else if (deal.state !== DealState.Proposed) status = iAmParty ? 'accepted' : 'not_selected'
            else if (expired || (o.active && o.expiresAt < now)) status = 'expired'
            else if (o.active) status = 'pending'
            else status = 'withdrawn'
            return {
              dealId, offerId: o.offerId, principal: o.principal, collateral: o.collateral,
              rateBps: o.rateBps, durationMonths: Number(o.durationMonths), side, status,
            }
          })
        } catch {
          return []
        }
      }))
      // A wallet can re-offer after withdrawing: keep only its latest offer per order.
      const latest = new Map<string, MyOffer>()
      for (const o of perDeal.flat()) {
        const prev = latest.get(o.dealId)
        if (!prev || o.offerId > prev.offerId) latest.set(o.dealId, o)
      }
      setOffers([...latest.values()])
    } finally {
      setIsLoading(false)
    }
  }, [address])

  useEffect(() => { void load() }, [load])

  return { offers, isLoading, reload: load }
}
