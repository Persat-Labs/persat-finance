// oxlint-disable
import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { Shield, AlertTriangle, Sparkles, Copy, ArrowRight, CheckCircle2, Lock } from 'lucide-react'
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
} from '../lib/utils'
import { REGISTRY_ABI } from '../contracts/abis'
import { useArcNetwork } from '../hooks/useArcNetwork'
import { addArcNetwork } from '../lib/networkUtils'
import { getArcClient } from '../lib/arcClient'
import { getStoredDeals, saveStoredDeal } from '../lib/dealStorage'
import { keccak256, encodeAbiParameters, parseAbiParameters, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// The claim key travels in the link. Once read, it moves to this tab's session storage and leaves the
// address bar and history, so it is not exposed by screenshots, history sync or a shared screen.
function readClaimKey(dealId: string | undefined): `0x${string}` | null {
  if (typeof window === 'undefined') return null
  const slot = `persat_claim_key_${(dealId ?? '').toLowerCase()}`
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('key')
  const legacy = new URLSearchParams(window.location.search).get('salt')
  const fromUrl = fromHash && isHex(fromHash) ? fromHash : legacy && isHex(legacy) ? legacy : null
  if (fromUrl) {
    try { sessionStorage.setItem(slot, fromUrl) } catch { /* storage unavailable: keep the key in memory only */ }
    window.history.replaceState(null, '', window.location.pathname)
    return fromUrl as `0x${string}`
  }
  try {
    const kept = sessionStorage.getItem(slot)
    if (kept && isHex(kept)) return kept as `0x${string}`
  } catch { /* storage unavailable */ }
  return null
}

export default function ClaimDeal() {
  const { token: dealIdParam } = useParams<{ token: string }>()
  const [saltParam] = useState(() => readClaimKey(dealIdParam))

  const { address, isConnected, isWrongChain, chain, addresses, chainId, isMainnet } = useArcNetwork()

  // Always read from Arc using the standalone client — works even if wallet is on wrong chain
  const arcClient = getArcClient(isMainnet)

  const hasValidId = isValidDealId(dealIdParam)
  const normalizedDealId = normalizeDealId(dealIdParam)

  const [deal, setDeal] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [readError, setReadError] = useState<Error | null>(null)

  const refetch = useCallback(async () => {
    if (!hasValidId || !addresses.registry) return
    setIsLoading(true)
    setReadError(null)
    try {
      const raw = await arcClient.readContract({
        address: addresses.registry,
        abi: REGISTRY_ABI,
        functionName: 'getDeal',
        args: [normalizedDealId],
      })
      setDeal(raw)
    } catch (e: any) {
      setReadError(e)
      setDeal(null)
    } finally {
      setIsLoading(false)
    }
  }, [hasValidId, addresses.registry, normalizedDealId, arcClient])

  useEffect(() => { void refetch() }, [refetch])

  // Recover salt if missing from URL params
  const [recoveredSalt, setRecoveredSalt] = useState<`0x${string}` | null>(null)

  useEffect(() => {
    if (saltParam || !deal) return

    // 1. Try localStorage
    const storedDeals = getStoredDeals(chainId)
    const stored = storedDeals.find((d) => d.dealId.toLowerCase() === normalizedDealId.toLowerCase())
    if (stored?.salt) {
      setRecoveredSalt(stored.salt)
      return
    }

    // 2. If private and reservedFor matches current user, try derived salt
    if (deal.visibility === 0 && deal.reservedFor && deal.reservedFor !== '0x0000000000000000000000000000000000000000') {
      const candidate = deriveSaltForCounterparty(normalizedDealId, deal.reservedFor)
      const expectedToken = keccak256(
        encodeAbiParameters(parseAbiParameters('bytes16, bytes32'), [normalizedDealId, candidate])
      )
      if (expectedToken.toLowerCase() === deal.claimToken.toLowerCase()) {
        setRecoveredSalt(candidate)
        return
      }
    }
  }, [saltParam, deal, normalizedDealId, chainId])

  // Public deals use empty salt (bytes32(0))
  const emptySalt = ('0x' + '00'.repeat(32)) as `0x${string}`
  const effectiveSalt: `0x${string}` | null =
    saltParam ||
    recoveredSalt ||
    (deal && deal.visibility === 1 ? emptySalt : null)

  const { writeContract: rawWrite, data: hash, isPending, error } = useWriteContract()
  const [receiptConfirmed, setReceiptConfirmed] = useState(false)

  // Simulate first so an expired or invalid claim shows its reason instead of failing on-chain.
  const writeContract = (params: any) => {
    if (!address) return
    const { gas: _gas, chainId: _chainId, ...call } = params
    arcClient
      .simulateContract({ ...call, account: address })
      .then(() => rawWrite(params))
      .catch((e: unknown) => toast.error(parseOnchainError(e), { duration: 8000 }))
  }

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
    if (reverted) toast.error('Transaction failed on-chain. The deal was not accepted.', { duration: 8000 })
  }, [reverted])

  // Fast direct receipt polling
  useEffect(() => {
    if (!hash || receiptConfirmed) return
    let active = true
    const interval = setInterval(async () => {
      try {
        const receipt = await arcClient.getTransactionReceipt({ hash })
        if (receipt && receipt.status === 'success' && active) {
          setReceiptConfirmed(true)
          clearInterval(interval)
          void refetch()
          toast.success('Deal sealed on-chain successfully!')
        }
      } catch {
        // Pending
      }
    }, 1000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [hash, receiptConfirmed, arcClient, refetch])

  const isSuccess = isWagmiSuccess || receiptConfirmed
  const isConfirming = Boolean(hash) && !isSuccess && !reverted

  // Run ONCE when tx confirms — use a ref to prevent re-triggering when deal refetch updates state
  const successHandledRef = useState(false)
  useEffect(() => {
    if (!isSuccess || successHandledRef[0]) return
    successHandledRef[1](true)
    // Refetch deal state once to reflect new on-chain state
    void refetch()
    // Persist to localStorage using the deal data we already have
    if (deal && address) {
      const borrowerSet = deal.borrower !== '0x0000000000000000000000000000000000000000'
      const role = borrowerSet ? 'lender' : 'borrower'
      saveStoredDeal({
        dealId: normalizedDealId,
        salt: effectiveSalt ?? undefined,
        role,
        principal: formatUsdc(deal.principal),
        collateral: formatBtc(deal.collateral),
        rateBps: (Number(deal.rateBps) / 100).toString(),
        durationMonths: deal.durationMonths,
        visibility: deal.visibility === 0 ? 'private' : 'public',
        chainId,
        createdAt: Date.now(),
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  if (!hasValidId) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <AlertTriangle size={40} className="mx-auto mb-4" style={{ color: 'var(--danger)' }} />
        <h2 className="display text-xl font-bold mb-2" style={{ color: 'var(--ink)' }}>
          Invalid Deal ID
        </h2>
        <p className="text-sm" style={{ color: 'var(--subtle)' }}>
          The provided deal ID is not recognized. Please check the URL or ask the creator to resend.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <Card className="animate-pulse">
          <div className="h-6 rounded w-1/2 mb-4" style={{ background: 'var(--surface-muted)' }} />
          <div className="h-4 rounded w-3/4" style={{ background: 'var(--surface-muted)' }} />
        </Card>
      </div>
    )
  }

  if (!deal || readError) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <AlertTriangle size={40} className="mx-auto mb-4" style={{ color: 'var(--danger)' }} />
        <h2 className="display text-xl font-bold mb-2" style={{ color: 'var(--ink)' }}>
          Deal Not Found
        </h2>
        <p className="text-sm mb-2" style={{ color: 'var(--subtle)' }}>
          No deal was found for ID{' '}
          <code className="mono text-xs" style={{ color: 'var(--accent)' }}>
            {dealIdParam?.slice(0, 18)}...
          </code>{' '}
          on {chain?.name ?? 'Arc Testnet'}.
        </p>
        <p className="text-xs mb-6" style={{ color: 'var(--subtle)' }}>
          Make sure your wallet is connected to Arc (Chain ID 5042). If you just received this link, the deal may still be confirming — wait a few seconds and try again.
        </p>
        <div className="flex gap-3 justify-center">
          <Button variant="primary" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
          <Link to="/dashboard">
            <Button variant="secondary" size="sm">Dashboard</Button>
          </Link>
        </div>
      </div>
    )
  }

  // If deal is private and salt is completely missing
  if (deal.visibility === 0 && !effectiveSalt) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <Lock size={40} className="mx-auto mb-4 text-[#ff8a00]" />
        <h2 className="display text-xl font-bold mb-2" style={{ color: 'var(--ink)' }}>
          Private Deal Claim Link Required
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--subtle)' }}>
          This private deal can only be accepted with its full invitation link. Ask the deal creator for the complete link (the part after # holds the claim key).
        </p>
        <Link to="/dashboard">
          <Button variant="secondary" size="sm">
            Back to Dashboard
          </Button>
        </Link>
      </div>
    )
  }

  const alreadyClaimed = deal.state !== DealState.Proposed
  const { interest, total } = computeRepayment(deal.principal, deal.rateBps, deal.durationMonths)

  // Determine roles
  const borrowerSet = deal.borrower !== '0x0000000000000000000000000000000000000000'
  const claimerRole = borrowerSet ? 'lender' : 'borrower'

  const isBorrower = Boolean(
    address &&
    deal.borrower !== '0x0000000000000000000000000000000000000000' &&
    address.toLowerCase() === deal.borrower.toLowerCase()
  )
  const isLender = Boolean(
    address &&
    deal.lender !== '0x0000000000000000000000000000000000000000' &&
    address.toLowerCase() === deal.lender.toLowerCase()
  )
  const isProposer = isBorrower || isLender

  const isReservedForOther =
    deal.reservedFor !== '0x0000000000000000000000000000000000000000' &&
    address?.toLowerCase() !== deal.reservedFor.toLowerCase()

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const isOpenLink = deal.visibility === 0 && deal.reservedFor === ZERO_ADDRESS

  async function claim() {
    if (!hasValidId || !effectiveSalt || !address) return

    if (!isOpenLink) {
      writeContract({
        address: addresses.registry,
        abi: REGISTRY_ABI,
        functionName: 'claimDeal',
        args: [normalizedDealId, effectiveSalt],
        chainId,
        gas: 250_000n,
      })
      return
    }

    // F-07: open link — the URL carries an ephemeral key. Sign "this deal goes to <my wallet>" with it,
    // so a copied link or a front-run transaction cannot redirect the deal to another wallet.
    try {
      if (!isHex(effectiveSalt) || effectiveSalt.length !== 66) throw new Error('bad key')
      const linkAccount = privateKeyToAccount(effectiveSalt)
      const expectedSigner = await arcClient.readContract({
        address: addresses.registry,
        abi: REGISTRY_ABI,
        functionName: 'claimSigner',
        args: [normalizedDealId],
      })
      if (expectedSigner.toLowerCase() !== linkAccount.address.toLowerCase()) {
        toast.error('This claim link is invalid or has already been used.', { duration: 8000 })
        return
      }
      const digest = await arcClient.readContract({
        address: addresses.registry,
        abi: REGISTRY_ABI,
        functionName: 'claimDigest',
        args: [normalizedDealId, address],
      })
      const signature = await linkAccount.signMessage({ message: { raw: digest } })
      writeContract({
        address: addresses.registry,
        abi: REGISTRY_ABI,
        functionName: 'claimDealWithSignature',
        args: [normalizedDealId, signature],
        chainId,
        gas: 300_000n,
      })
    } catch (e) {
      console.error('Open-link claim failed:', e)
      toast.error('This claim link is invalid or incomplete. Ask the creator for the full link.', { duration: 8000 })
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--brand-muted)' }}
        >
          <Shield size={20} style={{ color: 'var(--brand)' }} />
        </div>
        <div>
          <h1 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>
            Deal Invitation
          </h1>
          <p className="text-xs mono" style={{ color: 'var(--subtle)' }}>
            {(normalizedDealId).slice(0, 18)}...
          </p>
        </div>
        <Badge className={`ml-auto ${dealStateColor(deal.state)}`}>
          {dealStateLabel(deal.state)}
        </Badge>
      </div>

      {/* Creator Notice Banner */}
      {isProposer && (
        <Card className="mb-4 border border-[var(--brand)]/30 bg-[var(--brand-muted)]/20">
          <div className="flex items-center gap-2 mb-1.5 font-semibold text-sm" style={{ color: 'var(--brand)' }}>
            <Sparkles size={16} />
            You proposed this deal as {isBorrower ? 'Borrower' : 'Lender'}
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            {alreadyClaimed
              ? 'This deal has been sealed on-chain and terms are locked.'
              : `Share this invitation link with your counterparty (${claimerRole}) so they can connect their wallet and seal the deal.`}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={typeof window !== 'undefined' ? window.location.href : ''}
              className="w-full text-xs font-mono px-3 py-2 rounded-lg bg-[var(--surface-muted)] border border-[var(--border)] text-[var(--ink)]"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  navigator.clipboard.writeText(window.location.href)
                  toast.success('Invitation link copied!')
                }
              }}
              className="shrink-0"
            >
              <Copy size={13} className="mr-1 inline" /> Copy
            </Button>
          </div>
        </Card>
      )}

      {/* Human-Readable Agreement Terms Summary */}
      <Card className="mb-4 bg-[#120d0a] border border-[#ff8a00]/40">
        <p className="text-xs font-semibold uppercase tracking-wider mb-2 text-[#ff8a00]">
          📋 Agreement Terms Overview
        </p>
        <div className="text-xs text-[#ddc1ae] space-y-1.5">
          <p>
            • <strong>Borrower:</strong> <code className="text-[#ebe0d9]">{shortAddr(deal.borrower)}</code> is locking <strong className="text-[#ebe0d9]">{formatBtc(deal.collateral)} cirBTC</strong> as collateral.
          </p>
          <p>
            • <strong>Lender:</strong> Supplies <strong className="text-[#ebe0d9]">${formatUsdc(deal.principal)} USDC</strong> and earns <strong className="text-[#10b981]">{formatBps(deal.rateBps)} fixed APR</strong> over <strong className="text-[#ebe0d9]">{deal.durationMonths} months</strong>.
          </p>
          <p className="text-[#a58c7b]">
            • <strong>Security:</strong> Collateral is held non-custodially in smart contract escrow until loan repayment.
          </p>
        </div>
      </Card>

      {/* Terms Stats */}
      <Card className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--subtle)' }}>
          Loan Stats
        </p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Stat label="Principal" value={`$${formatUsdc(deal.principal)}`} />
          <Stat label="Annual Rate" value={formatBps(deal.rateBps)} />
          <Stat label="Duration" value={`${deal.durationMonths} months`} />
          <Stat label="Collateral" value={`${formatBtc(deal.collateral)} cirBTC`} />
        </div>
        <div
          className="rounded-xl p-3 mt-2"
          style={{ background: 'var(--surface-muted)' }}
        >
          <div className="flex justify-between text-sm mb-1">
            <span style={{ color: 'var(--subtle)' }}>Total repayment</span>
            <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
              ${formatUsdc(total)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--subtle)' }}>Interest</span>
            <span className="tabular-nums" style={{ color: 'var(--muted)' }}>
              ${formatUsdc(interest)}
            </span>
          </div>
        </div>
      </Card>

      {/* Parties */}
      <Card className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>
          Parties
        </p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--subtle)' }}>Borrower</span>
            <code className="mono text-xs" style={{ color: 'var(--ink)' }}>
              {deal.borrower === '0x0000000000000000000000000000000000000000'
                ? '(to be filled on claim)'
                : shortAddr(deal.borrower)}
            </code>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--subtle)' }}>Lender</span>
            <code className="mono text-xs" style={{ color: 'var(--ink)' }}>
              {deal.lender === '0x0000000000000000000000000000000000000000'
                ? '(to be filled on claim)'
                : shortAddr(deal.lender)}
            </code>
          </div>
          {deal.reservedFor !== '0x0000000000000000000000000000000000000000' && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--subtle)' }}>Reserved for</span>
              <code className="mono text-xs text-[#ff8a00]">
                {shortAddr(deal.reservedFor)}
              </code>
            </div>
          )}
          <div className="flex justify-between pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
            <span style={{ color: 'var(--subtle)' }}>Connected wallet</span>
            <code className="mono text-xs" style={{ color: 'var(--ink)' }}>
              {address ? shortAddr(address) : 'Not connected'}
            </code>
          </div>
        </div>
      </Card>

      {/* CTA Section */}
      {!isConnected ? (
        <div className="rounded-xl p-3 text-sm text-center" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}>
          Connect your wallet to participate in this deal
        </div>
      ) : isWrongChain ? (
        <div className="rounded-xl p-4 text-sm text-center" style={{ background: 'rgba(232,109,122,0.1)', border: '1px solid rgba(232,109,122,0.3)', borderRadius: 12 }}>
          <p className="mb-2 font-semibold" style={{ color: 'var(--danger)' }}>Wrong Network</p>
          <p className="text-xs mb-4" style={{ color: 'var(--subtle)' }}>
            Switch to Arc Mainnet to accept this deal. Works with MetaMask, OKX, Brave, or any EVM wallet.
          </p>
          <button
            onClick={() => addArcNetwork('mainnet')}
            className="w-full py-3 rounded-xl font-bold text-sm"
            style={{ background: 'var(--brand)', color: '#17120f', border: 'none', cursor: 'pointer' }}
          >
            Switch to Arc Mainnet
          </button>
        </div>
      ) : isProposer ? (
        alreadyClaimed ? (
          <Link to={`/deal/manage/${normalizedDealId}`}>
            <Button variant="primary" size="lg" className="w-full flex items-center justify-center gap-2">
              <span>Manage Loan & Escrow</span>
              <ArrowRight size={16} />
            </Button>
          </Link>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            className="w-full opacity-80 cursor-default"
            disabled
          >
            Awaiting Counterparty ({claimerRole}) Acceptance...
          </Button>
        )
      ) : deal.visibility === 1 && deal.state === DealState.Proposed ? (
        <div className="rounded-xl p-4 text-sm text-center" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <p className="mb-3" style={{ color: 'var(--subtle)' }}>
            This is a Marketplace order. Make an offer with these terms or different ones; the creator picks one offer.
          </p>
          <Link to={`/marketplace?counter=${normalizedDealId.toLowerCase()}`} className="no-underline">
            <Button variant="primary" size="lg" className="w-full">Make an offer</Button>
          </Link>
        </div>
      ) : isReservedForOther ? (
        <div className="rounded-xl p-3 text-sm text-center bg-red-950/40 border border-red-500/40 text-red-300">
          ⚠️ This deal is reserved for address {shortAddr(deal.reservedFor)}. Please switch to that wallet to seal this deal.
        </div>
      ) : alreadyClaimed ? (
        <Link to={`/deal/manage/${normalizedDealId}`}>
          <Button variant="primary" size="lg" className="w-full flex items-center justify-center gap-2">
            <span>View Active Loan & Escrow</span>
            <ArrowRight size={16} />
          </Button>
        </Link>
      ) : (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={isPending || isConfirming || isSuccess}
          onClick={claim}
        >
          {isPending
            ? 'Confirm in wallet...'
            : isConfirming
            ? 'Confirming on Arc...'
            : isSuccess
            ? 'Deal Confirmed!'
            : `Accept & Seal Deal as ${claimerRole}`}
        </Button>
      )}

      <TxStatus
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isSuccess}
        error={error ? parseOnchainError(error) : null}
        explorerUrl={hash ? `${chain.blockExplorers.default.url}/tx/${hash}` : undefined}
      />

      {isSuccess && (
        <Card className="mt-4 border border-[var(--success)]/40 bg-[var(--surface-muted)]">
          <div className="flex items-center gap-2 mb-1 text-[var(--success)] font-semibold text-sm">
            <CheckCircle2 size={16} />
            <span>Deal successfully sealed on-chain!</span>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>
            Both parties are now registered on-chain. Terms are permanently locked in the Persat Escrow Vault.
          </p>
          <Link to={`/deal/manage/${normalizedDealId}`}>
            <Button variant="primary" size="sm" className="w-full flex items-center justify-center gap-1.5">
              <span>Proceed to Deal Management & Escrow</span>
              <ArrowRight size={14} />
            </Button>
          </Link>
        </Card>
      )}
    </div>
  )
}
