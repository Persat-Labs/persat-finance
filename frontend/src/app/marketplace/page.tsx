"use client";
import Link from "next/link";
import { useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card } from "@/lib/design-system";
import { MarketplaceFilters } from "@/components/marketplace/MarketplaceFilters";
import { MessagesDrawer } from "@/components/messaging/MessagesDrawer";
import { useMarketplaceListings } from "@/lib/marketplace/marketplaceStore";

export default function Marketplace() {
  const { listings } = useMarketplaceListings();
  const [activePartner, setActivePartner] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleMessage = (wallet: string) => {
    setActivePartner(wallet);
    setDrawerOpen(true);
  };

  return (
    <AppFrame eyebrow="Marketplace // Live Discovery" title="Open Protocol Listings">
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <Link href="/deal/new">
            <Button>+ Post a Public Listing</Button>
          </Link>
          <Link href="/deal/new">
            <Button variant="secondary">Create Direct Deal</Button>
          </Link>
        </div>
      </div>

      <MarketplaceFilters />

      {/* Live Listings Grid */}
      <div className="mt-8 space-y-4">
        {listings.length === 0 ? (
          <Card className="p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] text-2xl text-amber">
              📋
            </div>
            <h3 className="mt-4 font-display-persat text-xl uppercase text-white">
              No Open Marketplace Listings Yet
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/60">
              No unconfirmed public deals have been posted yet on Devnet. Create a deal without specifying a
              counterparty to publish it live to this marketplace.
            </p>
            <div className="mt-6">
              <Link href="/deal/new">
                <Button className="px-6">Post First Public Deal →</Button>
              </Link>
            </div>
          </Card>
        ) : (
          listings.map((listing) => (
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
                  <Link href={`/deal/${listing.dealUrlId}`}>
                    <Button className="text-xs px-5">
                      Fulfill Deal →
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* In-App Messages Drawer */}
      <MessagesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initialPartner={activePartner}
      />
    </AppFrame>
  );
}
