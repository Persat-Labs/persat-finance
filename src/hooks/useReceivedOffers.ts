import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { getArcClient } from '../lib/arcClient'
import { REGISTRY_ABI } from '../contracts/abis'
import { getAddresses, ARC_MAINNET_CHAIN_ID } from '../contracts/addresses'
import { DealState } from '../lib/utils'
import type { LiveDeal } from './useUserDeals'

// Active offers waiting on the wallet's own open Marketplace orders, keyed by lower-case deal ID.
export function useReceivedOffers(deals: LiveDeal[]) {
  const { address } = useAccount()
  const [counts, setCounts] = useState<Map<string, number>>(new Map())

  const me = address?.toLowerCase()
  const open = deals.filter((d) =>
    d.visibility === 1 && d.state === DealState.Proposed &&
    (d.borrower.toLowerCase() === me || d.lender.toLowerCase() === me))
  const key = open.map((d) => d.dealId).join(',')

  useEffect(() => {
    if (!me || open.length === 0) { setCounts(new Map()); return }
    let cancelled = false
    const client = getArcClient()
    const { registry } = getAddresses(ARC_MAINNET_CHAIN_ID)
    void Promise.all(open.map(async (d) => {
      try {
        const offers = (await client.readContract({
          address: registry, abi: REGISTRY_ABI, functionName: 'getActiveCounterOffers', args: [d.dealId],
        } as any)) as readonly { active: boolean; expiresAt: bigint }[]
        const now = BigInt(Math.floor(Date.now() / 1000))
        return [d.dealId.toLowerCase(), offers.filter((o) => o.active && o.expiresAt >= now).length] as const
      } catch {
        return [d.dealId.toLowerCase(), 0] as const
      }
    })).then((rows) => { if (!cancelled) setCounts(new Map(rows.filter(([, n]) => n > 0))) })
    return () => { cancelled = true }
  }, [me, key]) // eslint-disable-line react-hooks/exhaustive-deps

  return counts
}
