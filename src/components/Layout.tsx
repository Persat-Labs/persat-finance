// oxlint-disable
import { Link, useLocation } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useChainId } from 'wagmi'
import { LayoutDashboard, Plus, ShoppingCart, Settings, Wifi, Menu, X, ShieldCheck } from 'lucide-react'
import { cn } from '../lib/utils'
import { addArcNetwork } from '../lib/networkUtils'
import { useEffect, useState } from 'react'
import { FloatingChatDrawer } from './FloatingChatDrawer'
import { StudioLogo, STUDIO_URL } from './StudioBadge'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useArcNetwork } from '../hooks/useArcNetwork'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/deal/new', label: 'New Deal', icon: Plus },
  { to: '/marketplace', label: 'Marketplace', icon: ShoppingCart },
]
const ADMIN_LINK = { to: '/admin', label: 'Admin', icon: Settings }

// Only Arc Mainnet is supported
const ARC_CHAIN_IDS = [5042]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const [addingNetwork, setAddingNetwork] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { isAdmin } = useIsAdmin()
  const { addresses } = useArcNetwork()
  const links = isAdmin ? [...NAV, ADMIN_LINK] : NAV

  useEffect(() => { setMenuOpen(false) }, [pathname])

  const isOnArc = ARC_CHAIN_IDS.includes(chainId)
  const showNetworkButton = isConnected && !isOnArc

  const handleAddNetwork = async () => {
    setAddingNetwork(true)
    try {
      await addArcNetwork('mainnet')
    } finally {
      setAddingNetwork(false)
    }
  }

  return (
    <div className="min-h-svh flex flex-col bg-[#17120f] text-[#ebe0d9]">
      {/* Wrong network banner */}
      {showNetworkButton && (
        <div className="w-full bg-red-900/40 border-b border-red-500/40 px-4 py-2.5 flex items-center justify-center gap-3 text-sm">
          <span className="text-red-300 font-semibold">⚠️ Wrong Network Detected</span>
          <button
            onClick={handleAddNetwork}
            disabled={addingNetwork}
            className="px-4 py-1.5 rounded-full bg-[#ff8a00] text-[#17120f] font-['Space_Grotesk'] text-xs font-bold hover:bg-[#ffaa45] transition-colors cursor-pointer disabled:opacity-50"
          >
            {addingNetwork ? 'Switching...' : 'Switch to Arc Mainnet'}
          </button>
        </div>
      )}

      {/* Nav */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between gap-2 px-4 sm:px-6 h-16 border-b"
        style={{
          background: 'rgba(18, 13, 10, 0.92)',
          backdropFilter: 'blur(16px)',
          borderColor: 'rgba(86, 67, 52, 0.4)',
          transform: 'translateZ(0)',
        }}
      >
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 no-underline shrink-0">
          <img src="/persatlogo.png" alt="Persat Finance" className="w-8 h-8 object-contain" />
          <span className="hidden min-[360px]:inline font-['Space_Grotesk'] font-bold text-base tracking-wider text-[#ebe0d9]">
            PERSAT
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1.5">
          {links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-["Space_Grotesk"] font-bold transition-all no-underline',
                pathname === to
                  ? 'bg-[#ff8a00] text-[#17120f] shadow-sm'
                  : 'text-[#ddc1ae] hover:text-[#ebe0d9] hover:bg-[#241f1a]',
              )}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </nav>

        {/* Wallet + Add Network */}
        <div className="flex items-center gap-2 min-w-0">
          {isConnected && !isOnArc && (
            <button
              onClick={handleAddNetwork}
              disabled={addingNetwork}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#ff8a00]/15 text-[#ff8a00] font-['Space_Grotesk'] text-[11px] font-bold border border-[#ff8a00]/40 hover:bg-[#ff8a00]/25 transition-colors cursor-pointer"
            >
              <Wifi size={12} />
              {addingNetwork ? 'Adding...' : 'Add Arc Network'}
            </button>
          )}
          <ConnectKitButton.Custom>
            {({ isConnected: connected, show, truncatedAddress, ensName }) => (
              <button
                onClick={show}
                className={cn(
                  'flex items-center gap-2 h-9 px-3 sm:px-3.5 min-w-0 rounded-full font-["Space_Grotesk"] text-xs font-bold whitespace-nowrap transition-colors cursor-pointer',
                  connected
                    ? 'bg-[#241f1a] text-[#ebe0d9] border border-[#564334]/50 hover:bg-[#2f2924]'
                    : 'bg-gradient-to-b from-[#ffaa45] to-[#ff8a00] text-[#17120f]',
                )}
              >
                {connected && <span className="w-2 h-2 rounded-full bg-[#10b981]" />}
                <span className="truncate">{connected ? (ensName ?? truncatedAddress) : 'Connect Wallet'}</span>
              </button>
            )}
          </ConnectKitButton.Custom>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="md:hidden w-9 h-9 rounded-xl bg-[#241f1a] border border-[#564334]/40 flex items-center justify-center text-[#ebe0d9] hover:text-[#ff8a00] transition-colors cursor-pointer"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      {/* Mobile menu */}
      {menuOpen && (
        <>
          <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <nav
            className="md:hidden fixed top-16 left-0 right-0 z-50 border-b px-4 py-3 flex flex-col gap-1"
            style={{ background: '#120d0a', borderColor: 'rgba(86, 67, 52, 0.4)' }}
          >
            {links.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-["Space_Grotesk"] font-bold no-underline transition-colors',
                  pathname === to ? 'bg-[#ff8a00]/15 text-[#ff8a00]' : 'text-[#ddc1ae] hover:bg-[#241f1a]',
                )}
              >
                <Icon size={18} />
                {label}
              </Link>
            ))}
            {isConnected && !isOnArc && (
              <button
                onClick={handleAddNetwork}
                disabled={addingNetwork}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-['Space_Grotesk'] font-bold text-[#ff8a00] hover:bg-[#241f1a] cursor-pointer disabled:opacity-50"
              >
                <Wifi size={18} />
                {addingNetwork ? 'Adding...' : 'Add Arc Network'}
              </button>
            )}
            <a
              href={STUDIO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 pt-3 border-t border-[#564334]/30 flex items-center gap-2 px-3 text-xs text-[#a58c7b] no-underline"
            >
              <StudioLogo size={12} />
              Built with Arc Studio
            </a>
          </nav>
        </>
      )}

      {/* Content */}
      <main className="flex-1 pb-8">{children}</main>

      <footer className="border-t border-[#564334]/30 px-4 sm:px-6 pt-5 pb-24 md:pb-8">
        <div className="max-w-6xl mx-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8 text-xs text-[#a58c7b]">
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Footer">
            <Link to="/security" className="flex items-center gap-1.5 no-underline text-[#ddc1ae] hover:text-[#ff8a00]">
              <ShieldCheck size={13} /> Security & risks
            </Link>
            <a href={`https://explorer.arc.io/address/${addresses.registry}`} target="_blank" rel="noopener noreferrer" className="no-underline text-[#ddc1ae] hover:text-[#ff8a00]">
              Contracts on Arc
            </a>
            <Link to="/#faq" className="no-underline text-[#ddc1ae] hover:text-[#ff8a00]">FAQ</Link>
          </nav>
          <span>Persat Beta · not audited · Arc (chain ID 5042)</span>
        </div>
      </footer>

      <FloatingChatDrawer />
    </div>
  )
}
