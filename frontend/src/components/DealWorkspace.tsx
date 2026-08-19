import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card } from "@/lib/design-system";

const content = {
  confirm: { eyebrow: "Direct path // Screen A3", title: "Confirm these terms", text: "Connect the intended counterparty wallet to review immutable on-chain terms. Confirmation permanently binds this wallet; it never edits the terms.", action: "Confirm these terms" },
  fund: { eyebrow: "Funding // Screen F1", title: "Deposit collateral", text: "The approved bridge health service selects tBTC or zBTC only after verified pause status, success rate, and on-Solana liquidity. If that service is unavailable, manual selection is shown instead.", action: "Open bridge modal" },
  manage: { eyebrow: "Active loan // Screen 7", title: "Loan management", text: "Payment state, collateral USD value, LTV, liquidation price, and bridge-token details are available only from fresh on-chain and oracle data. Stale price data blocks price-dependent actions.", action: "Refresh position" },
  repay: { eyebrow: "Repayment // Screen 8", title: "Make a payment", text: "Select the current installment or pay in full. Wallet signing, repayment calculation, and collateral release will be enabled only against deployed audited programs.", action: "Prepare payment" },
} as const;
export function DealWorkspace({ id, screen }: { id: string; screen: keyof typeof content }) {
 const view = content[screen];
 return <AppFrame eyebrow={view.eyebrow} title={view.title}><p className="mt-4 font-mono text-xs text-orange-50/70">Deal reference: {id}</p><Card className="mt-8 max-w-3xl"><p className="eyebrow">Fail-closed testnet workflow</p><p className="mt-4 leading-7 text-orange-50">{view.text}</p><Button className="mt-8" disabled>{view.action}</Button><Link className="ml-4 font-mono text-xs uppercase tracking-widest text-amber hover:text-white" href="/deal/new">Create another deal</Link></Card></AppFrame>;
}
