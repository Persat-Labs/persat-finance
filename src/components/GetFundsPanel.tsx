// oxlint-disable
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Bitcoin, ArrowRightLeft, Landmark, X } from 'lucide-react'
import { Card, Button } from './ui'
import { formatBtc, formatUsdc } from '../lib/utils'
import { useArcNetwork } from '../hooks/useArcNetwork'
import { getArcClient } from '../lib/arcClient'
import { usesOfficialCirBtc } from '../contracts/addresses'

const LifiDepositModal = lazy(() => import('./LifiDepositModal'))
const UsdcBridgeModal = lazy(() => import('./UsdcBridgeModal'))

const BALANCE_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

type Need = 'cirBtc' | 'usdc'
type Flow = null | 'btc' | 'anyToCirBtc' | 'anyToUsdc' | 'cctp'

interface Props {
  need: Need
  required: bigint
  title: string
}

export default function GetFundsPanel({ need, required, title }: Props) {
  const { address, addresses } = useArcNetwork()
  const [balance, setBalance] = useState<bigint | null>(null)
  const [flow, setFlow] = useState<Flow>(null)
  const token = need === 'cirBtc' ? addresses.cirBtc : addresses.usdc

  const refresh = useCallback(async () => {
    if (!address) return
    try {
      const b = await getArcClient().readContract({ address: token, abi: BALANCE_ABI, functionName: 'balanceOf', args: [address] })
      setBalance(b as bigint)
    } catch { /* keep last value */ }
  }, [address, token])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!flow) return
    const t = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(t)
  }, [flow, refresh])

  if (!address || required <= 0n || balance === null || balance >= required) return null

  const shortfall = required - balance
  const fmt = need === 'cirBtc' ? `${formatBtc(shortfall)} cirBTC` : `${formatUsdc(shortfall)} USDC`
  const close = () => { setFlow(null); void refresh() }

  return (
    <Card className="border border-[var(--accent)]/30">
      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>{title}</p>
      <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>
        You are missing <strong style={{ color: 'var(--ink)' }}>{fmt}</strong> on Arc. Get it here without leaving Persat;
        your balance refreshes automatically when the funds arrive.
      </p>

      {need === 'cirBtc' && !usesOfficialCirBtc() ? (
        <p className="text-xs" style={{ color: '#f59e0b' }}>
          This deployment still uses a test collateral token, which cannot be bought. Deposits open once the contracts
          run with Circle's official cirBTC.
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          {need === 'cirBtc' ? (
            <>
              <Button variant="primary" size="sm" className="flex-1" onClick={() => setFlow('btc')}>
                <Bitcoin size={14} />
                Deposit native BTC
              </Button>
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => setFlow('anyToCirBtc')}>
                <ArrowRightLeft size={14} />
                Use USDC or another token
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="sm" className="flex-1" onClick={() => setFlow('cctp')}>
                <Landmark size={14} />
                Bridge USDC (Circle CCTP)
              </Button>
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => setFlow('anyToUsdc')}>
                <ArrowRightLeft size={14} />
                Use another token
              </Button>
            </>
          )}
        </div>
      )}

      <p className="text-[11px] mt-3" style={{ color: 'var(--subtle)' }}>
        {need === 'cirBtc'
          ? 'BTC is converted by a third-party route through LI.FI (currently Relay): about 1% cost and about 20 minutes. You sign in your own Bitcoin wallet, and the liquidity provider holds the funds during the transfer. Check the minimum amount received before confirming.'
          : 'Circle CCTP burns USDC on the source chain and mints it on Arc, with no third-party bridge. Other tokens go through LI.FI routes.'}
      </p>

      {flow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div className="relative w-full max-w-[440px]">
            <button
              onClick={close}
              className="absolute -top-9 right-0 flex items-center gap-1 text-xs"
              style={{ color: 'var(--subtle)' }}
            >
              <X size={14} /> Close
            </button>
            <Suspense fallback={<Card className="animate-pulse h-96" style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }} />}>
              {flow === 'cctp' ? (
                <UsdcBridgeModal toAddress={address} suggestedAmount={shortfall} onDone={close} />
              ) : (
                <LifiDepositModal
                  preset={flow === 'btc' ? 'btc' : 'any'}
                  toToken={token}
                  toAddress={address}
                  onCompleted={() => void refresh()}
                />
              )}
            </Suspense>
          </div>
        </div>
      )}
    </Card>
  )
}
