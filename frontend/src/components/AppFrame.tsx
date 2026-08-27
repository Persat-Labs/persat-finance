"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useProtocol } from "@/lib/protocol/hooks";
import { useProfile } from "@/lib/profile/userProfile";
import { MessagesDrawer } from "@/components/messaging/MessagesDrawer";

export function AppFrame({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  const { publicKey } = useProtocol();
  const myWallet = publicKey ? publicKey.toBase58() : null;
  const { profile } = useProfile(myWallet);
  const [messagesOpen, setMessagesOpen] = useState(false);

  return (
    <main className="app-shell hud-grid min-h-screen">
      {/* Floating Glass Navigation Header from waitlist/ */}
      <header className="sticky top-0 z-40 px-4 pt-4 sm:px-8">
        <nav className="glass mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-6 py-2.5 rounded-full border border-white/10 shadow-2xl backdrop-blur-xl">
          <Link
            href="/"
            className="font-brand-persat text-xl uppercase tracking-[.24em] text-white hover:text-amber transition"
          >
            persat
          </Link>

          <div className="hidden items-center gap-6 font-mono text-[11px] uppercase tracking-widest text-white/70 md:flex">
            <Link href="/deal/new" className="hover:text-amber transition">
              Direct Deal
            </Link>
            <Link href="/marketplace" className="hover:text-amber transition">
              Marketplace
            </Link>
            <Link href="/faucet" className="hover:text-amber transition">
              Faucet
            </Link>
            <Link href="/keeper" className="hover:text-amber transition">
              Keeper
            </Link>
            {myWallet && (
              <Link href={`/profile/${myWallet}`} className="text-amber hover:text-white transition">
                {profile?.username ? `@${profile.username}` : "Profile"}
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            {myWallet && (
              <button
                type="button"
                onClick={() => setMessagesOpen(true)}
                className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white transition hover:border-amber hover:bg-white/[0.08]"
                title="Open Deal Messages"
              >
                <span className="text-base">💬</span>
                <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-amber" />
                </span>
              </button>
            )}
            <WalletButton />
          </div>
        </nav>
      </header>

      {/* Main Page Content */}
      <section className="mx-auto max-w-7xl px-6 py-10 sm:py-12">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 font-display-persat text-3xl uppercase tracking-tight text-white sm:text-5xl">
          {title}
        </h1>
        {children}
      </section>

      {/* Global In-App Messages Drawer */}
      <MessagesDrawer open={messagesOpen} onClose={() => setMessagesOpen(false)} />
    </main>
  );
}
