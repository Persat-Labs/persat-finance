"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input, Modal } from "@/lib/design-system";
import { useProtocol } from "@/lib/protocol/hooks";
import { api } from "@/lib/api";
import {
  UserProfile,
  profileFromServer,
  normalizeUsername,
  checkUsernameAvailable,
  isUsernameAvailable,
  saveProfile,
  cacheProfile,
  fetchProfileByIdentifier,
} from "@/lib/profile/userProfile";
import { useWalletSession } from "@/lib/session";
import { MessagesDrawer } from "@/components/messaging/MessagesDrawer";
import { useMarketplaceListings } from "@/lib/marketplace/marketplaceStore";

export default function ProfilePage() {
  const params = useParams<{ id: string }>();
  const { publicKey } = useProtocol();
  const { token } = useWalletSession();
  const { listings } = useMarketplaceListings();
  const myWallet = publicKey ? publicKey.toBase58() : null;

  const rawId = params.id ? decodeURIComponent(params.id) : "";
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const isMyProfile = Boolean(myWallet && profile && profile.wallet === myWallet);

  // Load profile from the server (server is source of truth; cache is fallback).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const p = await fetchProfileByIdentifier(rawId, myWallet === rawId ? token : null);
      if (cancelled) return;
      setProfile(p);
      setLoading(false);
      if (p) {
        setUsernameInput(p.username);
        setDisplayNameInput(p.displayName);
        setBioInput(p.bio);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawId, token, myWallet]);

  // Edit form state
  const [usernameInput, setUsernameInput] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [bioInput, setBioInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [serverCheck, setServerCheck] = useState<{ available: boolean; reason?: string } | null>(null);

  const cleanInput = normalizeUsername(usernameInput);
  const isUnchanged = profile ? cleanInput === normalizeUsername(profile.username) : false;

  // Debounce server-authoritative availability.
  useEffect(() => {
    if (!profile) return;
    const local = isUsernameAvailable(cleanInput, profile.wallet);
    if (cleanInput === "" || !local.available) {
      setServerCheck(local);
      return;
    }
    if (isUnchanged) {
      setServerCheck({ available: true });
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const check = await checkUsernameAvailable(cleanInput, profile.wallet);
      if (!cancelled) setServerCheck(check);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, cleanInput, isUnchanged]);

  const isAvailable = isUnchanged || Boolean(serverCheck?.available && cleanInput);

  const handleSave = useCallback(async () => {
    if (!profile) return;
    const clean = normalizeUsername(usernameInput);
    const check = await checkUsernameAvailable(clean, profile.wallet);
    if (!check.available) {
      setErrorMessage(check.reason || "Username is not available.");
      return;
    }

    setErrorMessage("");
    setSaving(true);
    let updated: UserProfile;
    try {
      if (isMyProfile && token) {
        // Server-first PUT — only the API can persist a profile.
        const res = await api.profileUpdate(
          {
            username: clean,
            display_name: displayNameInput.trim() || `@${clean}`,
            bio: bioInput.trim(),
            avatar_seed: profile.avatarSeed,
          },
          token,
        );
        if (res?.profile) {
          updated = profileFromServer(res.profile);
        } else if (res?.error) {
          setErrorMessage(res.error);
          return;
        } else {
          updated = { ...profile, username: clean, displayName: displayNameInput.trim() || `@${clean}`, bio: bioInput.trim() };
        }
      } else {
        updated = {
          ...profile,
          username: clean,
          displayName: displayNameInput.trim() || `@${clean}`,
          bio: bioInput.trim(),
        };
        const saved = saveProfile(updated);
        if (!saved.ok) {
          setErrorMessage(saved.error || "Failed to save profile.");
          return;
        }
      }
      cacheProfile(updated);
      setProfile(updated);
      setUsernameInput(updated.username);
      setDisplayNameInput(updated.displayName);
      setBioInput(updated.bio);
      setErrorMessage("");
      setEditOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("409") || msg.includes("already taken")) {
        setErrorMessage("That username is already taken.");
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setSaving(false);
    }
  }, [profile, usernameInput, displayNameInput, bioInput, isMyProfile, token]);

  if (loading) {
    return (
      <AppFrame eyebrow="Profile" title="Loading Profile">
        <Card className="mt-8 text-center">
          <p className="font-mono text-sm text-white/60 animate-pulse">Loading profile…</p>
        </Card>
      </AppFrame>
    );
  }

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
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber/40 bg-gradient-to-br from-amber/20 to-orange/30 text-2xl font-bold text-white shadow-[0_0_20px_rgba(255,171,0,0.2)]">
                {profile.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-2xl uppercase tracking-tight text-white">{profile.displayName}</h2>
                  <span className="rounded-full bg-amber/20 px-2 py-0.5 font-mono text-[10px] text-amber border border-amber/40">
                    Verified
                  </span>
                </div>
                <p className="font-mono text-xs text-amber mt-0.5">@{profile.username}</p>
                <p className="mt-1 font-mono text-xs text-white/50">
                  Wallet: {profile.wallet.slice(0, 6)}…{profile.wallet.slice(-6)}
                </p>
                {profile.id && (
                  <p className="mt-0.5 font-mono text-[10px] text-white/30">
                    User id: {profile.id.slice(0, 8)}…
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              {isMyProfile ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setUsernameInput(profile.username);
                    setDisplayNameInput(profile.displayName);
                    setBioInput(profile.bio);
                    setErrorMessage("");
                    setServerCheck({ available: true });
                    setEditOpen(true);
                  }}
                  className="text-xs"
                >
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
              <p className="font-mono text-2xl text-amber font-bold">{profile.reputationScore}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/50 mt-1">Trust Score</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
              <p className="font-mono text-2xl text-white font-bold">{profile.totalDeals}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/50 mt-1">Deals Done</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
              <p className="font-mono text-2xl text-emerald-400 font-bold">{profile.activeLoans}</p>
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
              <h3 className="mt-1 font-display text-xl uppercase tracking-tight text-white">Listings by User</h3>
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

      {/* Edit Profile Modal with Real-Time Availability Check */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Profile">
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="eyebrow text-xs">Unique Username (Handle)</label>
              {cleanInput && (
                <span
                  className={`font-mono text-[11px] ${
                    isAvailable ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {isUnchanged
                    ? "✓ Current username"
                    : isAvailable
                    ? `✓ @${cleanInput} is available`
                    : `✕ ${serverCheck?.reason || "Username not available"}`}
                </span>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-amber">@</span>
              <Input
                value={usernameInput}
                onChange={(e) => {
                  setUsernameInput(e.target.value.replace(/\s+/g, ""));
                  setErrorMessage("");
                }}
                placeholder="your_unique_handle"
                className={`pl-8 ${
                  !isAvailable && cleanInput ? "border-red-500/60 focus:border-red-500" : ""
                }`}
              />
            </div>
            <p className="mt-1 font-mono text-[10px] text-white/40">
              Only lowercase letters, numbers, and underscores (3-20 characters).
            </p>
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
              placeholder="Describe your lending terms, collateral requirements, or borrowing plans..."
              className="h-24 w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 font-body text-sm text-white outline-none focus:border-amber"
            />
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          <Button
            onClick={handleSave}
            disabled={!isAvailable || !cleanInput || saving}
            className="w-full py-3.5 text-xs"
          >
            {saving ? "Saving…" : "Save Profile"}
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
