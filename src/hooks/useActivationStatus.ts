import { useEffect, useState } from 'react'
import { getArcClient } from '../lib/arcClient'
import { REGISTRY_ABI, ERC20_APPROVE_ABI } from '../contracts/abis'
import { useArcNetwork } from './useArcNetwork'
import { DealState } from '../lib/utils'
import type { LiveDeal } from './useUserDeals'

// For accepted deals that have not started: 'expired' (24 h window passed), 'your_turn' (your approval is missing),
// 'start' (both sides ready, either can start it) or 'waiting' (waiting for the other side).
export type ActivationStatus = 'expired' | 'your_turn' | 'start' | 'waiting'

export function useActivationStatus(deals: LiveDeal[]) {
  const { address, addresses } = useArcNetwork()
  const [status, setStatus] = useState<Map<string, ActivationStatus>>(new Map())
  const confirmed = deals.filter((d) => d.state === DealState.Confirmed)
  const key = confirmed.map((d) => d.dealId).join(',')

  useEffect(() => {
    if (!address || confirmed.length === 0) { setStatus(new Map()); return }
    let stale = false
    const client = getArcClient()
    const me = address.toLowerCase()
    const erc20 = (token: `0x${string}`, functionName: 'allowance' | 'balanceOf', args: unknown[]) =>
      client.readContract({ address: token, abi: ERC20_APPROVE_ABI, functionName, args } as any) as Promise<bigint>
    void Promise.all(confirmed.map(async (d) => {
      try {
        const [deadline, lAllow, lBal, bAllow, bBal] = await Promise.all([
          client.readContract({ address: addresses.registry, abi: REGISTRY_ABI, functionName: 'activationDeadline', args: [d.dealId] } as any) as Promise<bigint>,
          erc20(addresses.usdc, 'allowance', [d.lender, addresses.vault]),
          erc20(addresses.usdc, 'balanceOf', [d.lender]),
          erc20(addresses.cirBtc, 'allowance', [d.borrower, addresses.vault]),
          erc20(addresses.cirBtc, 'balanceOf', [d.borrower]),
        ])
        const lenderReady = lAllow >= d.principal && lBal >= d.principal
        const borrowerReady = bAllow >= d.collateral && bBal >= d.collateral
        const iLend = d.lender.toLowerCase() === me
        let s: ActivationStatus
        if (Number(deadline) < Date.now() / 1000) s = 'expired'
        else if (lenderReady && borrowerReady) s = 'start'
        else if (iLend ? !lenderReady : !borrowerReady) s = 'your_turn'
        else s = 'waiting'
        return [d.dealId.toLowerCase(), s] as const
      } catch {
        return null
      }
    })).then((rows) => {
      if (!stale) setStatus(new Map(rows.filter((r): r is readonly [string, ActivationStatus] => r !== null)))
    })
    return () => { stale = true }
  }, [address, key, addresses.registry, addresses.usdc, addresses.cirBtc, addresses.vault]) // eslint-disable-line react-hooks/exhaustive-deps

  return status
}
