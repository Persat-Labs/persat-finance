// oxlint-disable
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { AlertTriangle, Zap, RotateCcw, ShieldCheck, ShieldAlert, XCircle, Check, Download, PauseCircle, Plus, Store, Copy } from 'lucide-react'
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem'
import { toast } from 'sonner'
import { Card, Button, Badge, Stat, TxStatus } from '../components/ui'
import {
  dealStateLabel,
  dealStateColor,
  formatUsdc,
  formatBtc,
  formatBps,
  computeRepayment,
  shortAddr,
  DealState,
  parseOnchainError,
  normalizeDealId,
  isValidDealId,
  deriveSaltForCounterparty,
  computeRltv,
  parseBtc,
} from '../lib/utils'
import { getStoredDeals } from '../lib/dealStorage'
import ShareDealCard from '../components/ShareDealCard'
import ConvertToBtc, { useCirBtcBalance } from '../components/ConvertToBtc'
import { REGISTRY_ABI, VAULT_ABI, ERC20_APPROVE_ABI } from '../contracts/abis'
import { useArcNetwork } from '../hooks/useArcNetwork'
import { useBtcPrice } from '../hooks/useBtcPrice'
import GetFundsPanel from '../components/GetFundsPanel'
import { getArcClient } from '../lib/arcClient'

const PAGE_LOAD_SEC = Math.floor(new Date().valueOf() / 1000)
const ZERO = '0x0000000000000000000000000000000000000000' as const

type Action = 'activateLoan' | 'repayLoan' | 'liquidate' | 'markDefault'

const LATE_FEE_BPS = 200n
const LIQUIDATION_BONUS_BPS = 300n

const GAS: Record<Action, bigint> = {
  activateLoan: 450_000n,
  repayLoan: 350_000n,
  liquidate: 450_000n,
  markDefault: 120_000n,
}

const PAUSED_ABI = [
  { name: 'paused', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
] as const

export default function ManageDeal() {
  const { id: dealIdParam } = useParams<{ id: string }>()
  const { address, isConnected, isWrongChain, chain, addresses, chainId } = useArcNetwork()
  const { priceUsd: btcPrice, hasPrice, source: priceSource, isStale: priceStale } = useBtcPrice()

  const hasValidId = isValidDealId(dealIdParam)
  const normalizedDealId = normalizeDealId(dealIdParam)

  const { data: deal, isLoading, refetch, error: readError } = useReadContract({
    address: addresses.registry,
    abi: REGISTRY_ABI,
    functionName: 'getDeal',
    args: [normalizedDealId],
    chainId,
    query: { enabled: hasValidId, retry: false },
  })

  const isOpenLoan = deal?.state === DealState.Active || deal?.state === DealState.Defaulted

  const { data: lockedCollateral, refetch: refetchLocked } = useReadContract({
    address: addresses.vault,
    abi: VAULT_ABI,
    functionName: 'lockedCollateral',
    args: [normalizedDealId],
    chainId,
    query: { enabled: hasValidId && isOpenLoan },
  })

  const { data: amountDue, refetch: refetchDue } = useReadContract({
    address: addresses.vault,
    abi: VAULT_ABI,
    functionName: 'amountDue',
    args: [normalizedDealId],
    chainId,
    query: { enabled: hasValidId && isOpenLoan, refetchInterval: 60_000 },
  })

  const { data: liquidationOpensAt } = useReadContract({
    address: addresses.vault,
    abi: VAULT_ABI,
    functionName: 'liquidationOpensAt',
    args: [normalizedDealId],
    chainId,
    query: { enabled: hasValidId && isOpenLoan },
  })

  const { data: liquidationThresholdBps } = useReadContract({
    address: addresses.vault, abi: VAULT_ABI, functionName: 'liquidationThresholdBps', chainId,
  })
  const { data: maxInitialLtvBps } = useReadContract({
    address: addresses.vault, abi: VAULT_ABI, functionName: 'maxInitialLtvBps', chainId,
  })

  const { data: feeNow } = useReadContract({
    address: addresses.vault, abi: VAULT_ABI, functionName: 'currentFeeBps', chainId,
    query: { enabled: deal?.state === DealState.Confirmed },
  })
  const { data: feePending } = useReadContract({
    address: addresses.vault, abi: VAULT_ABI, functionName: 'pendingFeeBps', chainId,
    query: { enabled: deal?.state === DealState.Confirmed },
  })
  const { data: feeChangeAt } = useReadContract({
    address: addresses.vault, abi: VAULT_ABI, functionName: 'feeChangeEffectiveAt', chainId,
    query: { enabled: deal?.state === DealState.Confirmed },
  })
  const feeChanging = feeChangeAt !== undefined && feeChangeAt > 0n && Number(feeChangeAt) > PAGE_LOAD_SEC
  const feeLine = feeNow === undefined
    ? null
    : `Protocol fee: ${Number(feeNow) / 100}% of the principal` +
      (feeChanging && feePending !== undefined
        ? `, changing to ${Number(feePending) / 100}% on ${new Date(Number(feeChangeAt) * 1000).toLocaleString()}.`
        : '.')

  const { data: activationDeadline } = useReadContract({
    address: addresses.registry,
    abi: REGISTRY_ABI,
    functionName: 'activationDeadline',
    args: [normalizedDealId],
    chainId,
    query: { enabled: hasValidId && deal?.state === DealState.Confirmed },
  })

  const { data: isExpired } = useReadContract({
    address: addresses.registry,
    abi: REGISTRY_ABI,
    functionName: 'isExpired',
    args: [normalizedDealId],
    chainId,
    query: { enabled: hasValidId && deal?.state === DealState.Proposed },
  })

  const { data: claimableUsdc, refetch: refetchClaimUsdc } = useReadContract({
    address: addresses.vault,
    abi: VAULT_ABI,
    functionName: 'claimable',
    args: [addresses.usdc, address ?? ZERO],
    chainId,
    query: { enabled: !!address },
  })
  const { data: claimableCirBtc, refetch: refetchClaimBtc } = useReadContract({
    address: addresses.vault,
    abi: VAULT_ABI,
    functionName: 'claimable',
    args: [addresses.cirBtc, address ?? ZERO],
    chainId,
    query: { enabled: !!address },
  })

  const { data: usdcPaused } = useReadContract({
    address: addresses.usdc, abi: PAUSED_ABI, functionName: 'paused', chainId,
    query: { enabled: isOpenLoan, retry: false },
  })
  const { data: cirBtcPaused } = useReadContract({
    address: addresses.cirBtc, abi: PAUSED_ABI, functionName: 'paused', chainId,
    query: { enabled: isOpenLoan, retry: false },
  })
  const tokenPaused = usdcPaused === true || cirBtcPaused === true

  const { data: cirBtcAllowance, refetch: refetchCirBtcAllowance } = useReadContract({
    address: addresses.cirBtc,
    abi: ERC20_APPROVE_ABI,
    functionName: 'allowance',
    args: [address ?? ZERO, addresses.vault],
    chainId,
    query: { enabled: !!address && (deal?.state === DealState.Confirmed || deal?.state === DealState.Active) },
  })

  const { data: usdcAllowance, refetch: refetchUsdcAllowance } = useReadContract({
    address: addresses.usdc,
    abi: ERC20_APPROVE_ABI,
    functionName: 'allowance',
    args: [address ?? ZERO, addresses.vault],
    chainId,
    query: { enabled: !!address && (deal?.state === DealState.Confirmed || isOpenLoan) },
  })

  const isConfirmedDeal = deal?.state === DealState.Confirmed
  const partyRead = (token: `0x${string}`, functionName: 'allowance' | 'balanceOf', args: readonly unknown[]) => ({
    address: token, abi: ERC20_APPROVE_ABI, functionName, args, chainId,
    query: { enabled: isConfirmedDeal, refetchInterval: 15_000 },
  }) as any
  const { data: lenderUsdcAllowance, refetch: refetchLenderAllowance } = useReadContract(partyRead(addresses.usdc, 'allowance', [deal?.lender ?? ZERO, addresses.vault]))
  const { data: lenderUsdcBalance } = useReadContract(partyRead(addresses.usdc, 'balanceOf', [deal?.lender ?? ZERO]))
  const { data: borrowerBtcAllowance, refetch: refetchBorrowerAllowance } = useReadContract(partyRead(addresses.cirBtc, 'allowance', [deal?.borrower ?? ZERO, addresses.vault]))
  const { data: borrowerBtcBalance } = useReadContract(partyRead(addresses.cirBtc, 'balanceOf', [deal?.borrower ?? ZERO]))

  const { data: counterOffers, refetch: refetchOffers } = useReadContract({
    address: addresses.registry,
    abi: REGISTRY_ABI,
    functionName: 'getActiveCounterOffers',
    args: [normalizedDealId],
    chainId,
    query: { enabled: hasValidId && deal?.state === DealState.Proposed },
  })

  const { writeContract: rawWrite, data: hash, isPending, error, reset } = useWriteContract()
  const [confirmOfferId, setConfirmOfferId] = useState<bigint | null>(null)
  const { balance: walletCirBtc } = useCirBtcBalance()
  const [expandedOfferId, setExpandedOfferId] = useState<bigint | null>(null)
  const [topUp, setTopUp] = useState('')

  // Simulate first so a call that would revert shows its real reason instead of failing on-chain.
  const writeContract = (params: any) => {
    if (!address) return
    const { gas: _gas, chainId: _chainId, ...call } = params
    getArcClient()
      .simulateContract({ ...call, account: address })
      .then(() => rawWrite(params))
      .catch((e: unknown) => toast.error(parseOnchainError(e), { duration: 8000 }))
  }

  useEffect(() => {
    if (error) toast.error(parseOnchainError(error), { duration: 8000 })
  }, [error])

  const { isLoading: isConfirming, isSuccess: receiptReady, data: receipt } = useWaitForTransactionReceipt({
    hash,
    chainId,
    query: { enabled: Boolean(hash) },
  })
  const isSuccess = receiptReady && receipt?.status === 'success'
  const reverted = receiptReady && receipt?.status === 'reverted'

  useEffect(() => {
    if (reverted) toast.error('Transaction failed on-chain. Nothing was changed.', { duration: 8000 })
  }, [reverted])

  useEffect(() => {
    if (isSuccess) {
      void refetch()
      void refetchOffers()
      void refetchDue()
      void refetchUsdcAllowance()
      void refetchCirBtcAllowance()
      void refetchClaimUsdc()
      void refetchClaimBtc()
      void refetchLocked()
      void refetchLenderAllowance()
      void refetchBorrowerAllowance()
      toast.success('Transaction confirmed')
    }
  }, [isSuccess, refetch, refetchOffers, refetchDue, refetchUsdcAllowance, refetchCirBtcAllowance, refetchClaimUsdc, refetchClaimBtc])

  if (!dealIdParam || !hasValidId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <AlertTriangle size={36} className="mx-auto mb-4 text-[#ff8a00]" />
        <h2 className="font-['Space_Grotesk'] text-xl font-bold mb-2 text-[#ebe0d9]">
          Invalid Deal Identifier
        </h2>
        <p className="text-sm text-[#ddc1ae] max-w-md mx-auto mb-6">
          The requested Deal ID (<code className="mono text-[#ff8a00]">{dealIdParam || 'empty'}</code>) is not a valid 16-byte deal identifier. On Arc, deal identifiers are 34-character hexadecimal hashes (e.g. <code>0x8f9024a...</code>).
        </p>
        <div className="flex justify-center gap-3">
          <Link to="/dashboard" className="px-5 py-2.5 rounded-full bg-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold no-underline">
            Back to Dashboard
          </Link>
          <Link to="/marketplace" className="px-5 py-2.5 rounded-full bg-[#241f1a] text-[#ebe0d9] font-['Space_Grotesk'] text-xs font-bold border border-[#564334]/40 no-underline">
            Browse Marketplace
          </Link>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Card className="animate-pulse h-48" />
      </div>
    )
  }

  if (!deal || readError) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <AlertTriangle size={32} className="mx-auto mb-3 text-[#ff8a00]" />
        <p className="text-sm text-[#ddc1ae] mb-4">No deal found on {chain?.name ?? 'Arc'} for ID: <code className="mono text-[#ff8a00]">{dealIdParam}</code></p>
        <Link to="/dashboard" className="px-4 py-2 rounded-full bg-[#241f1a] text-[#ebe0d9] font-['Space_Grotesk'] text-xs font-bold border border-[#564334]/40 no-underline">
          Return to Dashboard
        </Link>
      </div>
    )
  }

  const { interest, total } = computeRepayment(deal.principal, deal.rateBps, deal.durationMonths)
  const isBorrower = address?.toLowerCase() === deal.borrower.toLowerCase()
  const isLender = address?.toLowerCase() === deal.lender.toLowerCase()
  const isCreatorWaiting = deal.state === DealState.Proposed && (isBorrower || isLender) && !isExpired
  // Private links: the key is in this browser's storage, or can be rebuilt when the deal is reserved for an address.
  const inviteSalt = (() => {
    if (!isCreatorWaiting || deal.visibility !== 0) return undefined
    const stored = getStoredDeals().find((d) => d.dealId.toLowerCase() === normalizedDealId.toLowerCase())?.salt
    if (stored) return stored
    if (deal.reservedFor !== ZERO) {
      const candidate = deriveSaltForCounterparty(deal.dealId, deal.reservedFor)
      const token = keccak256(encodeAbiParameters(parseAbiParameters('bytes16, bytes32'), [deal.dealId, candidate]))
      if (token.toLowerCase() === deal.claimToken.toLowerCase()) return candidate
    }
    return undefined
  })()

  const dueNow = amountDue ?? total
  const repayApprovalAmount = total + (deal.principal * LATE_FEE_BPS) / 10_000n
  const needsRepayApproval = isBorrower && isOpenLoan &&
    (usdcAllowance === undefined || usdcAllowance < dueNow)

  const collateralUsd = lockedCollateral !== undefined && hasPrice
    ? Number(lockedCollateral) / 1e8 * btcPrice
    : null
  const ltvPct = collateralUsd && collateralUsd > 0 ? (Number(dueNow) / 1e6) / collateralUsd * 100 : null
  const liqPct = liquidationThresholdBps !== undefined ? Number(liquidationThresholdBps) / 100 : 80
  const maxInitPct = maxInitialLtvBps !== undefined ? Number(maxInitialLtvBps) / 100 : 65
  const healthColor = ltvPct === null ? 'var(--subtle)'
    : ltvPct >= liqPct ? 'var(--danger)'
    : ltvPct >= liqPct - 10 ? '#f59e0b'
    : 'var(--success)'

  const liquidationRepay = collateralUsd !== null
    ? (() => {
        const maxRepay = BigInt(Math.floor(collateralUsd * 1e6)) * 10_000n / (10_000n + LIQUIDATION_BONUS_BPS)
        return dueNow < maxRepay ? dueNow : maxRepay
      })()
    : dueNow
  const isThirdParty = !!address && !isLender && !isBorrower
  const needsLiquidationApproval = isOpenLoan && isThirdParty &&
    (usdcAllowance === undefined || usdcAllowance < liquidationRepay)

  const opensAt = liquidationOpensAt !== undefined ? Number(liquidationOpensAt) : null
  const maturityTs = deal.activatedAt > 0n
    ? Number(deal.activatedAt) + Number(deal.durationMonths) * 30 * 24 * 3600
    : null
  const isPastMaturity = maturityTs !== null && PAGE_LOAD_SEC > maturityTs
  const isPastGrace = opensAt !== null && PAGE_LOAD_SEC > opensAt
  const deadlineTs = activationDeadline !== undefined && activationDeadline > 0n ? Number(activationDeadline) : null
  const activationClosed = deadlineTs !== null && PAGE_LOAD_SEC > deadlineTs

  const lenderApproved = ((lenderUsdcAllowance as bigint | undefined) ?? 0n) >= deal.principal
  const lenderFunded = ((lenderUsdcBalance as bigint | undefined) ?? 0n) >= deal.principal
  const borrowerApproved = ((borrowerBtcAllowance as bigint | undefined) ?? 0n) >= deal.collateral
  const borrowerFunded = ((borrowerBtcBalance as bigint | undefined) ?? 0n) >= deal.collateral
  const lenderReady = lenderApproved && lenderFunded
  const borrowerReady = borrowerApproved && borrowerFunded
  const deadlineText = (() => {
    if (deadlineTs === null) return ''
    const left = Math.max(0, deadlineTs - Math.floor(Date.now() / 1000))
    const h = Math.floor(left / 3600)
    const m = Math.floor((left % 3600) / 60)
    return `${h > 0 ? `${h} h ` : ''}${m} min left, until ${new Date(deadlineTs * 1000).toLocaleString()}`
  })()

  const hasClaimable = (claimableUsdc ?? 0n) > 0n || (claimableCirBtc ?? 0n) > 0n

  function dispatch(action: Action) {
    if (!hasValidId || !address) return
    reset()
    writeContract({
      address: addresses.vault,
      abi: VAULT_ABI,
      functionName: action,
      args: [normalizedDealId],
      chainId,
      gas: GAS[action],
    })
  }

  function cancelDeal() {
    if (!hasValidId || !address) return
    reset()
    writeContract({
      address: addresses.registry,
      abi: REGISTRY_ABI,
      functionName: 'cancelDeal',
      args: [normalizedDealId],
      chainId,
      gas: 100_000n,
    })
  }

  function acceptOffer(offerId: bigint) {
    setConfirmOfferId(null)
    if (!hasValidId || !address) return
    reset()
    writeContract({
      address: addresses.registry,
      abi: REGISTRY_ABI,
      functionName: 'acceptCounterOffer',
      args: [normalizedDealId, offerId],
      chainId,
      gas: 300_000n,
    })
  }

  function approveToken(token: 'cirBtc' | 'usdc', amount: bigint) {
    if (!address) return
    reset()
    const current = (token === 'cirBtc' ? cirBtcAllowance : usdcAllowance) ?? 0n
    writeContract({
      address: token === 'cirBtc' ? addresses.cirBtc : addresses.usdc,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [addresses.vault, current + amount],
      chainId,
      gas: 100_000n,
    })
  }

  function rejectOffer(offerId: bigint) {
    if (!hasValidId || !address) return
    reset()
    writeContract({
      address: addresses.registry,
      abi: REGISTRY_ABI,
      functionName: 'rejectCounterOffer',
      args: [normalizedDealId, offerId],
      chainId,
      gas: 150_000n,
    })
  }

  function addCollateral(amount: bigint) {
    if (!hasValidId || !address || amount <= 0n) return
    reset()
    writeContract({
      address: addresses.vault,
      abi: VAULT_ABI,
      functionName: 'addCollateral',
      args: [normalizedDealId, amount],
      chainId,
      gas: 200_000n,
    })
  }

  function withdraw(token: `0x${string}`) {
    if (!address) return
    reset()
    writeContract({
      address: addresses.vault,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [token],
      chainId,
      gas: 150_000n,
    })
  }

  function notePause() {
    reset()
    writeContract({
      address: addresses.vault,
      abi: VAULT_ABI,
      functionName: 'notePause',
      chainId,
      gas: 120_000n,
    })
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="display text-2xl font-bold mb-1" style={{ color: 'var(--ink)' }}>
            Manage Loan
          </h1>
          <div className="flex items-center gap-1.5 min-w-0 text-xs" style={{ color: 'var(--subtle)' }}>
            <code className="mono truncate" title={normalizedDealId}>
              <span className="sm:hidden">{`${normalizedDealId.slice(0, 10)}…${normalizedDealId.slice(-6)}`}</span>
              <span className="hidden sm:inline">{normalizedDealId}</span>
            </code>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(normalizedDealId).then(() => toast.success('Deal ID copied')).catch(() => {}) }}
              className="shrink-0 p-1 rounded-md hover:bg-[var(--surface-muted)] cursor-pointer"
              aria-label="Copy deal ID"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
        <Badge className={`shrink-0 ${dealStateColor(deal.state)}`}>
          {isExpired || (isConfirmedDeal && activationClosed) ? 'Expired' : dealStateLabel(deal.state)}
        </Badge>
      </div>

      {hasClaimable && (
        <Card className="mb-4 border border-[var(--success)]/40">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
            Funds waiting for you
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>
            A payment to your address could not be delivered directly (for example during a token pause or freeze),
            so the vault is holding it for you. It stays yours until you withdraw it.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            {(claimableUsdc ?? 0n) > 0n && (
              <Button variant="primary" size="sm" className="flex-1" disabled={isPending || isConfirming} onClick={() => withdraw(addresses.usdc)}>
                <Download size={13} />
                Withdraw {formatUsdc(claimableUsdc!)} USDC
              </Button>
            )}
            {(claimableCirBtc ?? 0n) > 0n && (
              <Button variant="primary" size="sm" className="flex-1" disabled={isPending || isConfirming} onClick={() => withdraw(addresses.cirBtc)}>
                <Download size={13} />
                Withdraw {formatBtc(claimableCirBtc!)} cirBTC
              </Button>
            )}
          </div>
          <p className="text-[11px] mt-3" style={{ color: 'var(--subtle)' }}>
            Withdrawn cirBTC lands in your wallet. You can then convert it to BTC from your Dashboard.
          </p>
        </Card>
      )}

      {(deal.state === DealState.Completed || deal.state === DealState.Liquidated) && (isBorrower || isLender) && (walletCirBtc ?? 0n) > 0n && (
        <Card className="mb-4 border border-[#f7931a]/30">
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>
            {deal.state === DealState.Completed && isBorrower ? 'Your cirBTC is back in your wallet.' : 'Holding cirBTC?'}
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>
            Convert it to native BTC on the Bitcoin network whenever you want.
          </p>
          <ConvertToBtc variant="primary" className="w-full sm:w-auto" />
        </Card>
      )}

      <Card className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--subtle)' }}>
          Loan Terms
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat label="Principal" value={`$${formatUsdc(deal.principal)}`} />
          {isOpenLoan && lockedCollateral !== undefined && lockedCollateral > deal.collateral ? (
            <Stat
              label="Collateral"
              value={`${formatBtc(lockedCollateral)} cirBTC`}
              sub={`${formatBtc(deal.collateral)} at start, then added`}
            />
          ) : (
            <Stat label="Collateral" value={`${formatBtc(deal.collateral)} cirBTC`} />
          )}
          <Stat label="Rate" value={formatBps(deal.rateBps)} sub="per year" />
          <Stat label="Duration" value={`${deal.durationMonths}mo`} />
          <div className="col-span-2 md:col-span-1">
            {isOpenLoan ? (
              <Stat label="Due Now" value={`$${formatUsdc(dueNow)}`} sub={`max $${formatUsdc(total)} at maturity`} />
            ) : (
              <Stat label="Max Total Due" value={`$${formatUsdc(total)}`} sub={`+$${formatUsdc(interest)} interest`} />
            )}
          </div>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--subtle)' }}>
          Interest accrues pro rata with a one-month minimum, so repaying early costs less.
        </p>
      </Card>

      <Card className="mb-4">
        <div className="space-y-2 text-sm">
          {[
            ['Borrower', deal.borrower, isBorrower],
            ['Lender', deal.lender, isLender],
          ].map(([role, addr, isYou]) => (
            <div key={role as string} className="flex justify-between items-center">
              <span style={{ color: 'var(--subtle)' }}>
                {role as string}{isYou ? ' (you)' : ''}
              </span>
              <code className="mono text-xs" style={{ color: isYou ? 'var(--accent)' : 'var(--muted)' }}>
                {addr === ZERO ? '—' : shortAddr(addr as string)}
              </code>
            </div>
          ))}
          {deal.activatedAt > 0n && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--subtle)' }}>Maturity</span>
              <span className="text-xs" style={{ color: isPastMaturity ? 'var(--danger)' : 'var(--muted)' }}>
                {maturityTs ? new Date(maturityTs * 1000).toLocaleDateString() : '—'}{' '}
                {isPastMaturity ? '(matured)' : ''}
              </span>
            </div>
          )}
          {opensAt !== null && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--subtle)' }}>Overdue liquidation opens</span>
              <span className="text-xs" style={{ color: isPastGrace ? 'var(--danger)' : 'var(--muted)' }}>
                {new Date(opensAt * 1000).toLocaleString()}
              </span>
            </div>
          )}
          {deal.state === DealState.Confirmed && deadlineTs !== null && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--subtle)' }}>Start before</span>
              <span className="text-xs" style={{ color: activationClosed ? 'var(--danger)' : 'var(--muted)' }}>
                {new Date(deadlineTs * 1000).toLocaleString()} {activationClosed ? '(window closed)' : ''}
              </span>
            </div>
          )}
        </div>
      </Card>

      {(() => {
        if (!(deal.state === DealState.Proposed && (isBorrower || isLender) && deal.visibility === 1)) return null
        const nowSec = BigInt(Math.floor(Date.now() / 1000))
        const active = (counterOffers ?? []).filter((o) => o.active)
        const terms = (o: { principal: bigint; collateral: bigint; rateBps: bigint; durationMonths: number }) => [
          { k: 'Amount', v: `$${formatUsdc(o.principal).replace(/\.00$/, '')} USDC`, was: o.principal !== deal.principal ? `$${formatUsdc(deal.principal).replace(/\.00$/, '')}` : null },
          { k: 'Collateral', v: `${formatBtc(o.collateral)} cirBTC`, was: o.collateral !== deal.collateral ? formatBtc(deal.collateral) : null },
          { k: 'Annual rate', v: formatBps(o.rateBps), was: o.rateBps !== deal.rateBps ? formatBps(deal.rateBps) : null },
          { k: 'Duration', v: `${o.durationMonths} month${o.durationMonths > 1 ? 's' : ''}`, was: o.durationMonths !== deal.durationMonths ? `${deal.durationMonths}` : null },
        ]
        // Best offer for the creator first: highest rate when lending, lowest when borrowing. Same rate: oldest first.
        const creatorLends = isLender
        const sorted = [...active].sort((x, y) => {
          if (x.rateBps !== y.rateBps) return (creatorLends ? y.rateBps > x.rateBps : x.rateBps > y.rateBps) ? 1 : -1
          return x.offerId < y.offerId ? -1 : x.offerId > y.offerId ? 1 : 0
        })
        const ltvColor = (r: number) => (!hasPrice ? 'var(--subtle)' : r > maxInitPct ? 'var(--danger)' : r > maxInitPct - 5 ? '#f7931a' : '#10b981')
        const offersCard = (
          <Card className="mb-4 border border-[var(--accent)]/50" id="offers">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
              Offers to review {active.length > 0 && `(${active.length})`}
            </p>
            {isExpired ? (
              <p className="text-sm" style={{ color: 'var(--subtle)' }}>
                This order has expired (30 days). Cancel it and post a new one with current terms.
              </p>
            ) : active.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--subtle)' }}>
                No offers yet. Users send them from the{' '}
                <Link to="/marketplace" className="underline" style={{ color: 'var(--accent)' }}>Marketplace</Link>.
              </p>
            ) : (
              <>
                <p className="text-xs mb-2" style={{ color: 'var(--subtle)' }}>
                  Compared with your terms above. {creatorLends ? 'Highest rate first.' : 'Lowest rate first.'} Accept one offer to lock its terms; the others are then dismissed.
                </p>
                <ul className="m-0 p-0 list-none divide-y" style={{ borderColor: 'var(--border)' }}>
                  {sorted.map((o) => {
                    const changes = terms(o).filter((t) => t.was)
                    const r = hasPrice ? computeRltv(o.collateral, btcPrice, o.principal, o.rateBps, o.durationMonths) : 0
                    const blocked = hasPrice && r > maxInitPct
                    const open = expandedOfferId === o.offerId || confirmOfferId === o.offerId
                    return (
                      <li key={o.offerId.toString()} className="py-2.5" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedOfferId(open ? null : o.offerId)}
                            className="min-w-0 flex-1 text-left cursor-pointer bg-transparent border-0 p-0"
                            aria-expanded={open}
                          >
                            <p className="text-xs flex items-center gap-2 flex-wrap" style={{ color: 'var(--subtle)' }}>
                              <span className="mono" style={{ color: 'var(--muted)' }}>{shortAddr(o.proposer)}</span>
                              <span className="font-semibold tabular-nums" style={{ color: ltvColor(r) }}>
                                RLTV {hasPrice ? `${r.toFixed(1)}%` : '—'}
                              </span>
                            </p>
                            <p className="text-xs mt-0.5 truncate" style={{ color: changes.length ? '#f7931a' : 'var(--success)' }}>
                              {changes.length === 0 ? 'Same terms as your order' : changes.map((t) => `${t.k} ${t.v}`).join(' · ')}
                            </p>
                          </button>
                          {o.expiresAt < nowSec ? (
                            <span className="shrink-0 text-[11px] px-2 py-1 rounded-full" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}>Expired</span>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              className="shrink-0 flex items-center gap-1"
                              disabled={isPending || isConfirming}
                              onClick={() => { setExpandedOfferId(o.offerId); setConfirmOfferId(o.offerId) }}
                            >
                              <Check size={12} /> Accept
                            </Button>
                          )}
                        </div>
                        {open && (
                          <div className="mt-2 rounded-lg p-2.5" style={{ background: 'var(--surface-muted)' }}>
                            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 m-0">
                              {terms(o).map((t) => (
                                <div key={t.k} className="min-w-0">
                                  <dt className="text-[11px]" style={{ color: 'var(--subtle)' }}>{t.k}</dt>
                                  <dd className="m-0 text-sm font-semibold tabular-nums" style={{ color: t.was ? '#f7931a' : 'var(--ink)' }}>
                                    {t.v}
                                    {t.was && <span className="block text-[10px] font-normal" style={{ color: 'var(--subtle)' }}>was {t.was}</span>}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                            {blocked && (
                              <p className="text-xs mt-2 p-2 rounded-lg" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}>
                                Can't be activated at the current BTC price (max {maxInitPct}%). If you accept it, the loan stays blocked
                                until the price rises or the deal is cancelled.
                              </p>
                            )}
                            <div className="flex items-center justify-between gap-2 mt-2 text-[11px]" style={{ color: 'var(--subtle)' }}>
                              <span>
                                {o.expiresAt < nowSec
                                  ? 'This offer has expired.'
                                  : `Valid ${Math.max(1, Math.ceil(Number(o.expiresAt - nowSec) / 86400))} more day(s).`}
                              </span>
                              <button
                                type="button"
                                disabled={isPending || isConfirming}
                                onClick={() => rejectOffer(o.offerId)}
                                className="font-semibold cursor-pointer disabled:opacity-50"
                                style={{ color: 'var(--danger)' }}
                              >
                                Decline offer
                              </button>
                            </div>
                            {confirmOfferId === o.offerId && (
                              <div className="mt-2 text-xs">
                                <p className="mb-2" style={{ color: 'var(--ink)' }}>
                                  Accept this offer? Its terms become final and the other offers are dismissed.
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                  <Button variant="secondary" size="sm" className="w-full" onClick={() => setConfirmOfferId(null)}>Back</Button>
                                  <Button variant="primary" size="sm" className="w-full" disabled={isPending || isConfirming} onClick={() => acceptOffer(o.offerId)}>
                                    <Check size={12} /> Confirm
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </Card>
        )
        const liveCard = isCreatorWaiting ? (
          <Card className="mb-4 border border-[var(--success)]/40">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--success)' }}>
              Your order is live on the Marketplace.
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>
              Anyone can send you an offer with these terms or different ones. You choose which one to accept. Nothing leaves
              your wallet until the loan is activated.
            </p>
            <Link to="/marketplace" className="inline-flex items-center gap-1.5 text-xs font-bold no-underline" style={{ color: 'var(--accent)' }}>
              <Store size={14} /> View on Marketplace
            </Link>
          </Card>
        ) : null
        // Offers waiting: they come first. Otherwise the "live" notice leads.
        return active.length > 0 ? <>{offersCard}{liveCard}</> : <>{liveCard}{offersCard}</>
      })()}

      {isCreatorWaiting && deal.visibility === 0 && (
        inviteSalt ? (
          <ShareDealCard dealId={normalizedDealId} salt={inviteSalt} reservedFor={deal.reservedFor !== ZERO ? deal.reservedFor : undefined} />
        ) : (
          <Card className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
              Invitation link
            </p>
            <p className="text-sm" style={{ color: 'var(--subtle)' }}>
              The link for this deal is kept only in the browser where you created it. Open this page there to copy it
              again, or cancel this deal and create a new one.
            </p>
          </Card>
        )
      )}

      {deal.state === DealState.Proposed && !isBorrower && !isLender && deal.visibility === 1 && !isExpired && (
        <Card className="mb-4 border border-[var(--accent)]/40">
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>
            This order is open on the Marketplace.
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>
            Make an offer {deal.borrower !== ZERO ? 'to lend' : 'to borrow'}: send these terms as they are, or propose
            different ones. The creator picks one offer.
          </p>
          <Link to={`/marketplace?counter=${normalizedDealId.toLowerCase()}`} className="no-underline">
            <Button variant="primary" size="sm" className="w-full">Make an offer</Button>
          </Link>
        </Card>
      )}


      {isOpenLoan && lockedCollateral !== undefined && (
        <Card className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
            Loan Health
          </p>
          <div className="flex items-baseline justify-between mb-2">
            <p className="display text-xl font-bold tabular-nums" style={{ color: healthColor }}>
              {ltvPct === null ? 'LTV unavailable' : `LTV ${ltvPct.toFixed(1)}%`}
            </p>
            <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
              {formatBtc(lockedCollateral)} cirBTC
              {collateralUsd !== null && ` ≈ $${collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            </p>
          </div>
          {ltvPct !== null && (
            <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--surface-muted)' }}>
              <div className="h-full" style={{ width: `${Math.min(ltvPct / liqPct * 100, 100)}%`, background: healthColor }} />
            </div>
          )}
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            Liquidation opens at {liqPct}% LTV, or once the overdue date above has passed. A 2% late fee applies after maturity.
            BTC price: {hasPrice ? `$${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'} ({priceSource}{priceStale ? ', stale' : ''}).
            Collateral is valued at the BTC price; new loans are blocked if cirBTC trades more than 2% away from it.
          </p>
          {isBorrower && deal.state === DealState.Active && (() => {
            const sats = parseBtc(topUp)
            const allowanceOk = (cirBtcAllowance ?? 0n) >= sats
            return (
              <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ink)' }}>Add collateral</p>
                <p className="text-[11px] mb-2" style={{ color: 'var(--subtle)' }}>
                  Lower your LTV to avoid liquidation. The extra cirBTC is returned with the rest when you repay.
                </p>
                <div className="flex gap-2">
                  <input
                    value={topUp}
                    onChange={(e) => setTopUp(e.target.value)}
                    type="number"
                    min="0"
                    inputMode="decimal"
                    placeholder="0.05"
                    aria-label="cirBTC to add"
                    className="flex-1 min-w-0 rounded-xl px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  />
                  {allowanceOk ? (
                    <Button variant="primary" size="sm" disabled={sats <= 0n || isPending || isConfirming} onClick={() => addCollateral(sats)}>
                      Add cirBTC
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" disabled={sats <= 0n || isPending || isConfirming} onClick={() => approveToken('cirBtc', sats - (cirBtcAllowance ?? 0n))}>
                      Step 1 of 2 · Approve
                    </Button>
                  )}
                </div>
              </div>
            )
          })()}
        </Card>
      )}

      {isOpenLoan && tokenPaused && (
        <Card className="mb-4 border border-[#f59e0b]/40">
          <div className="flex items-start gap-2 text-xs" style={{ color: '#f59e0b' }}>
            <PauseCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold mb-1">{usdcPaused ? 'USDC' : 'cirBTC'} is currently paused by its issuer.</p>
              <p className="mb-2" style={{ color: 'var(--subtle)' }}>
                Liquidations are blocked during a pause. Recording it on-chain gives borrowers a 3-day window to repay
                after the pause ends, and waives the late fee if the pause started during the grace period.
              </p>
              <Button variant="secondary" size="sm" disabled={isPending || isConfirming} onClick={notePause}>
                Record the pause on-chain
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {(deal.state === DealState.Proposed || deal.state === DealState.Confirmed) &&
          (isBorrower || isLender) && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full border"
            style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}
            disabled={isPending || isConfirming}
            onClick={cancelDeal}
          >
            <XCircle size={13} />
            {isConfirmedDeal && activationClosed ? 'Close this deal' : 'Cancel Deal'}
          </Button>
        )}
        {isCreatorWaiting && (
          <Link to="/deal/new" className="no-underline">
            <Button variant="secondary" className="w-full flex items-center justify-center gap-1.5">
              <Plus size={14} /> Create another deal
            </Button>
          </Link>
        )}

        {deal.state === DealState.Confirmed && (isBorrower || isLender) && activationClosed && (
          <Card>
            <p className="font-semibold text-sm mb-1" style={{ color: 'var(--ink)' }}>Not started in time</p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              The loan had to start within 24 hours of the deal being accepted. No funds moved. Close this deal, then create
              a new one if you still want this loan.
            </p>
          </Card>
        )}

        {deal.state === DealState.Confirmed && (isBorrower || isLender) && !activationClosed && (
          <Card>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Start the loan</p>
            <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>{deadlineText}</p>
            <ol className="flex flex-col gap-2 mb-3">
              {[
                {
                  who: isLender ? 'You (lender)' : 'Lender',
                  what: `${isLender ? 'approve' : 'approves'} $${formatUsdc(deal.principal).replace(/\.00$/, '')} USDC`,
                  done: lenderReady,
                  note: lenderApproved && !lenderFunded ? 'approved, but the wallet holds less than this amount' : 'waiting',
                },
                {
                  who: isBorrower ? 'You (borrower)' : 'Borrower',
                  what: `${isBorrower ? 'approve' : 'approves'} ${formatBtc(deal.collateral)} cirBTC`,
                  done: borrowerReady,
                  note: borrowerApproved && !borrowerFunded ? 'approved, but the wallet holds less than this amount' : 'waiting',
                },
              ].map((step) => (
                <li key={step.who} className="flex items-start gap-2 text-xs">
                  <span
                    className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: step.done ? 'var(--success)' : 'transparent', border: step.done ? 'none' : '1px solid var(--border)' }}
                  >
                    {step.done && <Check size={10} color="#17120f" />}
                  </span>
                  <span style={{ color: 'var(--muted)' }}>
                    <strong style={{ color: 'var(--ink)' }}>{step.who}</strong> {step.what}
                    {!step.done && <span style={{ color: 'var(--subtle)' }}> · {step.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Approving moves nothing. Once both are done, either of you can start the loan: the cirBTC goes to escrow and
              the USDC goes to the borrower in the same transaction, so nobody sends funds first.
            </p>
          </Card>
        )}

        {deal.state === DealState.Confirmed && isLender && !activationClosed && !lenderApproved && (
          <>
            <GetFundsPanel need="usdc" required={deal.principal} title="Need USDC on Arc to fund this loan?" />
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={isPending || isConfirming}
              onClick={() => approveToken('usdc', deal.principal)}
            >
              <ShieldCheck size={15} />
              Step 1 of 2 · Approve ${formatUsdc(deal.principal).replace(/\.00$/, '')} USDC
            </Button>
          </>
        )}

        {deal.state === DealState.Confirmed && isBorrower && !activationClosed && !borrowerApproved && (
          <>
            <GetFundsPanel need="cirBtc" required={deal.collateral} title="Need cirBTC for the collateral?" />
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={isPending || isConfirming}
              onClick={() => approveToken('cirBtc', deal.collateral)}
            >
              <ShieldCheck size={15} />
              Step 1 of 2 · Approve {formatBtc(deal.collateral)} cirBTC
            </Button>
          </>
        )}

        {deal.state === DealState.Confirmed && !activationClosed && ((isLender && lenderApproved) || (isBorrower && borrowerApproved)) && (
          <>
            {!(lenderReady && borrowerReady) && (
              <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
                {(isLender ? lenderReady : borrowerReady)
                  ? `Done on your side. Nothing leaves your wallet until the loan starts. Waiting for the ${isLender ? 'borrower to approve the cirBTC' : 'lender to approve the USDC'}; you can cancel until then.`
                  : 'Your approval is in place, but your wallet holds less than the amount needed. Top it up to start the loan.'}
              </p>
            )}
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!(lenderReady && borrowerReady) || isPending || isConfirming}
              onClick={() => dispatch('activateLoan')}
            >
              <Zap size={15} />
              Step 2 of 2 · Start the loan
            </Button>
            <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
              {isBorrower
                ? 'The principal (minus the protocol fee) is sent straight to your wallet.'
                : `$${formatUsdc(deal.principal).replace(/\.00$/, '')} USDC leaves your wallet; the borrower receives it minus the protocol fee.`}
              {` The loan-to-value must be at most ${maxInitPct}% at the current BTC price.`}
            </p>
            {feeLine && <p className="text-xs text-center" style={{ color: feeChanging ? '#f59e0b' : 'var(--subtle)' }}>{feeLine}</p>}
          </>
        )}

        {needsRepayApproval && (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={isPending || isConfirming}
            onClick={() => approveToken('usdc', repayApprovalAmount)}
          >
            <ShieldCheck size={15} />
            Step 1 of 2 · Approve USDC for repayment
          </Button>
        )}

        {isOpenLoan && isBorrower && (
          <Button
            variant={deal.state === DealState.Defaulted ? 'danger' : 'primary'}
            size="lg"
            className="w-full"
            disabled={needsRepayApproval || isPending || isConfirming}
            onClick={() => dispatch('repayLoan')}
          >
            <RotateCcw size={15} />
            {needsRepayApproval ? 'Step 2 of 2 · ' : ''}Repay ${formatUsdc(dueNow)}{isPastMaturity ? ' (incl. late fee if due)' : ''}
          </Button>
        )}

        {deal.state === DealState.Active && isPastMaturity && (
          <Button
            variant="danger"
            size="lg"
            className="w-full"
            disabled={isPending || isConfirming}
            onClick={() => dispatch('markDefault')}
          >
            <ShieldAlert size={15} />
            Mark Default
          </Button>
        )}

        {isOpenLoan && needsLiquidationApproval && (
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            disabled={isPending || isConfirming}
            onClick={() => approveToken('usdc', dueNow)}
          >
            <ShieldCheck size={13} />
            Step 1 of 2 · Approve up to ${formatUsdc(dueNow)} USDC to liquidate
          </Button>
        )}

        {isOpenLoan && !isBorrower && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full border"
            style={{ borderColor: 'var(--border)' }}
            disabled={isPending || isConfirming || tokenPaused || needsLiquidationApproval}
            onClick={() => dispatch('liquidate')}
          >
            <Zap size={13} />
            {isLender
              ? (isPastGrace ? 'Liquidate overdue loan (receive cirBTC)' : 'Trigger liquidation (receive cirBTC)')
              : (isPastGrace ? 'Liquidate overdue loan (repay lender in USDC)' : 'Trigger liquidation (repay lender in USDC)')}
          </Button>
        )}
        {isOpenLoan && !isBorrower && (
          <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
            A liquidator repays the lender in USDC and receives the matching cirBTC plus a 3% bonus; any surplus
            goes back to the borrower. The lender can also liquidate directly and take the cirBTC instead.
          </p>
        )}
      </div>

      {(isPending || isConfirming || isSuccess || reverted || error) && (
        <div className="mt-4">
          <TxStatus
            isPending={isPending}
            isConfirming={isConfirming}
            isSuccess={isSuccess}
            error={error ? parseOnchainError(error) : reverted ? 'Transaction failed on-chain. Nothing was changed.' : null}
            explorerUrl={hash ? `${chain.blockExplorers.default.url}/tx/${hash}` : undefined}
          />
        </div>
      )}

      {!isConnected && (
        <div className="mt-4 rounded-xl p-3 text-sm text-center" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}>
          Connect your wallet to manage this deal
        </div>
      )}
      {isConnected && isWrongChain && (
        <div className="mt-4 rounded-xl p-3 text-sm text-center" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)' }}>
          Switch your wallet to Arc Mainnet (chain ID 5042)
        </div>
      )}
    </div>
  )
}
