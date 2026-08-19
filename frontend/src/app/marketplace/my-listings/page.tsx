import { AppFrame } from "@/components/AppFrame";
import { Card } from "@/lib/design-system";
import { ProposalReview } from "@/components/marketplace/ProposalReview";
export default function MyListings() { return <AppFrame eyebrow="Marketplace // Screen B4" title="My listings and proposals"><Card className="mt-8"><p className="eyebrow">Wallet required</p><p className="mt-3 text-orange-50">Connect the wallet that posted a listing to review structured proposals. Proposal actions will be limited to Accept, Decline, and Counter with structured amount, rate, duration, and collateral values.</p></Card><ProposalReview /></AppFrame>; }
