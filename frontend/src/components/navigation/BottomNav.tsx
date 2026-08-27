"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProtocol } from "@/lib/protocol/hooks";

export function BottomNav({ onOpenMessages }: { onOpenMessages: () => void }) {
  const pathname = usePathname();
  const { publicKey } = useProtocol();
  const myWallet = publicKey ? publicKey.toBase58() : null;

  const profileHref = myWallet ? `/profile/${myWallet}` : "/profile/satoshi";

  const navItems = [
    {
      label: "Dashboard",
      href: "/",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-amber" : "text-white/50"}`}
          viewBox="0 0 24 24"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
      active: pathname === "/",
    },
    {
      label: "Deals",
      href: "/deal/new",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-amber" : "text-white/50"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      ),
      active: pathname.startsWith("/deal"),
    },
    {
      label: "Market",
      href: "/marketplace",
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-amber" : "text-white/50"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
          <path d="M2 7h20" />
        </svg>
      ),
      active: pathname.startsWith("/marketplace"),
    },
    {
      label: "Messages",
      action: onOpenMessages,
      icon: (active: boolean) => (
        <div className="relative">
          <svg
            className={`h-5 w-5 ${active ? "text-amber" : "text-white/50"}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber shadow-[0_0_6px_#ffab00]" />
        </div>
      ),
      active: false,
    },
    {
      label: "Profile",
      href: profileHref,
      icon: (active: boolean) => (
        <svg
          className={`h-5 w-5 ${active ? "text-amber" : "text-white/50"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
      active: pathname.startsWith("/profile"),
    },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 px-3 pb-3 pt-1">
      <div className="glass mx-auto flex max-w-md items-center justify-around rounded-full border border-white/15 bg-black/85 py-2.5 shadow-2xl backdrop-blur-2xl">
        {navItems.map((item) => {
          if (item.action) {
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className="flex flex-col items-center gap-1 px-3 py-1 font-mono text-[10px] tracking-wider text-white/50 hover:text-amber transition active:scale-95"
              >
                {item.icon(item.active)}
                <span>{item.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex flex-col items-center gap-1 px-3 py-1 font-mono text-[10px] tracking-wider transition active:scale-95 ${
                item.active ? "text-amber font-semibold" : "text-white/50 hover:text-white"
              }`}
            >
              {item.icon(item.active)}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
