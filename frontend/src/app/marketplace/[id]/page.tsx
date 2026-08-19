import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { ProposalReview } from "@/components/marketplace/ProposalReview";
import { Button, Card } from "@/lib/design-system";
export default function ListingDetail({ params }: { params: { id: string } }) { return <AppFrame eyebrow="Marketplace // Screen B3" title="Listing and structured response"><p className="mt-4 font-mono text-xs text-orange-50/70">Listing reference: {params.id}</p><Card className="mt-8"><p className="eyebrow">Verified listing data required</p><p className="mt-3 max-w-3xl leading-7 text-orange-50">The marketplace indexer will populate this view only from public, unconfirmed Deal Registry accounts and on-chain reputation data. No profile text, off-platform contact data, or direct message channel is rendered here.</p><Link href="/marketplace/new" className="mt-6 inline-block"><Button variant="secondary">Prepare structured response</Button></Link></Card><ProposalReview /></AppFrame>; }
