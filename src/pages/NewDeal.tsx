// oxlint-disable
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { Copy, Check, Lock, Unlock, Info, ArrowRight, ExternalLink, CheckCircle2, Sparkles, Send, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Card, Button, Input, TxStatus } from '../components/ui'
import {
  randomDealNonce,
  deriveDealId,
  openLinkOnchainSalt,
  randomSalt,
  formatUsdc,
  parseUsdc,
  parseBtc,
  formatBtc,
  computeRepayment,
  parseOnchainError,
  deriveSaltForCounterparty,
  computeRltv,
} from '../lib/utils'
import { REGISTRY_ABI, VAULT_ABI } from '../contracts/abis'
import GetFundsPanel from '../components/GetFundsPanel'
import { useArcNetwork } from '../hooks/useArcNetwork'
import { addArcNetwork } from '../lib/networkUtils'
import { saveStoredDeal } from '../lib/dealStorage'
import { useBtcPrice } from '../hooks/useBtcPrice'
import { getArcClient } from '../lib/arcClient'

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

const USDC_MAINNET = '0x3600000000000000000000000000000000000000' as const

type Tab = 'private' | 'public'
type Role = 'borrower' | 'lender'

export default function NewDeal() {
  const { address, isConnected, isWrongChain, chain, addresses, chainId, isMainnet } = useArcNetwork()
  const arcClient = getArcClient(isMainnet)
  const { priceUsd: btcPriceUsd, hasPrice, isStale: priceStale, source: priceSource } = useBtcPrice()
  const { data: maxInitialLtvBps } = useReadContract({
    address: addresses.vault, abi: VAULT_ABI, functionName: 'maxInitialLtvBps', chainId,
  })
  const { data: liquidationThresholdBps } = useReadContract({
    address: addresses.vault, abi: VAULT_ABI, functionName: 'liquidationThresholdBps', chainId,
  })
  const maxInitPct = maxInitialLtvBps !== undefined ? Number(maxInitialLtvBps) / 100 : 65
  const liqPct = liquidationThresholdBps !== undefined ? Number(liquidationThresholdBps) / 100 : 80

  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(() => (searchParams.get('type') === 'private' ? 'private' : 'public'))
  const [role, setRole] = useState<Role>('borrower')
  const [form, setForm] = useState({
    principal: '',
    collateral: '',
    rateBps: '',
    durationMonths: '',
    reservedFor: '',
  })
  // F-08: the deal ID is bound to the connected wallet (first 8 bytes = registry.dealIdPrefix(address))
  const [dealNonce] = useState<`0x${string}`>(randomDealNonce)
  const dealId: `0x${string}` = address
    ? deriveDealId(address, dealNonce)
    : (`0x${'00'.repeat(8)}${dealNonce.slice(2)}` as `0x${string}`)
  // F-07: for open private links this is an ephemeral private key that only travels inside the share link
  const [salt] = useState<`0x${string}`>(randomSalt)
  const [detailsOpen, setDetailsOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches)
  const [receiptConfirmed, setReceiptConfirmed] = useState(false)
  const [minedBlock, setMinedBlock] = useState<bigint | null>(null)

  // Wallet balance checks
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null)
  const [cirBtcBalance, setCirBtcBalance] = useState<bigint | null>(null)

  const fetchBalances = useCallback(async () => {
    if (!address) return
    try {
      const [usdc, cirbtc] = await Promise.all([
        arcClient.readContract({ address: USDC_MAINNET, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }),
        arcClient.readContract({ address: addresses.cirBtc as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }),
      ])
      setUsdcBalance(usdc as bigint)
      setCirBtcBalance(cirbtc as bigint)
    } catch { /* ignore */ }
  }, [address, arcClient, addresses.cirBtc])

  useEffect(() => { void fetchBalances() }, [fetchBalances])

  const { writeContract: rawWrite, data: hash, isPending, error, reset: resetWrite } = useWriteContract()

  // Simulate first so a call that would revert shows its reason instead of failing on-chain.
  const writeContract = (params: any) => {
    if (!address) return
    const { gas: _gas, chainId: _chainId, ...call } = params
    arcClient
      .simulateContract({ ...call, account: address })
      .then(() => rawWrite(params))
      .catch((e: unknown) => toast.error(parseOnchainError(e), { duration: 8000 }))
  }

  // Show errors immediately as a toast so they are never missed
  useEffect(() => {
    if (error) {
      toast.error(parseOnchainError(error), { duration: 8000 })
    }
  }, [error])

  const { isSuccess: receiptReady, data: wagmiReceipt } = useWaitForTransactionReceipt({
    hash,
    chainId,
    query: {
      enabled: Boolean(hash),
    },
  })
  const isWagmiSuccess = receiptReady && wagmiReceipt?.status === 'success'
  const reverted = receiptReady && wagmiReceipt?.status === 'reverted'

  useEffect(() => {
    if (reverted) toast.error('Transaction failed on-chain. The deal was not created.', { duration: 8000 })
  }, [reverted])

  // Fast sub-second direct poller so the UI never stays stuck on 'Confirming...'
  useEffect(() => {
    if (!hash || receiptConfirmed) return
    let active = true
    const interval = setInterval(async () => {
      try {
        const receipt = await arcClient.getTransactionReceipt({ hash })
        if (receipt && receipt.status === 'success' && active) {
          setReceiptConfirmed(true)
          if (receipt.blockNumber) setMinedBlock(receipt.blockNumber)
          clearInterval(interval)
        }
      } catch {
        // Pending next block
      }
    }, 1000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [hash, receiptConfirmed, arcClient])

  const isConfirmed = isWagmiSuccess || receiptConfirmed
  const isConfirming = Boolean(hash) && !isConfirmed && !reverted
  const formLocked = isPending || (Boolean(hash) && !reverted)


  // Once the proposal is on-chain, continue on the deal page (invitation link, status, cancel).
  useEffect(() => {
    if (!isConfirmed) return
    toast.success(tab === 'private' ? 'Deal created. Send the invitation link to your counterparty.' : 'Deal created and listed on the Marketplace.')
    navigate(`/deal/${dealId}/manage`)
  }, [isConfirmed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute effective salt: If counterparty address is set, use deterministic derived salt.
  // effectiveSalt = secret carried by the share link; onchainSalt = value sent to proposeDeal.
  // Open links (no counterparty): the link carries an ephemeral private key and the chain only
  // stores its address, so the claim secret never appears on-chain (F-07).
  const hasCounterparty = form.reservedFor.trim().startsWith('0x') && form.reservedFor.trim().length === 42
  const zeroSalt = ('0x' + '00'.repeat(32)) as `0x${string}`
  const effectiveSalt = tab === 'private'
    ? (hasCounterparty
        ? deriveSaltForCounterparty(dealId, form.reservedFor.trim() as `0x${string}`)
        : salt)
    : zeroSalt
  const onchainSalt = tab === 'private' && !hasCounterparty ? openLinkOnchainSalt(salt) : effectiveSalt

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const principalRaw = parseUsdc(form.principal)
  const collateralRaw = parseBtc(form.collateral)
  const rateBpsRaw = BigInt(Math.round(parseFloat(form.rateBps || '0') * 100))
  const duration = parseInt(form.durationMonths || '0')

  const { interest, total } = principalRaw > 0n && rateBpsRaw > 0n && duration > 0
    ? computeRepayment(principalRaw, rateBpsRaw, duration)
    : { interest: 0n, total: 0n }

  // RLTV: collateral value vs total repayable (principal + interest) — protects lender yield
  const btcPriceBigInt = BigInt(Math.floor(btcPriceUsd))
  const collateralUsdEst = collateralRaw * btcPriceBigInt / 100n  // USDC 6-dec
  const rltvEst = computeRltv(collateralRaw, btcPriceUsd, principalRaw, rateBpsRaw, duration)

  const ltvTooHigh = hasPrice && rltvEst > maxInitPct

  const isValid =
    principalRaw >= 100_000_000n &&
    collateralRaw > 0n &&
    rateBpsRaw > 0n &&
    duration > 0 &&
    duration <= 24 &&
    !ltvTooHigh

  // Balance checks — warn before submission
  const insufficientUsdc = role === 'lender' && usdcBalance !== null && principalRaw > 0n && usdcBalance < principalRaw
  const insufficientCirBtc = role === 'borrower' && cirBtcBalance !== null && collateralRaw > 0n && cirBtcBalance < collateralRaw
  const hasBalanceWarning = insufficientUsdc || insufficientCirBtc

  function submit() {
    if (!isValid || !address) return

    // Save to local registry so creator and counterparty have full access
    saveStoredDeal({
      dealId,
      salt: tab === 'private' ? effectiveSalt : undefined,
      role,
      principal: form.principal,
      collateral: form.collateral,
      rateBps: form.rateBps,
      durationMonths: duration,
      visibility: tab,
      reservedFor: form.reservedFor.trim() || undefined,
      chainId,
      txHash: undefined,
      createdAt: Date.now(),
    })

    writeContract({
      address: addresses.registry,
      abi: REGISTRY_ABI,
      functionName: 'proposeDeal',
      args: [
        dealId,
        role === 'borrower',
        (tab === 'private' && hasCounterparty
          ? form.reservedFor.trim()
          : '0x0000000000000000000000000000000000000000') as `0x${string}`,
        principalRaw,
        collateralRaw,
        rateBpsRaw,
        duration,
        tab === 'private' ? 0 : 1, // Visibility enum
        onchainSalt,
      ],
      chainId,
      // Arc Testnet RPC rejects eth_estimateGas for long calldata ("Invalid params").
      // Setting gas manually bypasses the estimate and sends directly to MetaMask.
      gas: 450_000n,
    })
  }

  // Update txHash in stored deal once available
  useEffect(() => {
    if (hash) {
      saveStoredDeal({
        dealId,
        salt: tab === 'private' ? effectiveSalt : undefined,
        role,
        principal: form.principal,
        collateral: form.collateral,
        rateBps: form.rateBps,
        durationMonths: duration,
        visibility: tab,
        reservedFor: form.reservedFor.trim() || undefined,
        chainId,
        txHash: hash,
        createdAt: Date.now(),
      })
    }
  }, [hash, dealId, effectiveSalt, role, form, duration, tab, chainId])

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="display text-2xl font-bold mb-1" style={{ color: 'var(--ink)' }}>
        Create a Deal
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--subtle)' }}>
        Propose terms for a BTC-collateralised USDC loan on Arc.
      </p>

      <fieldset disabled={formLocked} className="min-w-0 m-0 p-0 border-0 disabled:opacity-60">
      {/* Tab */}
      <div
        className="flex rounded-xl p-1 mb-2"
        style={{ background: 'var(--surface-muted)' }}
        role="radiogroup"
        aria-label="Deal type"
      >
        {(['public', 'private'] as Tab[]).map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={tab === t}
            onClick={() => setTab(t)}
            className="flex-1 min-w-0 px-2 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all"
            style={
              tab === t
                ? { background: 'var(--surface-strong)', color: 'var(--ink)' }
                : { background: 'transparent', color: 'var(--subtle)' }
            }
          >
            {t === 'private' ? (
              <span className="flex items-center justify-center gap-2">
                <Lock size={14} className="shrink-0" /> Private Link
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Unlock size={14} className="shrink-0" /> <span><span className="hidden min-[360px]:inline">Open </span>Marketplace</span>
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed mb-6 px-1" style={{ color: 'var(--subtle)' }}>
        {tab === 'public'
          ? 'Visible to everyone on the Marketplace. Anyone can accept these terms.'
          : 'Only people you send the link to can see and accept this deal.'}
      </p>

      {/* Role */}
      <Card className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>
          I want to
        </p>
        <div className="flex gap-2" role="radiogroup" aria-label="I want to">
          {(['borrower', 'lender'] as Role[]).map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className="flex-1 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all border"
              style={{
                background: role === r ? 'var(--brand-muted)' : 'transparent',
                borderColor: role === r ? 'var(--brand)' : 'var(--border)',
                color: role === r ? 'var(--brand)' : 'var(--subtle)',
              }}
            >
              {r === 'borrower' ? 'Borrow USDC' : 'Lend USDC'}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--subtle)' }}>
          {role === 'borrower'
            ? 'You lock cirBTC as collateral and receive USDC.'
            : "You provide USDC and earn interest. Your loan is secured by the borrower's cirBTC, valued at the BTC/USD price: a loss of cirBTC's 1:1 link to BTC during the loan would not be detected."}
        </p>
      </Card>

      {/* Terms */}
      <Card className="mb-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-4">
          <div className="col-span-2 sm:col-span-1">
            <Input label={role === 'borrower' ? 'Amount to borrow' : 'Amount to lend'} placeholder="1000" suffix="USDC" value={form.principal} onChange={set('principal')} type="number" min="100" inputMode="decimal" error={form.principal && principalRaw > 0n && principalRaw < 100_000_000n ? 'Minimum 100 USDC.' : undefined} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Input label={role === 'borrower' ? 'Your collateral' : 'Collateral required'} placeholder="0.03" suffix="cirBTC" value={form.collateral} onChange={set('collateral')} type="number" min="0" inputMode="decimal" hint={role === 'borrower' ? 'cirBTC is Bitcoin issued by Circle on Arc, backed 1:1. Only have BTC? The app helps you convert it.' : 'cirBTC is Bitcoin issued by Circle on Arc, backed 1:1. The borrower locks it in escrow.'} />
          </div>
          <Input label="Annual rate" placeholder="8" suffix="%" value={form.rateBps} onChange={set('rateBps')} type="number" min="0" inputMode="decimal" />
          <Input label="Duration" placeholder="6" suffix="months" value={form.durationMonths} onChange={set('durationMonths')} type="number" min="1" max="24" inputMode="numeric" hint="1 to 24" />
        </div>

        {tab === 'private' && (
          <Input
            label="Counterparty wallet (optional)"
            placeholder="0x… or leave blank"
            value={form.reservedFor}
            onChange={set('reservedFor')}
            hint="Only this address can accept the deal."
          />
        )}
      </Card>

      </fieldset>

      {/* Live calculator */}
      {principalRaw > 0n && (
        <Card className="mb-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
              Payment preview
            </p>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
              <span className={`w-2 h-2 rounded-full ${priceStale ? 'bg-yellow-500' : 'bg-green-500'}`} />
              BTC <strong style={{ color: 'var(--ink)' }}>{hasPrice ? `$${btcPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</strong>
              {priceStale && <span style={{ color: '#f59e0b' }}>(stale)</span>}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded-xl p-3" style={{ background: 'var(--surface-muted)' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Total repayment</p>
              <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--ink)' }}>${formatUsdc(total)}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'var(--surface-muted)' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Est. RLTV <span className="opacity-70">(max {maxInitPct}%)</span></p>
              <p
                className="text-lg font-bold tabular-nums"
                style={{ color: !(hasPrice && rltvEst > 0) ? 'var(--ink)' : rltvEst > maxInitPct ? 'var(--danger)' : rltvEst > maxInitPct - 5 ? '#f7931a' : '#10b981' }}
              >
                {hasPrice && rltvEst > 0 ? `${rltvEst.toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>

          <details className="group" open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer list-none text-xs font-semibold select-none" style={{ color: 'var(--brand)' }}>
              <span className="group-open:hidden">Show details</span>
              <span className="hidden group-open:inline">Hide details</span>
            </summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                ['Principal', `$${formatUsdc(principalRaw)}`],
                ['Interest', `$${formatUsdc(interest)}`],
                ['Collateral', `${formatBtc(collateralRaw)} cirBTC`],
                ['Collateral value', collateralUsdEst > 0n ? `$${formatUsdc(collateralUsdEst)}` : '—'],
                ['Max RLTV to activate', `${maxInitPct}%`],
                ['Liquidation RLTV', `${liqPct}%`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b pb-1" style={{ borderColor: 'var(--border)' }}>
                  <span style={{ color: 'var(--subtle)' }}>{k}</span>
                  <span className="font-semibold tabular-nums text-right" style={{ color: 'var(--ink)' }}>{v}</span>
                </div>
              ))}
            </div>
          </details>

          {ltvTooHigh && (
            <div className="flex items-start gap-2 mt-3 text-xs p-2 rounded-lg" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}>
              <Info size={12} className="shrink-0 mt-0.5" />
              RLTV is above {maxInitPct}%, the maximum the vault accepts at activation. Add collateral or lower the amount.
            </div>
          )}
          {!hasPrice && (
            <div className="flex items-start gap-2 mt-3 text-xs p-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
              <Info size={12} className="shrink-0 mt-0.5" />
              BTC price unavailable right now, so the loan-to-value cannot be checked. The vault will still refuse activation above {maxInitPct}%.
            </div>
          )}

          {(insufficientUsdc || insufficientCirBtc) && (
            <div className="mt-3 flex flex-col gap-3 text-xs p-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
              <div className="flex items-start gap-2">
                <Info size={12} className="shrink-0 mt-0.5" />
                <span>
                  <strong>Not enough funds.</strong>{' '}
                  {insufficientCirBtc && <>You need {formatBtc(collateralRaw)} cirBTC, you have {cirBtcBalance !== null ? formatBtc(cirBtcBalance) : '…'}. </>}
                  {insufficientUsdc && <>You need ${formatUsdc(principalRaw)} USDC, you have ${usdcBalance !== null ? formatUsdc(usdcBalance) : '…'}.</>}
                </span>
              </div>
              {insufficientCirBtc && <GetFundsPanel need="cirBtc" required={collateralRaw} title="Get cirBTC for your collateral" />}
              {insufficientUsdc && <GetFundsPanel need="usdc" required={principalRaw} title="Bring USDC to Arc" />}
            </div>
          )}

          {address && !insufficientUsdc && !insufficientCirBtc && (usdcBalance !== null || cirBtcBalance !== null) && (
            <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
              Wallet: {usdcBalance !== null ? `$${formatUsdc(usdcBalance)} USDC` : '…'} · {cirBtcBalance !== null ? `${formatBtc(cirBtcBalance)} cirBTC` : '…'}
            </p>
          )}
        </Card>
      )}

      {/* Deal ID preview */}
      <div className="mb-4 flex items-center gap-2 min-w-0 text-xs" style={{ color: 'var(--subtle)' }}>
        <span className="shrink-0">Deal ID</span>
        <code className="mono truncate" style={{ color: 'var(--muted)' }} title={dealId}>
          <span className="sm:hidden">{`${dealId.slice(0, 10)}…${dealId.slice(-6)}`}</span>
          <span className="hidden sm:inline">{dealId}</span>
        </code>
        <button
          type="button"
          onClick={() => { void navigator.clipboard.writeText(dealId).then(() => toast.success('Deal ID copied')).catch(() => {}) }}
          className="shrink-0 p-1 rounded-md hover:bg-[var(--surface-muted)] cursor-pointer"
          aria-label="Copy deal ID"
        >
          <Copy size={12} />
        </button>
      </div>

      {/* CTA Button */}
      {!isConnected ? (
        <div className="rounded-xl p-3 text-sm text-center" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}>
          Connect your wallet to propose a deal
        </div>
      ) : isWrongChain ? (
        <div className="rounded-xl p-4 text-sm text-center" style={{ background: 'rgba(232,109,122,0.1)', border: '1px solid rgba(232,109,122,0.3)', borderRadius: 12 }}>
          <p className="mb-3 font-semibold" style={{ color: 'var(--danger)' }}>Wrong Network</p>
          <p className="text-xs mb-4" style={{ color: 'var(--subtle)' }}>
            Your wallet is on the wrong network. Click below to switch to Arc Mainnet — works with MetaMask, OKX, and any EVM wallet.
          </p>
          <button
            onClick={() => addArcNetwork('mainnet')}
            className="w-full py-3 rounded-xl font-bold text-sm"
            style={{ background: 'var(--brand)', color: '#17120f', border: 'none', cursor: 'pointer' }}
          >
            Switch to Arc Mainnet
          </button>
        </div>
      ) : (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!isValid || isPending || isConfirming}
          onClick={submit}
        >
          {isPending
            ? 'Confirm in wallet...'
            : isConfirming
            ? 'Confirming on Arc...'
            : isConfirmed
            ? 'Deal Proposed & Confirmed!'
            : 'Propose Deal'}
        </Button>
      )}

      <TxStatus
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isConfirmed}
        error={error ? parseOnchainError(error) : null}
        explorerUrl={hash ? `${chain.blockExplorers.default.url}/tx/${hash}` : undefined}
      />

    </div>
  )
}
