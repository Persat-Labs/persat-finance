import Link from "next/link";
import type { ReactNode } from "react";

export function AppFrame({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return <main className="app-shell hud-grid min-h-screen"><nav className="border-b border-amber/10 bg-ink/80 backdrop-blur-md"><div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-6"><Link href="/" className="font-display text-xl uppercase tracking-[.24em]">persat</Link><div className="flex gap-4 font-mono text-[11px] uppercase tracking-widest text-orange-50 sm:gap-7"><Link href="/deal/new" className="hover:text-amber">Direct deal</Link><Link href="/marketplace" className="hover:text-amber">Marketplace</Link><Link href="/faucet" className="hover:text-amber">Faucet</Link><Link href="/keeper" className="hover:text-amber">Keeper</Link><Link href="/admin" className="hover:text-amber">Admin</Link></div></div></nav><section className="mx-auto max-w-7xl px-6 py-12"><p className="eyebrow">{eyebrow}</p><h1 className="mt-3 font-display text-3xl uppercase tracking-tight sm:text-5xl">{title}</h1>{children}</section></main>;
}
