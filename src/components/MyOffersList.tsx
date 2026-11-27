import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { REGISTRY_ABI } from '../contracts/abis'
import { useArcNetwork } from '../hooks/useArcNetwork'
import { formatUsdc, formatBtc, formatBps, parseOnchainError } from '../lib/utils'
import type { MyOffer, OfferStatus } from '../hooks/useMyOffers'

const STATUS: Record<OfferStatus, { label: string; className: string; note: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-900/40 text-amber-300', note: 'Waiting for the creator to choose an offer.' },
  accepted: { label: 'Accepted', className: 'bg-emerald-900/40 text-emerald-300', note: 'Your offer was chosen. Open the deal to continue.' },
  not_selected: { label: 'Not selected', className: 'bg-[#2f2924] text-[#a58c7b]', note: 'The creator chose another offer.' },
  expired: { label: 'Expired', className: 'bg-[#2f2924] text-[#a58c7b]', note: 'The offer or the order expired before an offer was chosen.' },
  declined: { label: 'Declined', className: 'bg-[#2f2924] text-[#a58c7b]', note: 'The creator declined your offer.' },
  cancelled: { label: 'Order cancelled', className: 'bg-[#2f2924] text-[#a58c7b]', note: 'The creator cancelled the order.' },
  withdrawn: { label: 'Cancelled by you', className: 'bg-[#2f2924] text-[#a58c7b]', note: 'You cancelled this offer.' },
}

function OfferRow({ offer, onChanged }: { offer: MyOffer; onChanged: () => void }) {
  const { addresses, chainId } = useArcNetwork()
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, chainId, query: { enabled: Boolean(hash) } })

  useEffect(() => { if (error) toast.error(parseOnchainError(error), { duration: 8000 }) }, [error])
  useEffect(() => {
    if (!isSuccess) return
    toast.success('Offer cancelled.')
    onChanged()
  }, [isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  const s = STATUS[offer.status]
  const busy = isPending || isConfirming

  return (
    <div className="p-4 rounded-2xl bg-[#17120f] border border-[#564334]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-['Space_Grotesk'] text-sm font-bold text-[#ebe0d9]">
            Offer to {offer.side} ${formatUsdc(offer.principal).replace(/\.00$/, '')} USDC
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${s.className}`}>{s.label}</span>
        </div>
        <p className="text-xs text-[#a58c7b]">
          {formatBps(offer.rateBps)} · {offer.durationMonths} month{offer.durationMonths > 1 ? 's' : ''} · {formatBtc(offer.collateral)} cirBTC
        </p>
        <p className="text-xs text-[#ddc1ae] mt-1">{s.note}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {offer.status === 'pending' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => writeContract({
              address: addresses.registry, abi: REGISTRY_ABI, functionName: 'cancelCounterOffer',
              args: [offer.dealId, offer.offerId], chainId, gas: 100_000n,
            })}
            className="px-3 py-1.5 rounded-full border border-[#564334]/60 text-[#ddc1ae] text-xs font-bold hover:bg-[#241f1a] cursor-pointer disabled:opacity-50"
          >
            {busy ? 'Cancelling…' : 'Cancel my offer'}
          </button>
        )}
        <Link
          to={`/deal/${offer.dealId}/manage`}
          className={`px-3 py-1.5 rounded-full text-xs font-bold no-underline ${offer.status === 'accepted' ? 'bg-[#ff8a00] text-[#17120f]' : 'text-[#ff8a00]'}`}
        >
          {offer.status === 'accepted' ? 'Open the deal' : 'View order'}
        </Link>
      </div>
    </div>
  )
}

export default function MyOffersList({ offers, isLoading, reload }: { offers: MyOffer[]; isLoading: boolean; reload: () => void }) {
  if (isLoading && offers.length === 0) {
    return <p className="text-sm text-[#a58c7b] py-8 text-center">Loading your offers…</p>
  }
  if (offers.length === 0) {
    return (
      <div className="py-10 text-center">
        <Send className="w-8 h-8 mx-auto mb-3 text-[#a58c7b]" />
        <h4 className="font-['Space_Grotesk'] text-base font-bold text-[#ebe0d9] mb-1">No offers yet</h4>
        <p className="text-xs max-w-sm mx-auto mb-4 text-[#ddc1ae]">
          Offers you make on Marketplace orders appear here, with their status.
        </p>
        <Link to="/marketplace" className="px-5 py-2 rounded-full bg-[#ff8a00] text-[#17120f] text-xs font-bold no-underline">
          Browse the Marketplace
        </Link>
      </div>
    )
  }
  const order: OfferStatus[] = ['accepted', 'pending', 'not_selected', 'declined', 'expired', 'cancelled', 'withdrawn']
  const sorted = [...offers].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
  return (
    <div className="space-y-3">
      {sorted.map((o) => <OfferRow key={`${o.dealId}-${o.offerId}`} offer={o} onChanged={reload} />)}
    </div>
  )
}
