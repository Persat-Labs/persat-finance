// oxlint-disable
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { toast } from 'sonner'
import { Card, Button, Input } from './ui'

const SOURCE_CHAINS = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche'] as const
type SourceChain = (typeof SOURCE_CHAINS)[number]

interface Props {
  toAddress: `0x${string}`
  suggestedAmount: bigint
  onDone: () => void
}

type Phase = 'idle' | 'estimating' | 'estimated' | 'bridging' | 'done' | 'error'

export default function UsdcBridgeModal({ toAddress, suggestedAmount, onDone }: Props) {
  const { connector } = useAccount()
  const [chain, setChain] = useState<SourceChain>('Base')
  const [amount, setAmount] = useState((Number(suggestedAmount) / 1e6).toFixed(2))
  const [phase, setPhase] = useState<Phase>('idle')
  const [feeText, setFeeText] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function makeParams() {
    if (!connector) throw new Error('Connect your wallet first')
    const provider = (await connector.getProvider()) as any
    const adapter = await createViemAdapterFromProvider({ provider })
    return {
      kit: new AppKit(),
      params: {
        from: { adapter, chain },
        to: { chain: 'Arc' as const, recipientAddress: toAddress, useForwarder: true as const },
        amount,
      },
    }
  }

  async function estimate() {
    setPhase('estimating')
    setMessage(null)
    try {
      const { kit, params } = await makeParams()
      const est = await kit.estimateBridge(params)
      const fees = est.fees.filter((f) => f.amount).map((f) => `${f.amount} ${f.token} (${f.type})`)
      setFeeText(fees.length ? fees.join(' + ') : 'no protocol fee')
      setPhase('estimated')
    } catch (e: any) {
      setMessage(e?.message ?? 'Could not estimate this transfer')
      setPhase('error')
    }
  }

  async function bridge() {
    setPhase('bridging')
    setMessage(null)
    try {
      const { kit, params } = await makeParams()
      const result = await kit.bridge(params)
      if (result.state === 'success') {
        setPhase('done')
        toast.success('USDC is on its way to Arc')
      } else {
        const failed = result.steps.find((s: any) => s.state === 'error')
        setMessage(failed?.error ? String((failed.error as any).message ?? failed.error) : 'The transfer did not complete. Your funds are safe; you can retry.')
        setPhase('error')
      }
    } catch (e: any) {
      setMessage(e?.message ?? 'Transfer failed')
      setPhase('error')
    }
  }

  const busy = phase === 'estimating' || phase === 'bridging'
  const validAmount = Number(amount) > 0

  return (
    <Card style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}>
      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>Bridge USDC to Arc</p>
      <p className="text-xs mb-4" style={{ color: 'var(--subtle)' }}>
        Uses Circle CCTP: USDC is burned on the source chain and minted on Arc to your address. Your wallet will ask
        you to switch to the source chain and approve the exact amount.
      </p>

      <label className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>From</label>
      <div className="flex flex-wrap gap-2 mt-1 mb-3">
        {SOURCE_CHAINS.map((c) => (
          <button
            key={c}
            disabled={busy}
            onClick={() => { setChain(c); setPhase('idle'); setFeeText(null) }}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border"
            style={{
              background: chain === c ? 'var(--accent)' : 'transparent',
              color: chain === c ? '#17120f' : 'var(--subtle)',
              borderColor: chain === c ? 'var(--accent)' : 'var(--border)',
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <Input
        label="Amount (USDC)"
        type="number"
        value={amount}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setAmount(e.target.value); setPhase('idle'); setFeeText(null) }}
      />

      <p className="text-xs mt-2 mb-3" style={{ color: 'var(--subtle)' }}>
        To: <span className="mono">{toAddress.slice(0, 6)}…{toAddress.slice(-4)}</span> on Arc
        {feeText && <> · Fees: {feeText}</>}
      </p>

      {phase === 'done' ? (
        <Button variant="primary" size="md" className="w-full" onClick={onDone}>
          Done — back to the deal
        </Button>
      ) : phase === 'estimated' ? (
        <Button variant="primary" size="md" className="w-full" disabled={busy} onClick={bridge}>
          Bridge {amount} USDC from {chain}
        </Button>
      ) : (
        <Button variant="secondary" size="md" className="w-full" disabled={busy || !validAmount} onClick={estimate}>
          {phase === 'estimating' ? 'Estimating…' : 'Get estimate'}
        </Button>
      )}
      {phase === 'bridging' && (
        <p className="text-xs mt-2 text-center" style={{ color: 'var(--subtle)' }}>
          Confirm in your wallet, then keep this window open until Circle's attestation completes.
        </p>
      )}
      {message && (
        <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>{message}</p>
      )}
    </Card>
  )
}
