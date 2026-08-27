"use client";
import Link from "next/link";
import { type ReactNode } from "react";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useProtocol } from "@/lib/protocol/hooks";
import { useProfile } from "@/lib/profile/userProfile";
import { BottomNav } from "@/components/navigation/BottomNav";
import { NotificationPopover } from "@/components/messaging/NotificationPopover";

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

  return (
    <main className="app-shell hud-grid min-h-screen pb-24 md:pb-12">
      {/* Floating Glass Navigation Header from waitlist/ */}
      <header className="sticky top-0 z-40 px-4 pt-3 sm:px-8">
        <nav className="glass mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-6 py-2 rounded-full border border-white/10 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="font-brand-persat text-xl uppercase tracking-[.24em] text-white hover:text-amber transition"
            >
              persat
            </Link>
            <span className="hidden sm:inline-block rounded-full border border-amber/30 bg-amber/10 px-2.5 py-0.5 font-mono text-[10px] text-amber">
              Devnet Beta
            </span>
          </div>

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
            <Link href="/messages" className="hover:text-amber transition">
              Messages
            </Link>
            {myWallet && (
              <Link href={`/profile/${myWallet}`} className="text-amber hover:text-white transition">
                {profile?.username ? `@${profile.username}` : "Profile"}
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            {myWallet && <NotificationPopover />}
            <WalletButton />
          </div>
        </nav>
      </header>

      {/* Main Page Content */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 font-display-persat text-3xl uppercase tracking-tight text-white sm:text-5xl">
          {title}
        </h1>
        {children}
      </section>

      {/* Mobile Sticky Bottom Navigation Bar from Reference */}
      <BottomNav />
    </main>
  );
}
