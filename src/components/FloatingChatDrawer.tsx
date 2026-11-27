// oxlint-disable
import { useState } from 'react'
import { MessageSquare, X, ChevronUp, ChevronDown, Send, Clock, ExternalLink, Sparkles } from 'lucide-react'
import { useLocation, Link } from 'react-router-dom'
import { normalizeDealId, isValidDealId } from '../lib/utils'

// Messaging is not live yet: this drawer is a preview only. Nothing can be typed, sent or stored.
const QUICK_REPLIES = [
  'Agreed on terms! Ready to seal.',
  'Can we adjust the annual APR slightly?',
  'Collateral is deposited. Please confirm.',
  'USDC funds are ready in my wallet.',
]

function currentDealId(pathname: string): `0x${string}` | null {
  const m =
    pathname.match(/\/deal\/claim\/([a-zA-Z0-9xX]+)/) ||
    pathname.match(/\/deal\/([a-zA-Z0-9xX]+)\/manage/) ||
    pathname.match(/\/deal\/manage\/([a-zA-Z0-9xX]+)/)
  return m?.[1] && isValidDealId(m[1]) ? normalizeDealId(m[1]) : null
}

export function FloatingChatDrawer() {
  const { pathname } = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const dealId = currentDealId(pathname)

  return (
    <div className="fixed bottom-4 right-4 md:bottom-20 md:right-6 z-[100] flex flex-col items-end" style={{ transform: 'translateZ(0)' }}>
      {isOpen && (
        <div
          role="dialog"
          aria-label="Deal chat (not available yet)"
          className="w-[92vw] sm:w-[400px] max-h-[70vh] md:max-h-[85vh] overflow-y-auto bg-[#1a1512] border border-[#564334]/60 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden mb-3"
        >
          <div className="flex items-center justify-between px-4 py-3 bg-[#140f0c] border-b border-[#564334]/40">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#ff8a00]/15 text-[#ff8a00] flex items-center justify-center">
                <MessageSquare className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="font-['Space_Grotesk'] text-sm font-bold text-[#ebe0d9] leading-tight">Deal Chat</h3>
                <span className="text-[10px] text-[#f59e0b] flex items-center gap-1 font-semibold">
                  <Clock className="w-3 h-3" />
                  Not available yet
                </span>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 text-[#a58c7b] hover:text-[#ebe0d9] hover:bg-[#241f1a] rounded-lg transition-colors cursor-pointer"
              title="Close"
              aria-label="Close chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="m-3 p-3 rounded-xl border border-[#f59e0b]/40 bg-[#f59e0b]/10 text-xs leading-relaxed text-[#fcd9a0]">
            <p className="font-bold text-[#f59e0b] mb-1">Messaging is not live yet</p>
            <p className="mb-2">
              Nothing can be sent from here, and your counterparty would not receive it. We are working on wallet-to-wallet
              messaging.
            </p>
            <p className="text-[#ddc1ae]">
              Until then, send the invitation link by WhatsApp, Telegram or email, and propose different terms with a
              counter-offer on the Marketplace. Both parties see the loan status on the deal page.
            </p>
          </div>

          <div className="px-3 flex flex-wrap gap-2 mb-3">
            {dealId && (
              <Link
                to={`/deal/${dealId}/manage`}
                onClick={() => setIsOpen(false)}
                className="text-[11px] px-3 py-1.5 rounded-full bg-[#241f1a] border border-[#564334]/50 text-[#ff8a00] font-['Space_Grotesk'] font-bold flex items-center gap-1 no-underline"
              >
                Open this deal <ExternalLink className="w-3 h-3" />
              </Link>
            )}
            <Link
              to="/marketplace"
              onClick={() => setIsOpen(false)}
              className="text-[11px] px-3 py-1.5 rounded-full bg-[#241f1a] border border-[#564334]/50 text-[#ddc1ae] font-['Space_Grotesk'] font-bold no-underline"
            >
              Go to Marketplace
            </Link>
          </div>

          <div className="px-3 pb-2 flex flex-wrap gap-1.5 opacity-50" aria-hidden="true">
            <span className="text-[10px] text-[#a58c7b] flex items-center gap-1 mr-1">
              <Sparkles className="w-3 h-3 text-[#ff8a00]" /> Quick replies:
            </span>
            {QUICK_REPLIES.map((qr) => (
              <span
                key={qr}
                className="text-[10px] px-2.5 py-1 rounded-full bg-[#241f1a] text-[#a58c7b] border border-[#564334]/40 cursor-not-allowed"
              >
                {qr}
              </span>
            ))}
          </div>

          <form
            className="p-3 bg-[#201b17] border-t border-[#564334]/30 flex items-center gap-2"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              id="deal-chat-input"
              type="text"
              disabled
              placeholder="Messaging is not available yet"
              className="flex-1 bg-[#120d0a] border border-[#564334]/40 rounded-xl px-3.5 py-2 text-xs text-[#ebe0d9] placeholder-[#a58c7b] outline-none opacity-60 cursor-not-allowed"
            />
            <button
              type="submit"
              disabled
              className="px-4 py-2 rounded-xl bg-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold opacity-40 flex items-center gap-1.5 cursor-not-allowed shrink-0"
            >
              <span>Send</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex items-center justify-center gap-2.5 w-11 h-11 md:w-auto md:h-auto md:px-4 md:py-3 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ffaa45] hover:from-[#ff961a] hover:to-[#ffb65e] text-[#17120f] font-['Space_Grotesk'] font-bold text-xs shadow-[0_8px_25px_rgba(255,138,0,0.4)] md:hover:scale-105 active:scale-95 transition-transform cursor-pointer"
        aria-label="Open deal chat (not available yet)"
      >
        {isOpen ? <X className="w-5 h-5 md:w-4 md:h-4" /> : <MessageSquare className="w-5 h-5 md:w-4 md:h-4" />}
        <span className="hidden md:inline">Deal Chat</span>
        <span className="hidden md:inline px-1.5 py-0.5 rounded-full bg-[#17120f]/80 text-[#f59e0b] text-[9px] uppercase tracking-wider">Soon</span>
        <span className="md:hidden absolute -top-1 -right-1 px-1 rounded-full bg-[#17120f] border border-[#f59e0b]/60 text-[#f59e0b] text-[8px] leading-[14px] uppercase">Soon</span>
        <span className="hidden md:inline">{isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}</span>
      </button>
    </div>
  )
}
