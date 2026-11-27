// oxlint-disable
import React, { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useModal } from 'connectkit'
import MyOffersList from '../components/MyOffersList'
import { useMyOffers } from '../hooks/useMyOffers'
import { useReceivedOffers } from '../hooks/useReceivedOffers'
import ConvertToBtc, { useCirBtcBalance } from '../components/ConvertToBtc'
import { motion } from 'framer-motion'
import {
  Plus,
  Percent,
  Clock,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  Copy,
  Check,
  CheckCircle,
  Activity,
  Coins,
  Lock,
  RefreshCw,
  Inbox,
  Wallet,
  Store,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  shortAddr,
  normalizeDealId,
  formatUsdc,
  formatBtc,
  formatBps,
  dealStateLabel,
  dealStateColor,
  DealState,
  computeRltv,
  computeRepayment,
} from '../lib/utils'
import { useArcNetwork } from '../hooks/useArcNetwork'
import { useUserDeals, LiveDeal } from '../hooks/useUserDeals'
import { useBtcPrice } from '../hooks/useBtcPrice'
import { useActivationStatus } from '../hooks/useActivationStatus'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

export default function Dashboard() {
  const { address, isConnected, isMainnet, chain, addresses } = useArcNetwork()
  const { setOpen: openConnect } = useModal()
  const {
    deals,
    borrowedDeals,
    fundedDeals,
    incomingDeals,
    totalCollateralLocked,
    totalBorrowedUsdc,
    isLoading,
    refetch,
  } = useUserDeals()

  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'borrowed' | 'funded' | 'incoming' | 'offers'>('borrowed')
  const { offers: myOffers, isLoading: myOffersLoading, reload: reloadMyOffers } = useMyOffers()
  const receivedOffers = useReceivedOffers(deals)
  const { balance: walletCirBtc } = useCirBtcBalance()
  const ordersWithOffers = deals.filter((d) => receivedOffers.has(d.dealId.toLowerCase()))
  const totalReceived = ordersWithOffers.reduce((n, d) => n + (receivedOffers.get(d.dealId.toLowerCase()) ?? 0), 0)
  const typeBadge = (d: { visibility: number }) => (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-['Space_Grotesk'] text-[10px] font-bold whitespace-nowrap bg-[#241f1a] text-[#ddc1ae] border border-[#564334]/50">
      {d.visibility === 1 ? <Store className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
      {d.visibility === 1 ? 'Marketplace' : 'Private link'}
    </span>
  )
  // The deal list also holds invitations and deals other accounts created in this browser: keep only the wallet's own.
  const meLower = address?.toLowerCase() ?? ''
  const activation = useActivationStatus(deals)
  const isLapsed = (d: { dealId: string }) => activation.get(d.dealId.toLowerCase()) === 'expired'
  const partyDeals = deals.filter((d) => d.borrower.toLowerCase() === meLower || d.lender.toLowerCase() === meLower)
  const myDeals = partyDeals.filter((d) => d.state !== DealState.Cancelled)
  const openDealsCount = myDeals.filter((d) => d.state === DealState.Proposed || (d.state === DealState.Confirmed && !isLapsed(d))).length
  const activeDealsCount = myDeals.filter((d) => d.state === DealState.Active || d.state === DealState.Defaulted).length
  const offersBadge = (d: { dealId: string; visibility: number; state: number }) => {
    const n = receivedOffers.get(d.dealId.toLowerCase()) ?? 0
    if (n > 0) {
      return (
        <span className="px-2 py-0.5 rounded-full font-['Space_Grotesk'] text-[10px] font-bold bg-[#ff8a00] text-[#17120f] whitespace-nowrap">
          {n} offer{n > 1 ? 's' : ''} to review
        </span>
      )
    }
    if (d.visibility === 1 && d.state === DealState.Proposed) {
      return <span className="text-[10px] text-[#a58c7b] whitespace-nowrap">Waiting for offers</span>
    }
    return null
  }
  const stateBadge = (d: { dealId: string; state: number }) => (
    <span className={`px-2 py-0.5 rounded-full font-['Space_Grotesk'] text-[10px] font-bold ${isLapsed(d) ? 'bg-[#2f2924] text-[#a58c7b]' : dealStateColor(d.state)}`}>
      {isLapsed(d) ? 'EXPIRED' : dealStateLabel(d.state).toUpperCase()}
    </span>
  )
  const actionBadge = (d: { dealId: string }) => {
    const s = activation.get(d.dealId.toLowerCase())
    if (s === 'your_turn' || s === 'start') {
      return (
        <span className="px-2 py-0.5 rounded-full font-['Space_Grotesk'] text-[10px] font-bold bg-[#ff8a00] text-[#17120f] whitespace-nowrap">
          {s === 'start' ? 'Ready to start' : 'Your turn: approve'}
        </span>
      )
    }
    if (s === 'waiting') return <span className="text-[10px] text-[#a58c7b] whitespace-nowrap">Waiting for the other party</span>
    return null
  }
  // Phones: the tab bar scrolls sideways. Keep the selected tab in view and hint when more tabs are off-screen.
  const tabsRef = useRef<HTMLDivElement>(null)
  const [tabsMoreRight, setTabsMoreRight] = useState(false)
  const updateTabsHint = () => {
    const el = tabsRef.current
    if (el) setTabsMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }
  useEffect(() => {
    const el = tabsRef.current
    const btn = el?.querySelector<HTMLElement>(`[data-tab="${activeTab}"]`)
    if (el && btn) el.scrollTo({ left: btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' })
    updateTabsHint()
  }, [activeTab, isConnected])
  useEffect(() => {
    window.addEventListener('resize', updateTabsHint)
    return () => window.removeEventListener('resize', updateTabsHint)
  }, [])
  const actionableOffers = myOffers.filter((o) => o.status === 'pending' || o.status === 'accepted').length
  const [jumpId, setJumpId] = useState('')
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [copiedDealId, setCopiedDealId] = useState<string | null>(null)

  const { priceUsd: btcPrice, hasPrice, isStale: priceStale, source: priceSource } = useBtcPrice()

  // Aggregate RLTV across all active borrowed deals
  // RLTV = total repayable / total collateral value — protects lender yield
  const { deals: allDeals } = useUserDeals()
  const activeBorrowedDeals = allDeals.filter(
    d => d.borrower.toLowerCase() === (address?.toLowerCase() ?? '') &&
    (d.state === DealState.Active || (d.state === DealState.Confirmed && !isLapsed(d)))
  )
  const aggregateRltvNum = (() => {
    if (activeBorrowedDeals.length === 0) return 0
    let totalRepayable = 0n
    let totalCollateralUsdc = 0n
    for (const d of activeBorrowedDeals) {
      const { total } = computeRepayment(d.principal, d.rateBps, d.durationMonths)
      totalRepayable += total
      totalCollateralUsdc += d.collateral * BigInt(Math.floor(btcPrice)) / 100n
    }
    if (totalCollateralUsdc === 0n) return 0
    return Number((totalRepayable * 10_000n) / totalCollateralUsdc) / 100
  })()
  const aggregateRltv = aggregateRltvNum.toFixed(1)

  const ltvNum = aggregateRltvNum
  const isHealthy = ltvNum === 0 || ltvNum <= 50
  const isWarning = ltvNum > 50 && ltvNum <= 75
  const isDanger = ltvNum > 75

  function goToDeal() {
    let id = jumpId.trim()
    if (!id) return
    const norm = normalizeDealId(id)
    navigate(`/deal/${norm}/manage`)
  }

  const handleCopyAddr = () => {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 2000)
  }

  const handleCopyClaimLink = (deal: LiveDeal) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const link = deal.salt
      ? `${origin}/deal/claim/${deal.dealId}#key=${deal.salt}`
      : `${origin}/deal/claim/${deal.dealId}`
    navigator.clipboard.writeText(link)
    setCopiedDealId(deal.dealId)
    toast.success('Deal claim link copied to clipboard!')
    setTimeout(() => setCopiedDealId(null), 2500)
  }

  // Automatically focus on incoming invitations if counterparty arrives to accept a deal
  useEffect(() => {
    if (incomingDeals.length > 0 && borrowedDeals.length === 0) {
      setActiveTab('incoming')
    }
  }, [incomingDeals.length, borrowedDeals.length])

  return (
    <div className="min-h-screen bg-[#17120f] text-[#ebe0d9] font-['Geist',sans-serif] pb-16">
      {/* ── TOP ORACLE PRICE TICKER RIBBON ── */}
      <div className="w-full bg-[#120d0a] border-b border-[#564334]/30 px-4 sm:px-6 py-2.5">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${priceStale ? 'bg-yellow-500' : 'bg-[#10b981] animate-pulse'}`} />
              <span className="text-[#a58c7b] font-semibold">BTC/USD:</span>
              <span className="font-['Space_Grotesk'] font-bold text-[#ebe0d9]">{hasPrice ? `$${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</span>
              <span className="text-[#10b981] text-[10px] font-bold">{priceStale ? 'stale' : priceSource}</span>
            </div>

            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-[#a58c7b] font-semibold">USDC/USD:</span>
              <span className="font-['Space_Grotesk'] font-bold text-[#ebe0d9]">$1.000</span>
              <span className="text-[#10b981] text-[10px] font-bold">Stable</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-[#a58c7b]">
            <span>{isMainnet ? 'Arc Mainnet (5042)' : 'Arc Testnet (5042)'}</span>
            <span>•</span>
            <button
              onClick={() => void refetch()}
              className="flex items-center gap-1 text-[#ff8a00] hover:underline cursor-pointer"
              title="Rescan on-chain events"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Scanning Chain...' : 'Live Sync'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8">
        {/* ── HEADER ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#564334]/30 mb-8">
          <div>
            <div className="flex flex-col items-start sm:flex-row sm:items-center gap-1.5 sm:gap-2 mb-1">
              <h1 className="font-['Space_Grotesk'] text-2xl sm:text-3xl font-bold text-[#ebe0d9]">
                Institutional Escrow Dashboard
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-[#ff8a00]/15 text-[#ff8a00] font-['Space_Grotesk'] text-[10px] font-bold uppercase border border-[#ff8a00]/30 whitespace-nowrap">
                P2P Non-Custodial
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[#ddc1ae]">
              {isConnected ? (
                <span className="flex items-center gap-2">
                  <span>Connected: <span className="font-['Space_Grotesk'] font-bold text-[#ebe0d9]">{shortAddr(address!)}</span></span>
                  <button
                    onClick={handleCopyAddr}
                    className="text-[#ff8a00] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedAddr ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedAddr ? 'Copied' : 'Copy'}</span>
                  </button>
                </span>
              ) : (
                'Connect your Web3 wallet to manage collateral, claim repayments, or monitor active loans.'
              )}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:items-center gap-3">
            <Link
              to="/marketplace"
              className="inline-flex items-center justify-center whitespace-nowrap px-4 py-2 rounded-full bg-[#241f1a] hover:bg-[#2f2924] text-[#ddc1ae] font-['Space_Grotesk'] text-xs font-bold border border-[#564334]/40 transition-colors no-underline"
            >
              Marketplace
            </Link>
            <Link
              to="/deal/new"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap px-5 py-2 rounded-full bg-gradient-to-b from-[#ffaa45] to-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold shadow-[0_4px_16px_rgba(255,138,0,0.35)] hover:shadow-[0_6px_24px_rgba(255,138,0,0.55)] transition-all no-underline"
            >
              <Plus className="w-4 h-4" />
              <span className="sm:hidden">New Deal</span>
              <span className="hidden sm:inline">Create New Deal</span>
            </Link>
          </div>
        </div>

        {/* ── OFFERS RECEIVED ON THE USER'S MARKETPLACE ORDERS ── */}
        {totalReceived > 0 && (
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-[#2a1e14] via-[#241a12] to-[#20150d] border border-[#ff8a00] shadow-[0_8px_32px_rgba(255,138,0,0.25)] mb-8">
            <p className="font-['Space_Grotesk'] text-sm font-bold text-[#ebe0d9] mb-1">
              You have {totalReceived} offer{totalReceived > 1 ? 's' : ''} to review
            </p>
            <p className="text-xs text-[#ddc1ae] mb-3">
              Choose one offer per order. Its terms are then locked, and nothing moves until the loan is activated.
            </p>
            <ul className="m-0 p-0 list-none space-y-2">
              {ordersWithOffers.slice(0, 3).map((d) => {
                const n = receivedOffers.get(d.dealId.toLowerCase()) ?? 0
                return (
                  <li key={d.dealId} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[#ddc1ae] min-w-0">
                      <strong className="text-[#ebe0d9]">{n} offer{n > 1 ? 's' : ''}</strong> on your order of{' '}
                      <strong className="text-[#ebe0d9] whitespace-nowrap">${formatUsdc(d.principal).replace(/\.00$/, '')} USDC</strong>
                    </span>
                    <Link
                      to={`/deal/${d.dealId}/manage`}
                      className="shrink-0 px-4 py-2 rounded-full bg-gradient-to-b from-[#ffaa45] to-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold no-underline whitespace-nowrap"
                    >
                      Review offers
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* ── INCOMING PRIVATE INVITATION BANNER (If Any) ── */}
        {incomingDeals.length > 0 && (
          <div className="p-5 rounded-2xl bg-gradient-to-r from-[#2a1e14] via-[#241a12] to-[#20150d] border border-[#ff8a00] shadow-[0_8px_32px_rgba(255,138,0,0.25)] mb-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[#ff8a00] text-[#17120f] flex items-center justify-center shrink-0 font-bold">
                  <Inbox className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-['Space_Grotesk'] text-sm font-bold text-[#ebe0d9]">
                      You Have {incomingDeals.length} Private Loan Invitation{incomingDeals.length > 1 ? 's' : ''} Reserved For Your Wallet!
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-[#ff8a00]/20 text-[#ff8a00] font-['Space_Grotesk'] text-[10px] font-bold">
                      ACTION REQUIRED
                    </span>
                  </div>
                  <p className="text-xs text-[#ddc1ae]">
                    Counterparty <strong className="text-[#ebe0d9]">{shortAddr(incomingDeals[0].borrower !== ZERO_ADDR ? incomingDeals[0].borrower : incomingDeals[0].lender)}</strong> created a deal: <strong className="text-[#ff8a00]">${formatUsdc(incomingDeals[0].principal)} USDC</strong> principal at <strong className="text-[#10b981]">{formatBps(incomingDeals[0].rateBps)} fixed APR</strong> ({incomingDeals[0].durationMonths}mo) backed by <strong className="text-[#ebe0d9]">{formatBtc(incomingDeals[0].collateral)} cirBTC</strong> collateral.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  to={`/deal/claim/${incomingDeals[0].dealId}${incomingDeals[0].salt ? `#key=${incomingDeals[0].salt}` : ''}`}
                  className="px-5 py-2.5 rounded-full bg-gradient-to-b from-[#ffaa45] to-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold hover:shadow-[0_4px_16px_rgba(255,138,0,0.4)] transition-all no-underline shrink-0"
                >
                  Review & Accept Deal →
                </Link>
              </div>
            </div>
          </div>
        )}

        {!isConnected && (
          <div className="p-6 sm:p-8 rounded-3xl bg-[#201b17] border border-[#ff8a00]/30 mb-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-[#ff8a00]/15 text-[#ff8a00] flex items-center justify-center">
              <Wallet className="w-6 h-6" />
            </div>
            <h2 className="font-['Space_Grotesk'] text-lg font-bold text-[#ebe0d9] mb-1">No wallet connected</h2>
            <p className="text-sm text-[#ddc1ae] mb-5 max-w-md mx-auto">
              Connect your wallet to see your loans, invitations and collateral. Your positions stay safe on-chain while you are disconnected.
            </p>
            <button
              onClick={() => openConnect(true)}
              className="px-6 py-2.5 rounded-full bg-gradient-to-b from-[#ffaa45] to-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-sm font-bold cursor-pointer"
            >
              Connect Wallet
            </button>
          </div>
        )}

        {isConnected && (<>
        {/* ── LTV HEALTH GAUGE & METRICS ROW ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-8">
          {/* LTV Safety Gauge Card */}
          <div className="lg:col-span-5 rounded-3xl bg-[#201b17] border border-[#564334]/40 p-6 shadow-[0_12px_32px_rgba(0,0,0,0.6)] relative overflow-hidden flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="font-['Space_Grotesk'] text-xs uppercase font-bold text-[#a58c7b] tracking-wider">
                  Portfolio Health Factor (RLTV)
                </span>
                <span className={`px-2.5 py-0.5 rounded-full font-['Space_Grotesk'] text-[10px] font-bold uppercase whitespace-nowrap ${
                  isHealthy
                    ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30'
                    : isWarning
                    ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                    : 'bg-red-400/15 text-red-300 border border-red-400/30'
                }`}>
                  {isHealthy ? 'Safe & Healthy' : isWarning ? 'Caution Zone' : 'Liquidation Hazard'}
                </span>
              </div>

              {/* LTV Percentage Big Text */}
              <div className="flex items-baseline gap-2 mb-4">
                <span className="font-['Space_Grotesk'] text-4xl sm:text-5xl font-bold text-[#ebe0d9]">
                  {aggregateRltv}%
                </span>
                <span className="text-xs text-[#a58c7b]">
                  {ltvNum === 0 ? 'No Active Debt' : 'Repayable Loan-to-Value'}
                </span>
              </div>

              {/* Progress Bar Gauge */}
              <div className="w-full bg-[#120d0a] h-3 rounded-full overflow-hidden border border-[#564334]/40 relative mb-3">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isHealthy
                      ? 'bg-gradient-to-r from-[#10b981] to-[#ffaa45]'
                      : isWarning
                      ? 'bg-gradient-to-r from-amber-400 to-[#ff8a00]'
                      : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(ltvNum, 100)}%` }}
                />
              </div>

              {/* Gauge Steps */}
              <div className="flex justify-between text-[10px] font-['Space_Grotesk'] text-[#a58c7b]">
                <span className="text-[#10b981]">0% (Zero Debt)</span>
                <span>50% Caution</span>
                <span className="text-red-400">80% Liquidation Threshold</span>
              </div>
            </div>

            <div className="pt-4 border-t border-[#564334]/25 mt-4 flex items-center justify-between text-xs">
              <span className="text-[#ddc1ae]">Liquidation Buffer Remaining:</span>
              <span className="font-['Space_Grotesk'] font-bold text-[#10b981]">
                {Math.max(0, 80 - ltvNum).toFixed(1)}% Room
              </span>
            </div>
          </div>

          {/* Key Metrics Grid */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Metric 1 */}
            <div className="p-5 rounded-2xl bg-[#201b17] border border-[#564334]/30 shadow-md flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-['Space_Grotesk'] font-bold uppercase text-[#a58c7b]">
                  Total cirBTC Locked
                </span>
                <div className="w-7 h-7 rounded-lg bg-[#f7931a]/15 text-[#f7931a] flex items-center justify-center font-bold text-xs">
                  ₿
                </div>
              </div>
              <div>
                <div className="font-['Space_Grotesk'] text-2xl font-bold text-[#ebe0d9]">
                  {formatBtc(totalCollateralLocked)} cirBTC
                </div>
                <div className="text-xs text-[#a58c7b] mt-0.5">
                  ≈ ${(Number(totalCollateralLocked) / 1e8 * btcPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })} USD
                </div>
              </div>
            </div>

            {/* Metric 2 */}
            <div className="p-5 rounded-2xl bg-[#201b17] border border-[#564334]/30 shadow-md flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-['Space_Grotesk'] font-bold uppercase text-[#a58c7b]">
                  Active USDC Borrowed
                </span>
                <div className="w-7 h-7 rounded-lg bg-[#2775ca]/15 text-[#2775ca] flex items-center justify-center font-bold text-xs">
                  $
                </div>
              </div>
              <div>
                <div className="font-['Space_Grotesk'] text-2xl font-bold text-[#ebe0d9]">
                  ${(Number(totalBorrowedUsdc) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-[#ff8a00] font-semibold mt-0.5">
                  Native USDC Escrow
                </div>
              </div>
            </div>

            {/* Metric 3 */}
            <div className="p-5 rounded-2xl bg-[#201b17] border border-[#564334]/30 shadow-md flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-['Space_Grotesk'] font-bold uppercase text-[#a58c7b]">
                  Your Deals
                </span>
                <div className="w-7 h-7 rounded-lg bg-[#ff8a00]/15 text-[#ff8a00] flex items-center justify-center">
                  <Activity className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <div className="font-['Space_Grotesk'] text-2xl font-bold text-[#ff8a00]">
                  {myDeals.length} Deal{myDeals.length !== 1 ? 's' : ''}
                </div>
                <div className="text-xs text-[#a58c7b] mt-0.5">
                  {openDealsCount} open · {activeDealsCount} active
                </div>
              </div>
            </div>

            {/* Metric 4 */}
            <div className="p-5 rounded-2xl bg-[#201b17] border border-[#564334]/30 shadow-md flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-['Space_Grotesk'] font-bold uppercase text-[#a58c7b]">
                  Settlement Network
                </span>
                <div className="w-7 h-7 rounded-lg bg-[#10b981]/15 text-[#10b981] flex items-center justify-center">
                  <Clock className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <div className="font-['Space_Grotesk'] text-xl font-bold text-[#ebe0d9]">
                  {chain.name}
                </div>
                <div className="text-xs text-[#10b981] font-semibold mt-0.5">
                  Sub-second Finality
                </div>
              </div>
            </div>
          </div>
        </div>

        </>)}

        {/* ── WALLET: free cirBTC, convertible back to native BTC ── */}
        {isConnected && walletCirBtc !== null && (
          <div className="p-4 sm:p-5 rounded-2xl bg-[#201b17] border border-[#564334]/30 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-wider text-[#a58c7b] mb-1">Your wallet</p>
              <p className="font-['Space_Grotesk'] text-lg font-bold text-[#ebe0d9] tabular-nums">
                {formatBtc(walletCirBtc)} cirBTC
              </p>
              <p className="text-xs text-[#a58c7b]">
                {walletCirBtc > 0n ? 'Free to use as collateral, or to convert back to BTC.' : 'No free cirBTC. Collateral locked in loans is not counted here.'}
              </p>
            </div>
            <ConvertToBtc variant="primary" className="w-full sm:w-auto" />
          </div>
        )}

        {/* ── FAST ACTION TOOLBAR ── */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-[#201b17] via-[#241f1a] to-[#201b17] border border-[#ff8a00]/30 shadow-lg mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ff8a00]/15 flex items-center justify-center">
              <img src="/persatlogo.png" alt="Persat" className="w-7 h-7 object-contain" />
            </div>
            <div>
              <h4 className="font-['Space_Grotesk'] text-sm font-bold text-[#ebe0d9]">
                Quick Actions
              </h4>
              <p className="text-xs text-[#a58c7b]">
                Borrow against Bitcoin, supply peer liquidity, or look up an existing deal by ID.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {/* Jump by ID input */}
            <div className="flex items-center rounded-full bg-[#120d0a] border border-[#564334]/40 px-3 py-1.5 flex-1 sm:flex-initial">
              <input
                type="text"
                placeholder="Jump by Deal ID..."
                value={jumpId}
                onChange={(e) => setJumpId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && goToDeal()}
                className="bg-transparent text-xs text-[#ebe0d9] placeholder-[#a58c7b] outline-none w-32 font-['Space_Grotesk']"
              />
              <button
                onClick={goToDeal}
                className="text-[#ff8a00] hover:text-[#ffaa45] font-['Space_Grotesk'] text-xs font-bold cursor-pointer"
              >
                Go
              </button>
            </div>

            <Link
              to="/deal/new"
              className="px-4 py-2 rounded-full bg-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold hover:bg-[#ffaa45] transition-colors no-underline"
            >
              Borrow USDC
            </Link>
            <Link
              to="/marketplace"
              className="px-4 py-2 rounded-full bg-[#2f2924] text-[#ebe0d9] font-['Space_Grotesk'] text-xs font-bold hover:bg-[#3a342f] border border-[#564334]/40 transition-colors no-underline"
            >
              Lend & Earn Yield
            </Link>
          </div>
        </div>

        {isConnected && (<>
        {/* ── ACTIVE POSITIONS & LOANS CONSOLE ── */}
        <div className="rounded-3xl bg-[#201b17] border border-[#564334]/40 overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.6)] mb-8">
          {/* Tabs */}
          <div className="flex items-center justify-between border-b border-[#564334]/30 px-4 sm:px-6 pt-4 bg-[#241f1a]/80">
            <div className="relative min-w-0">
            <div
              ref={tabsRef}
              onScroll={updateTabsHint}
              className="relative flex items-center gap-5 sm:gap-6 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <button
                data-tab="borrowed"
                onClick={() => setActiveTab('borrowed')}
                className={`pb-4 font-['Space_Grotesk'] text-sm font-bold transition-colors relative cursor-pointer ${
                  activeTab === 'borrowed'
                    ? 'text-[#ff8a00]'
                    : 'text-[#ddc1ae] hover:text-[#ebe0d9]'
                }`}
              >
                <span className="sm:hidden">Borrowed</span><span className="hidden sm:inline">Loans You Created (Borrower)</span>
                <span className="ml-2 px-1.5 py-0.5 rounded-full bg-[#ff8a00]/15 text-[#ff8a00] text-[10px]">
                  {borrowedDeals.length}
                </span>
                {activeTab === 'borrowed' && (
                  <motion.div
                    layoutId="activeTabUnderline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ff8a00]"
                  />
                )}
              </button>

              <button
                data-tab="funded"
                onClick={() => setActiveTab('funded')}
                className={`pb-4 font-['Space_Grotesk'] text-sm font-bold transition-colors relative cursor-pointer ${
                  activeTab === 'funded'
                    ? 'text-[#ff8a00]'
                    : 'text-[#ddc1ae] hover:text-[#ebe0d9]'
                }`}
              >
                <span className="sm:hidden">Funded</span><span className="hidden sm:inline">Loans You Funded (Lender)</span>
                <span className="ml-2 px-1.5 py-0.5 rounded-full bg-[#241f1a] text-[#a58c7b] text-[10px]">
                  {fundedDeals.length}
                </span>
                {activeTab === 'funded' && (
                  <motion.div
                    layoutId="activeTabUnderline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ff8a00]"
                  />
                )}
              </button>

              <button
                data-tab="incoming"
                onClick={() => setActiveTab('incoming')}
                className={`pb-4 font-['Space_Grotesk'] text-sm font-bold transition-colors relative cursor-pointer ${
                  activeTab === 'incoming'
                    ? 'text-[#ff8a00]'
                    : 'text-[#ddc1ae] hover:text-[#ebe0d9]'
                }`}
              >
                <span className="sm:hidden">Invitations</span><span className="hidden sm:inline">Incoming Invitations</span>
                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${
                  incomingDeals.length > 0
                    ? 'bg-[#ff8a00]/20 text-[#ff8a00] font-bold animate-pulse'
                    : 'bg-[#241f1a] text-[#a58c7b]'
                }`}>
                  {incomingDeals.length}
                </span>
                {activeTab === 'incoming' && (
                  <motion.div
                    layoutId="activeTabUnderline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ff8a00]"
                  />
                )}
              </button>

              <button
                data-tab="offers"
                onClick={() => setActiveTab('offers')}
                className={`pb-4 font-['Space_Grotesk'] text-sm font-bold transition-colors relative cursor-pointer ${
                  activeTab === 'offers'
                    ? 'text-[#ff8a00]'
                    : 'text-[#ddc1ae] hover:text-[#ebe0d9]'
                }`}
              >
                <span className="sm:hidden">Offers</span><span className="hidden sm:inline">My Offers</span>
                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${
                  actionableOffers > 0 ? 'bg-[#ff8a00]/20 text-[#ff8a00] font-bold' : 'bg-[#241f1a] text-[#a58c7b]'
                }`}>
                  {actionableOffers}
                </span>
                {activeTab === 'offers' && (
                  <motion.div
                    layoutId="activeTabUnderline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ff8a00]"
                  />
                )}
              </button>
            </div>
            {tabsMoreRight && (
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-[#241f1a] to-transparent" aria-hidden="true" />
            )}
            </div>

            <div className="hidden sm:flex items-center gap-2 pb-4 text-xs text-[#a58c7b]">
              <span>Smart Escrow: Immutable</span>
            </div>
          </div>

          {/* Tab Content */}
          <div className="p-4 sm:p-6">
            {activeTab === 'borrowed' && (
              <div className="space-y-4">
                {borrowedDeals.length > 0 ? (
                  borrowedDeals.map((deal) => (
                    <div
                      key={deal.dealId}
                      className="p-4 sm:p-5 rounded-2xl bg-[#17120f] border border-[#564334]/40 hover:border-[#ff8a00]/50 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-4 min-w-0">
                        <div className="hidden sm:flex w-12 h-12 rounded-2xl bg-[#ff8a00]/15 border border-[#ff8a00]/30 items-center justify-center text-[#ff8a00] shrink-0">
                          <Lock className="w-6 h-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="font-['Space_Grotesk'] text-base font-bold text-[#ebe0d9] whitespace-nowrap">
                              Deal {deal.dealId.slice(0, 10)}...
                            </span>
                            {stateBadge(deal)}
                            {typeBadge(deal)}
                            {offersBadge(deal)}
                            {actionBadge(deal)}
                          </div>
                          <div className="flex flex-col items-start sm:flex-row sm:flex-wrap sm:items-center gap-x-4 gap-y-1 mt-1 text-xs text-[#a58c7b]">
                            <span>Collateral: <strong className="text-[#ebe0d9]">{formatBtc(deal.collateral)} cirBTC</strong></span>
                            <span className="hidden sm:inline">•</span>
                            <span>Principal: <strong className="text-[#ff8a00]">${formatUsdc(deal.principal)} USDC</strong></span>
                            <span className="hidden sm:inline">•</span>
                            <span>Rate: <strong className="text-[#ebe0d9]">{formatBps(deal.rateBps)} Fixed</strong></span>
                            <span className="hidden sm:inline">•</span>
                            <span>Duration: <strong className="text-[#ebe0d9]">{deal.durationMonths}mo</strong></span>
                          </div>
                          {deal.reservedFor !== '0x0000000000000000000000000000000000000000' && (
                            <div className="mt-1.5 text-[11px] text-[#ff8a00]">
                              🔒 Reserved for counterparty: <code className="mono font-bold text-[#ebe0d9]">{shortAddr(deal.reservedFor)}</code>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                        {deal.state === DealState.Proposed && (
                          <button
                            onClick={() => handleCopyClaimLink(deal)}
                            className="flex-1 min-w-[7.5rem] sm:flex-none justify-center whitespace-nowrap px-4 py-2.5 rounded-full bg-[#241f1a] hover:bg-[#2f2924] text-[#ff8a00] font-['Space_Grotesk'] text-xs font-bold border border-[#ff8a00]/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            {copiedDealId === deal.dealId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedDealId === deal.dealId ? 'Copied!' : <><span className="sm:hidden">Copy Link</span><span className="hidden sm:inline">Copy Share Link</span></>}</span>
                          </button>
                        )}


                        <Link
                          to={`/deal/${deal.dealId}/manage`}
                          className="flex-1 min-w-[7.5rem] sm:flex-none text-center whitespace-nowrap px-5 py-2.5 rounded-full bg-gradient-to-b from-[#ffaa45] to-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold hover:shadow-[0_4px_16px_rgba(255,138,0,0.4)] transition-all no-underline"
                        >
                          Manage Deal
                        </Link>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-[#a58c7b]">
                    <Lock className="w-12 h-12 mx-auto mb-3 text-[#ff8a00]/40" />
                    <h4 className="font-['Space_Grotesk'] text-base font-bold text-[#ebe0d9] mb-1">
                      No Active Borrowed Deals
                    </h4>
                    <p className="text-xs max-w-sm mx-auto mb-6 text-[#ddc1ae]">
                      You have not created any Bitcoin-collateralized loan deals yet. Create a deal to borrow USDC or generate a private link for your peer.
                    </p>
                    <Link
                      to="/deal/new"
                      className="px-6 py-2.5 rounded-full bg-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold hover:bg-[#ffaa45] transition-colors no-underline inline-block"
                    >
                      Propose a Deal
                    </Link>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'funded' && (
              <div className="space-y-4">
                {fundedDeals.length > 0 ? (
                  fundedDeals.map((deal) => (
                    <div
                      key={deal.dealId}
                      className="p-4 sm:p-5 rounded-2xl bg-[#17120f] border border-[#564334]/40 hover:border-[#ff8a00]/50 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-4 min-w-0">
                        <div className="hidden sm:flex w-12 h-12 rounded-2xl bg-[#10b981]/15 border border-[#10b981]/30 items-center justify-center text-[#10b981] shrink-0">
                          <Coins className="w-6 h-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="font-['Space_Grotesk'] text-base font-bold text-[#ebe0d9] whitespace-nowrap">
                              Lending Deal {deal.dealId.slice(0, 10)}...
                            </span>
                            {stateBadge(deal)}
                            {typeBadge(deal)}
                            {offersBadge(deal)}
                            {actionBadge(deal)}
                          </div>
                          <div className="flex flex-col items-start sm:flex-row sm:flex-wrap sm:items-center gap-x-4 gap-y-1 mt-1 text-xs text-[#a58c7b]">
                            <span>{deal.state === DealState.Proposed || deal.state === DealState.Confirmed ? 'Offering' : 'Supplied'}: <strong className="text-[#10b981]">${formatUsdc(deal.principal)} USDC</strong></span>
                            <span className="hidden sm:inline">•</span>
                            <span>{deal.state === DealState.Proposed || deal.state === DealState.Confirmed ? 'Requires' : 'Collateral Held'}: <strong className="text-[#ebe0d9]">{formatBtc(deal.collateral)} cirBTC</strong></span>
                            <span className="hidden sm:inline">•</span>
                            <span>Yield: <strong className="text-[#ebe0d9]">{formatBps(deal.rateBps)} APR</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          to={`/deal/${deal.dealId}/manage`}
                          className="flex-1 sm:flex-none text-center px-5 py-2.5 rounded-full bg-[#241f1a] text-[#ebe0d9] font-['Space_Grotesk'] text-xs font-bold hover:bg-[#2f2924] border border-[#564334]/40 transition-colors no-underline shrink-0"
                        >
                          {deal.state === DealState.Proposed || deal.state === DealState.Confirmed ? 'Manage' : 'View & Collect'}
                        </Link>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-[#a58c7b]">
                    <Coins className="w-12 h-12 mx-auto mb-3 text-[#ff8a00]/40" />
                    <h4 className="font-['Space_Grotesk'] text-base font-bold text-[#ebe0d9] mb-1">
                      No Active Lender Positions
                    </h4>
                    <p className="text-xs max-w-sm mx-auto mb-6 text-[#ddc1ae]">
                      You have not funded any loans yet. Browse the public marketplace to earn guaranteed fixed APR yields in USDC.
                    </p>
                    <Link
                      to="/marketplace"
                      className="px-6 py-2.5 rounded-full bg-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold hover:bg-[#ffaa45] transition-colors no-underline inline-block"
                    >
                      Explore Marketplace
                    </Link>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'incoming' && (
              <div className="space-y-4">
                {incomingDeals.length > 0 ? (
                  incomingDeals.map((deal) => {
                    const iLend = deal.borrower !== ZERO_ADDR
                    const from = iLend ? deal.borrower : deal.lender
                    const terms = [
                      ['Amount', `$${formatUsdc(deal.principal).replace(/\.00$/, '')} USDC`],
                      ['Rate', `${formatBps(deal.rateBps)} / year`],
                      ['Duration', `${deal.durationMonths} month${deal.durationMonths > 1 ? 's' : ''}`],
                      [iLend ? 'Their collateral' : 'Your collateral', `${formatBtc(deal.collateral)} cirBTC`],
                    ]
                    return (
                      <div
                        key={deal.dealId}
                        className="p-4 sm:p-5 rounded-2xl bg-[#17120f] border border-[#ff8a00]/60 hover:border-[#ff8a00] transition-all flex flex-col md:flex-row md:items-center gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="font-['Space_Grotesk'] text-base font-bold text-[#ebe0d9]">Loan invitation</span>
                            <span className="px-2 py-0.5 rounded-full font-['Space_Grotesk'] text-[10px] font-bold bg-[#ff8a00]/15 text-[#ff8a00] border border-[#ff8a00]/30">
                              Awaiting your review
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[#a58c7b]">
                            From <code className="text-[#ebe0d9]">{shortAddr(from)}</code> · you would {iLend ? 'lend' : 'borrow'}
                          </p>
                          <dl className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
                            {terms.map(([k, v]) => (
                              <div key={k} className="min-w-0">
                                <dt className="text-[10px] uppercase tracking-wider font-bold text-[#a58c7b]">{k}</dt>
                                <dd className={`font-['Space_Grotesk'] text-sm font-bold truncate ${k === 'Rate' ? 'text-[#10b981]' : 'text-[#ebe0d9]'}`}>{v}</dd>
                              </div>
                            ))}
                          </dl>
                          <p className="mt-3 text-xs text-[#a58c7b]">
                            {iLend
                              ? 'If the borrower does not repay, the loan is liquidated and you are repaid from the collateral. This is not insurance: if cirBTC loses value faster than liquidation happens, you can lose money.'
                              : 'If you do not repay on time, or if BTC falls too far, your collateral can be liquidated.'}
                          </p>
                        </div>
                        <Link
                          to={`/deal/claim/${deal.dealId}${deal.salt ? `#key=${deal.salt}` : ''}`}
                          className="w-full md:w-auto shrink-0 text-center px-5 py-2.5 rounded-full bg-gradient-to-b from-[#ffaa45] to-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold hover:shadow-[0_4px_16px_rgba(255,138,0,0.4)] transition-all no-underline"
                        >
                          Review & accept →
                        </Link>
                      </div>
                    )
                  })
                ) : (
                  <div className="text-center py-12 text-[#a58c7b]">
                    <Inbox className="w-12 h-12 mx-auto mb-3 text-[#ff8a00]/40" />
                    <h4 className="font-['Space_Grotesk'] text-base font-bold text-[#ebe0d9] mb-1">
                      No Pending Invitations
                    </h4>
                    <p className="text-xs max-w-sm mx-auto mb-2 text-[#ddc1ae]">
                      When someone creates a loan deal reserved for your wallet address, it will appear here automatically. You can also receive a claim link directly from the borrower.
                    </p>
                    <p className="text-[11px] text-[#a58c7b]">
                      Your receiving address: <code className="text-[#ebe0d9] font-bold">{address ? shortAddr(address) : '—'}</code>
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'offers' && (
              <MyOffersList offers={myOffers} isLoading={myOffersLoading} reload={reloadMyOffers} />
            )}
          </div>
        </div>

        </>)}

        {/* ── RECENT ACTIVITY: the wallet's latest deals at a glance ── */}
        <div className="rounded-2xl bg-[#201b17] border border-[#564334]/30 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#564334]/25 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Activity className="w-4 h-4 text-[#ff8a00] shrink-0" />
              <h3 className="font-['Space_Grotesk'] text-sm font-bold text-[#ebe0d9] uppercase tracking-wider whitespace-nowrap">
                Recent activity
              </h3>
            </div>
            <a
              href={`${chain.blockExplorers.default.url}/address/${addresses.registry}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-[#a58c7b] hover:text-[#ff8a00] flex items-center gap-1 whitespace-nowrap shrink-0 no-underline"
            >
              <span>Explorer</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {partyDeals.length > 0 ? (
            <ul className="divide-y divide-[#564334]/20 m-0 p-0 list-none">
              {partyDeals.slice(0, 5).map((d) => {
                const me = address?.toLowerCase()
                const role = d.borrower.toLowerCase() === me ? 'Borrower' : d.lender.toLowerCase() === me ? 'Lender' : null
                return (
                  <li key={d.dealId} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-['Space_Grotesk'] text-sm font-bold text-[#ebe0d9] tabular-nums truncate">
                        ${formatUsdc(d.principal).replace(/\.00$/, '')} USDC · {formatBtc(d.collateral)} cirBTC
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-[#a58c7b]">
                        <span className={`px-1.5 py-0.5 rounded-full font-bold ${dealStateColor(d.state)}`}>{dealStateLabel(d.state)}</span>
                        {role && <span>{role}</span>}
                        {typeBadge(d)}
                        {offersBadge(d)}
                        <code className="mono">{`${d.dealId.slice(0, 6)}…${d.dealId.slice(-4)}`}</code>
                      </div>
                    </div>
                    <Link
                      to={`/deal/${d.dealId}/manage`}
                      className="shrink-0 text-xs font-bold text-[#ff8a00] no-underline hover:underline"
                    >
                      View →
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-center py-6 text-xs text-[#a58c7b]">
              No activity yet. Your deals will appear here.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
