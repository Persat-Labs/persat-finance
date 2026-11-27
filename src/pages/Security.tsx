import { ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react'
import { Card } from '../components/ui'
import { useArcNetwork } from '../hooks/useArcNetwork'

const EXPLORER = 'https://explorer.arc.io/address/'

function AddressRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b text-sm" style={{ borderColor: 'var(--border)' }}>
      <span style={{ color: 'var(--subtle)' }}>{label}</span>
      <a href={`${EXPLORER}${address}`} target="_blank" rel="noopener noreferrer" className="mono text-xs flex items-center gap-1 no-underline truncate" style={{ color: 'var(--accent)' }}>
        <span className="truncate">{address}</span> <ExternalLink size={11} className="shrink-0" />
      </a>
    </div>
  )
}

export default function Security() {
  const { addresses } = useArcNetwork()

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-4">
      <div>
        <h1 className="display text-2xl font-bold mb-1" style={{ color: 'var(--ink)' }}>Security</h1>
        <p className="text-sm" style={{ color: 'var(--subtle)' }}>
          How Persat handles your funds, what it never does, and the risks you should know before lending or borrowing.
        </p>
      </div>

      <Card>
        <p className="font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <ShieldCheck size={16} className="text-[#10b981]" /> What Persat never does
        </p>
        <ul className="text-sm space-y-1.5 list-disc pl-5" style={{ color: 'var(--subtle)' }}>
          <li>Persat never holds your keys. Every transaction is signed in your own wallet.</li>
          <li>Nothing leaves your wallet when you post an order, make an offer or accept one. Funds only move when the loan starts, once both sides have approved.</li>
          <li>Approvals are requested for the exact amount a step needs, never unlimited.</li>
          <li>The team cannot move collateral or payments owed to users. The owner can pause new loans, queue a fee change (4-day delay, 0.5% maximum) and pause liquidations for at most 24 hours.</li>
          <li>Bridges and conversions (USDC via Circle CCTP, BTC and other tokens via LI.FI) run through those providers' contracts; Persat's contracts never hold funds in transit.</li>
        </ul>
      </Card>

      <Card>
        <p className="font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <AlertTriangle size={16} className="text-[#f59e0b]" /> Risks to understand
        </p>
        <ul className="text-sm space-y-1.5 list-disc pl-5" style={{ color: 'var(--subtle)' }}>
          <li>
            <strong style={{ color: 'var(--ink)' }}>cirBTC valuation.</strong> Collateral is valued with the Chainlink BTC/USD price.
            New loans are refused if cirBTC trades more than 2% away from BTC, but a loss of cirBTC's 1:1 link to BTC during a
            loan would not be detected. Lenders carry that risk.
          </li>
          <li>
            <strong style={{ color: 'var(--ink)' }}>Liquidation.</strong> Above 80% loan-to-value, or 7 days after maturity, anyone can
            liquidate a loan and receives a 3% bonus. Borrowers can add collateral at any time to stay below the limit.
          </li>
          <li>
            <strong style={{ color: 'var(--ink)' }}>Issuer controls.</strong> Circle can pause or freeze USDC and cirBTC. Payments
            that cannot be delivered stay credited to you and can be withdrawn later.
          </li>
          <li>
            <strong style={{ color: 'var(--ink)' }}>Third-party routes.</strong> BTC deposits and withdrawals go through LI.FI and a
            liquidity provider that holds the funds during the transfer. Always check the minimum received before signing.
          </li>
          <li>
            <strong style={{ color: 'var(--ink)' }}>Binding offers.</strong> An offer stays valid for 7 days. If it is accepted and your
            wallet has approved the amount, the loan can start without another signature from you.
          </li>
        </ul>
      </Card>

      <Card>
        <p className="font-semibold mb-1" style={{ color: 'var(--ink)' }}>Contracts on Arc (chain ID 5042)</p>
        <p className="text-xs mb-2" style={{ color: 'var(--subtle)' }}>
          Check that your wallet shows chain ID 5042 and one of these addresses before you sign. Only use the official Persat site.
        </p>
        <AddressRow label="Deal registry" address={addresses.registry} />
        <AddressRow label="Escrow vault" address={addresses.vault} />
        <AddressRow label="cirBTC (Circle)" address={addresses.cirBtc} />
        <AddressRow label="USDC (Circle)" address={addresses.usdc} />
      </Card>
    </div>
  )
}
