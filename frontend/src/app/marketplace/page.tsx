"use client";
import Link from "next/link";
import { useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card } from "@/lib/design-system";
import { MarketplaceFilters } from "@/components/marketplace/MarketplaceFilters";
import { MessagesDrawer } from "@/components/messaging/MessagesDrawer";

interface MockListing {
  id: string;
  creatorWallet: string;
  creatorHandle: string;
  side: "borrow" | "lend";
  principal: string;
  currency: "USDC" | "USDT";
  rateBps: number;
  months: number;
  collateralBtc: string;
  reputation: number;
}

const SAMPLE_LISTINGS: MockListing[] = [
  {
    id: "list_01",
    creatorWallet: "2G2avktDrH2GTf5bodA6PnLK6zNhAp4Nxfxp4n3maCsX",
    creatorHandle: "lender_prime",
    side: "lend",
    principal: "5,000",
    currency: "USDC",
    rateBps: 820,
    months: 12,
    collateralBtc: "0.25",
    reputation: 100,
  },
  {
    id: "list_02",
    creatorWallet: "8mdkcgNT2CDk5G9Pes55SUf7TkMxPpVvpu5wTL2myUWL",
    creatorHandle: "borrower_alpha",
    side: "borrow",
    principal: "1,000",
    currency: "USDC",
    rateBps: 800,
    months: 6,
    collateralBtc: "0.05",
    reputation: 98,
  },
  {
    id: "list_03",
    creatorWallet: "99QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD",
    creatorHandle: "institutional_desk",
    side: "lend",
    principal: "25,000",
    currency: "USDC",
    rateBps: 790,
    months: 24,
    collateralBtc: "1.25",
    reputation: 99,
  },
  {
    id: "list_04",
    creatorWallet: "F4rJY7TBP3eG381MTm5SwzehwPKYG5XA8T2etMD67Mki",
    creatorHandle: "satoshi_vault",
    side: "borrow",
    principal: "10,000",
    currency: "USDT",
    rateBps: 850,
    months: 12,
    collateralBtc: "0.50",
    reputation: 97,
  },
];

export default function Marketplace() {
  const [activePartner, setActivePartner] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleMessage = (wallet: string) => {
    setActivePartner(wallet);
    setDrawerOpen(true);
  };

  return (
    <AppFrame eyebrow="Marketplace // Discovery" title="Open Protocol Listings">
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <Link href="/marketplace/new">
            <Button>+ Post a Listing</Button>
          </Link>
          <Link href="/deal/new">
            <Button variant="secondary">Create Direct Deal</Button>
          </Link>
        </div>
      </div>

      <MarketplaceFilters />

      {/* Structured Listings Grid */}
      <div className="mt-8 space-y-4">
        {SAMPLE_LISTINGS.map((listing) => (
          <Card key={listing.id} className="p-6">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              {/* Creator & Details */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${
                      listing.side === "lend"
                        ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border border-amber/30 bg-amber/10 text-amber"
                    }`}
                  >
                    {listing.side === "lend" ? "● Seeking to Lend" : "● Seeking to Borrow"}
                  </span>
                  <Link
                    href={`/profile/${listing.creatorHandle}`}
                    className="font-mono text-xs font-semibold text-white hover:text-amber transition"
                  >
                    @{listing.creatorHandle}
                  </Link>
                  <span className="font-mono text-[10px] text-white/40">
                    ({listing.reputation}% Trust Score)
                  </span>
                </div>

                <div className="flex flex-wrap items-baseline gap-4 pt-1">
                  <p className="font-brand-persat text-2xl text-white">
                    {listing.principal} {listing.currency}
                  </p>
                  <p className="font-mono text-xs text-white/60">
                    Collateral: <span className="font-semibold text-white">{listing.collateralBtc} tBTC</span>
                  </p>
                  <p className="font-mono text-xs text-white/60">
                    Rate: <span className="font-semibold text-amber">{listing.rateBps / 100}% APR</span>
                  </p>
                  <p className="font-mono text-xs text-white/60">
                    Term: <span className="text-white">{listing.months} months</span>
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/profile/${listing.creatorHandle}`}>
                  <Button variant="secondary" className="text-xs px-4">
                    View Profile
                  </Button>
                </Link>
                <Button
                  variant="secondary"
                  onClick={() => handleMessage(listing.creatorWallet)}
                  className="text-xs px-4"
                >
                  💬 Message &amp; Negotiate
                </Button>
                <Link href="/deal/new">
                  <Button className="text-xs px-5">
                    Fulfill Deal →
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Messages Drawer */}
      <MessagesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initialPartner={activePartner}
      />
    </AppFrame>
  );
}
