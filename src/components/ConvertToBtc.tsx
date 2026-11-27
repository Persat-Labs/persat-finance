import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Bitcoin, X, AlertTriangle, ArrowLeft } from 'lucide-react'
import { Card, Button, Input } from './ui'
import { formatBtc, parseBtc } from '../lib/utils'
import { useArcNetwork } from '../hooks/useArcNetwork'
import { getArcClient } from '../lib/arcClient'
import { usesOfficialCirBtc } from '../contracts/addresses'

const LifiWithdrawWidget = lazy(() => import('./LifiWithdrawWidget'))

const BALANCE_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

// Largest amount LI.FI could route in one go when checked (Nov 2026); above it no quote was returned.
const ROUTE_CAP_SATS = 100_000_000n
// Below roughly this amount the fixed costs weigh several percent.
const SMALL_AMOUNT_SATS = 100_000n

// Bitcoin mainnet only: legacy (1…), script (3…), SegWit (bc1q…) and Taproot (bc1p…). Testnet formats are refused.
export function isBitcoinMainnetAddress(a: string): boolean {
  const v = a.trim()
  if (/^bc1q[ac-hj-np-z02-9]{38,58}$/.test(v)) return true
  if (/^bc1p[ac-hj-np-z02-9]{58}$/.test(v)) return true
  return /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(v)
}


export function useCirBtcBalance() {
  const { address, addresses } = useArcNetwork()
  const [balance, setBalance] = useState<bigint | null>(null)
  const refresh = useCallback(async () => {
    if (!address) { setBalance(null); return }
    try {
      const b = await getArcClient().readContract({ address: addresses.cirBtc, abi: BALANCE_ABI, functionName: 'balanceOf', args: [address] })
      setBalance(b as bigint)
    } catch { /* keep the last value */ }
  }, [address, addresses.cirBtc])
  useEffect(() => { void refresh() }, [refresh])
  return { balance, refresh }
}

function ConvertModal({ balance, onClose, onCompleted }: { balance: bigint; onClose: () => void; onCompleted: () => void }) {
  const { addresses } = useArcNetwork()
  const maxSats = balance < ROUTE_CAP_SATS ? balance : ROUTE_CAP_SATS
  const [amount, setAmount] = useState(formatBtc(maxSats))
  const [btcAddress, setBtcAddress] = useState('')
  const [checked, setChecked] = useState(false)
  const [step, setStep] = useState<'form' | 'route'>('form')

  const sats = parseBtc(amount)
  const addressOk = isBitcoinMainnetAddress(btcAddress)
  const amountError =
    sats <= 0n ? null
    : sats > balance ? `You only have ${formatBtc(balance)} cirBTC available.`
    : sats > ROUTE_CAP_SATS ? `At most ${formatBtc(ROUTE_CAP_SATS)} cirBTC per conversion. Convert the rest in another step.`
    : null
  const canContinue = sats > 0n && !amountError && addressOk && checked

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Convert cirBTC to BTC"
    >
      <div className="relative w-full max-w-[440px] max-h-[92svh] overflow-y-auto">
        {step === 'form' ? (
          <Card style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                <Bitcoin size={16} className="text-[#f7931a]" /> Convert cirBTC to BTC
              </h3>
              <button onClick={onClose} aria-label="Close" className="p-1 cursor-pointer"><X size={16} style={{ color: 'var(--subtle)' }} /></button>
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--subtle)' }}>
              Receive native bitcoin on the Bitcoin network. Available in your wallet: <strong style={{ color: 'var(--ink)' }}>{formatBtc(balance)} cirBTC</strong>.
              Collateral locked in a loan is not included.
            </p>

            <div className="flex flex-col gap-4 mb-4">
              <div>
                <Input label="Amount" suffix="cirBTC" value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" inputMode="decimal" error={amountError ?? undefined} />
                <button type="button" onClick={() => setAmount(formatBtc(maxSats))} className="mt-1 text-[11px] font-semibold cursor-pointer" style={{ color: 'var(--accent)' }}>
                  Use max ({formatBtc(maxSats)})
                </button>
              </div>
              <Input
                label="Your Bitcoin address"
                placeholder="bc1q…, bc1p…, 1… or 3…"
                value={btcAddress}
                onChange={(e) => { setBtcAddress(e.target.value.trim()); setChecked(false) }}
                autoComplete="off"
                spellCheck={false}
                error={btcAddress && !addressOk ? 'This is not a Bitcoin mainnet address.' : undefined}
                hint={addressOk ? 'Format looks valid. Compare it character by character with your Bitcoin wallet.' : 'Copy it from your Bitcoin wallet (receive).'}
              />
            </div>

            <ul className="text-[11px] space-y-1.5 mb-4 p-3 rounded-lg" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#fcd9a0' }}>
              <li className="flex gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" />Bitcoin transfers cannot be reversed. A wrong address means lost funds.</li>
              <li>Routed by LI.FI through a third party (currently Relay), which holds the funds during the transfer. About 0.6 to 1% cost and about 25 minutes.</li>
              {sats > 0n && sats < SMALL_AMOUNT_SATS && <li>Small amounts cost more in proportion (several percent below about 0.001 cirBTC).</li>}
              <li>The next screen shows the exact quote and the minimum you will receive. Check them before signing.</li>
              <li>Privacy: the LI.FI widget looks up this Bitcoin address with a public blockchain data service to show its balance.</li>
            </ul>

            <label className="flex items-start gap-2 text-xs mb-4 cursor-pointer" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" className="mt-0.5" checked={checked} disabled={!addressOk} onChange={(e) => setChecked(e.target.checked)} />
              I checked that this Bitcoin address is mine and correct.
            </label>

            <Button variant="primary" size="md" className="w-full" disabled={!canContinue} onClick={() => setStep('route')}>
              See the quote
            </Button>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setStep('form')} className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--subtle)' }}>
                <ArrowLeft size={14} /> Back
              </button>
              <button onClick={onClose} className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--subtle)' }}>
                <X size={14} /> Close
              </button>
            </div>
            <p className="text-[11px] mb-2 px-1" style={{ color: 'var(--subtle)' }}>
              Sending to <span className="mono break-all" style={{ color: 'var(--ink)' }}>{btcAddress}</span>
            </p>
            <Suspense fallback={<Card className="animate-pulse h-96" style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }} />}>
              <LifiWithdrawWidget fromToken={addresses.cirBtc} fromAmount={amount} btcAddress={btcAddress} onCompleted={onCompleted} />
            </Suspense>
          </>
        )}
      </div>
    </div>
  )
}

// Button + modal. Hidden when the wallet holds no free cirBTC.
export default function ConvertToBtc({ variant = 'secondary', label = 'Convert to BTC', className = '' }: {
  variant?: 'primary' | 'secondary'
  label?: string
  className?: string
}) {
  const { address } = useArcNetwork()
  const { balance, refresh } = useCirBtcBalance()
  const [open, setOpen] = useState(false)

  if (!address || balance === null || balance === 0n) return null
  if (!usesOfficialCirBtc()) {
    return (
      <p className="text-xs" style={{ color: '#f59e0b' }}>
        Conversion to BTC opens once the contracts run with Circle's official cirBTC.
      </p>
    )
  }
  return (
    <>
      <Button variant={variant} size="sm" className={`flex items-center justify-center gap-1.5 ${className}`} onClick={() => setOpen(true)}>
        <Bitcoin size={14} /> {label}
      </Button>
      {open && (
        <ConvertModal
          balance={balance}
          onClose={() => { setOpen(false); void refresh() }}
          onCompleted={() => void refresh()}
        />
      )}
    </>
  )
}
