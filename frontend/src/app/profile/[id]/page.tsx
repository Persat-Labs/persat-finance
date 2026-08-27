"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input, Modal } from "@/lib/design-system";
import { useProtocol } from "@/lib/protocol/hooks";
import { getProfileByWalletOrUsername, saveProfile, UserProfile } from "@/lib/profile/userProfile";
import { MessagesDrawer } from "@/components/messaging/MessagesDrawer";
import { useMarketplaceListings } from "@/lib/marketplace/marketplaceStore";

export default function ProfilePage() {
  const params = useParams<{ id: string }>();
  const { publicKey } = useProtocol();
  const { listings } = useMarketplaceListings();
  const myWallet = publicKey ? publicKey.toBase58() : null;

  const rawId = params.id ? decodeURIComponent(params.id) : "";
  const [profile, setProfile] = useState<UserProfile | null>(() => getProfileByWalletOrUsername(rawId));
  const [editOpen, setEditOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);

  // Edit form state
  const [usernameInput, setUsernameInput] = useState(profile?.username || "");
  const [displayNameInput, setDisplayNameInput] = useState(profile?.displayName || "");
  const [bioInput, setBioInput] = useState(profile?.bio || "");

  const isMyProfile = Boolean(myWallet && profile && profile.wallet === myWallet);

  const handleSave = () => {
    if (!profile) return;
    const cleanHandle = usernameInput.trim().toLowerCase().replace(/^@/, "");
    if (!cleanHandle) return;
    const updated: UserProfile = {
      ...profile,
      username: cleanHandle,
      displayName: displayNameInput.trim() || `@${cleanHandle}`,
      bio: bioInput.trim(),
    };
    saveProfile(updated);
    setProfile(updated);
    setEditOpen(false);
  };

  if (!profile) {
    return (
      <AppFrame eyebrow="Profile" title="User Not Found">
        <Card className="mt-8 text-center">
          <p className="font-mono text-sm text-white/60">No user profile found for identifier &quot;{rawId}&quot;.</p>
        </Card>
      </AppFrame>
    );
  }

  // Filter listings by this user
  const userListings = listings.filter(
    (l) => l.creatorWallet === profile.wallet || l.creatorHandle === profile.username,
  );

  return (
    <AppFrame eyebrow="User Profile" title={`@${profile.username}`}>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_.9fr]">
        {/* Profile Details Card */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber/40 bg-gradient-to-br from-amber/20 to-orange/30 text-2xl font-display-persat text-white shadow-[0_0_20px_rgba(255,171,0,0.2)]">
                {profile.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display-persat text-2xl uppercase text-white">{profile.displayName}</h2>
                  <span className="rounded-full bg-amber/20 px-2 py-0.5 font-mono text-[10px] text-amber border border-amber/40">
                    Verified
                  </span>
                </div>
                <p className="font-mono text-xs text-amber mt-0.5">@{profile.username}</p>
                <p className="mt-1 font-mono text-xs text-white/50">
                  Wallet: {profile.wallet.slice(0, 6)}…{profile.wallet.slice(-6)}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              {isMyProfile ? (
                <Button variant="secondary" onClick={() => setEditOpen(true)} className="text-xs">
                  Edit Profile
                </Button>
              ) : (
                <Button onClick={() => setMessagesOpen(true)} className="text-xs">
                  💬 Send Direct Message
                </Button>
              )}
            </div>
          </div>

          <p className="mt-6 text-sm leading-6 text-white/80 border-t border-white/10 pt-4">
            {profile.bio || (isMyProfile ? "No bio written yet. Click 'Edit Profile' to introduce yourself." : "No bio provided.")}
          </p>

          <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-6 sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
              <p className="font-brand-persat text-2xl text-amber">{profile.reputationScore}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/50 mt-1">Trust Score</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
              <p className="font-brand-persat text-2xl text-white">{profile.totalDeals}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/50 mt-1">Deals Done</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
              <p className="font-brand-persat text-2xl text-emerald-400">{profile.activeLoans}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/50 mt-1">Active Loans</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
              <p className="font-mono text-sm text-white/90 font-semibold">{profile.joinedAt}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/50 mt-1">Member Since</p>
            </div>
          </div>
        </Card>

        {/* Real Marketplace Listings by this User */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Marketplace Activity</p>
              <h3 className="mt-1 font-display-persat text-xl uppercase text-white">Listings by User</h3>
            </div>
            {isMyProfile && (
              <Link href="/deal/new">
                <Button variant="secondary" className="text-xs px-3 py-1.5">
                  + Create Offer
                </Button>
              </Link>
            )}
          </div>

          <div className="mt-5 space-y-3 font-mono text-xs">
            {userListings.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-white/50">
                No active marketplace listings created by this user yet.
              </div>
            ) : (
              userListings.map((listing) => (
                <div
                  key={listing.id}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="font-semibold text-white">
                      {listing.principal} {listing.currency} @ {listing.rateBps / 100}% APR
                    </p>
                    <p className="text-white/50 mt-0.5">
                      {listing.months} months · {listing.collateralBtc} tBTC collateral
                    </p>
                  </div>
                  <Link href={`/deal/${listing.dealUrlId}`}>
                    <Button variant="secondary" className="text-xs px-3 py-1.5">
                      View Deal
                    </Button>
                  </Link>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Edit Profile Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Profile">
        <div className="space-y-4">
          <div>
            <label className="eyebrow mb-1.5 block text-xs">Username (Handle)</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-amber">@</span>
              <Input
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value.replace(/\s+/g, ""))}
                placeholder="your_handle"
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <label className="eyebrow mb-1.5 block text-xs">Display Name</label>
            <Input
              value={displayNameInput}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              placeholder="e.g. Satoshi"
            />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block text-xs">Bio / Trading Focus</label>
            <textarea
              value={bioInput}
              onChange={(e) => setBioInput(e.target.value)}
              placeholder="Tell other lenders and borrowers about your terms and preferences..."
              className="h-24 w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 font-body text-sm text-white outline-none focus:border-amber"
            />
          </div>
          <Button onClick={handleSave} className="w-full py-3 text-xs">
            Save Profile
          </Button>
        </div>
      </Modal>

      {/* Messages Drawer */}
      <MessagesDrawer
        open={messagesOpen}
        onClose={() => setMessagesOpen(false)}
        initialPartner={profile.wallet}
      />
    </AppFrame>
  );
}
