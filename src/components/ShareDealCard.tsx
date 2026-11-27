import { useEffect, useState } from 'react'
import { Copy, Check, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from './ui'
import { buildShareLink } from '../lib/share'
import { shortAddr } from '../lib/utils'

const INVITE_TEXT = "You've been invited to a USDC loan deal on Persat Finance. Review the terms and accept here:"

export default function ShareDealCard({
  dealId,
  salt,
  reservedFor,
}: {
  dealId: `0x${string}`
  salt: `0x${string}`
  reservedFor?: string
}) {
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void buildShareLink(`/deal/claim/${dealId}#key=${salt}`).then(setLink)
  }, [dealId, salt])

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Invitation link copied')
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.')
    }
  }

  return (
    <Card className="mb-4 border border-[#ff8a00]/50">
      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
        Invite your counterparty
      </p>
      <p className="text-sm mb-3" style={{ color: 'var(--ink)' }}>
        Wallets do not receive notifications from the blockchain. Send this link yourself.
        {reservedFor && (
          <> Only <code className="mono">{shortAddr(reservedFor)}</code> can accept it, and they will also find it in their Dashboard under Invitations.</>
        )}
      </p>

      <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <code className="mono text-xs flex-1 min-w-0 truncate" style={{ color: 'var(--muted)' }}>
          {link ?? '…'}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!link}
          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-[#ff8a00] text-[#17120f] font-bold text-xs flex items-center gap-1 cursor-pointer hover:bg-[#ffaa45] transition-colors disabled:opacity-50"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {link && (
        <div className="flex flex-wrap gap-2 mb-3">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${INVITE_TEXT} ${link}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-full bg-[#25d366]/15 border border-[#25d366]/40 text-[#25d366] text-xs font-bold no-underline"
          >
            WhatsApp
          </a>
          <a
            href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(INVITE_TEXT)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-full bg-[#2aabee]/15 border border-[#2aabee]/40 text-[#2aabee] text-xs font-bold no-underline"
          >
            Telegram
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent('Persat Finance — Loan Deal Invitation')}&body=${encodeURIComponent(`You've been invited to a BTC-collateralised USDC loan deal on Persat Finance.\n\nReview the terms and accept here:\n${link}\n\nYou'll need a wallet connected to Arc (Chain ID: 5042, RPC: https://rpc.mainnet.arc.io) to accept. Treat this link like a password: anyone who has it can take the deal.\n\nThe invitation expires 30 days after it was created.`)}`}
            className="px-3 py-1.5 rounded-full bg-[#a58c7b]/15 border border-[#a58c7b]/40 text-[#ddc1ae] text-xs font-bold no-underline"
          >
            Email
          </a>
        </div>
      )}

      <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--subtle)' }}>
        <Sparkles size={12} className="shrink-0 mt-0.5 text-[#ff8a00]" />
        Treat this link like a password: anyone who has it can accept the deal. It expires after 30 days.
      </p>
    </Card>
  )
}
