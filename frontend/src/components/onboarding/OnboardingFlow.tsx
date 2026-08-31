"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/lib/design-system";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useProtocol } from "@/lib/protocol/hooks";
import { useProfile } from "@/lib/profile/userProfile";
import { getStoredAuthToken } from "@/lib/api";

/** Bumped when gate rules change so stale "skipped" flags don't unlock the dashboard */
export const ONBOARDING_KEY = "persat_onboarding_completed_v2";
export const AUTH_WALLET_KEY = "persat_auth_wallet_v1";
/** Legacy keys cleared on mount so old skips cannot hide onboarding */
const LEGACY_ONBOARDING_KEYS = ["persat_onboarding_completed_v1"];

interface SlideData {
  icon: string;
  title: string;
  tagline: string;
  description: string;
}

const SLIDES: SlideData[] = [
  {
    icon: "🤝",
    title: "What if you could lend to anyone?",
    tagline: "The Problem Is Trust",
    description:
      "Most of us have lent money because we trusted someone — and too often it never came back. The problem isn't that people won't lend. It's that lending still depends on personal trust.",
  },
  {
    icon: "🛡️",
    title: "Infrastructure, not favors.",
    tagline: "Trust-Minimized Credit",
    description:
      "Persat is building infrastructure so you don't have to personally trust the borrower. Credit is secured by digital assets. Terms are programmable. Enforcement is transparent — on smart contracts.",
  },
  {
    icon: "₿",
    title: "Bitcoin is the first vehicle.",
    tagline: "Current Pilot",
    description:
      "We're piloting with Bitcoin because holders already need liquidity without selling. That's the first market — not the final destination. The highway is open lending infrastructure.",
  },
];

function PersatLogo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/persatlogo.png"
      alt="Persat Finance"
      width={size}
      height={size}
      className={`object-contain ${className}`}
      priority
    />
  );
}

export function OnboardingFlow({
  onComplete,
  onOpenFunding,
}: {
  onComplete: () => void;
  onOpenFunding: () => void;
}) {
  const { publicKey } = useProtocol();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const myWallet = publicKey ? publicKey.toBase58() : null;
  const { profile } = useProfile(myWallet);

  // Steps: 0, 1, 2 = Slides, 3 = Final Trust Layer Screen
  const [currentStep, setCurrentStep] = useState(0);

  const handleFinish = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch {
      //
    }
    // Without a wallet, stay on the final "Connect" step — never dump to dashboard
    if (!publicKey) {
      setCurrentStep(3);
      return;
    }
    onComplete();
  };

  const isFinalStep = currentStep === 3;
  const currentSlide = SLIDES[currentStep];

  return (
    {/* z-40: below wallet-adapter modal (z-10050) so Connect can open the picker */}
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black p-0 sm:p-4 animate-reveal">
      {/* Full-screen on mobile; no dashboard or bottom tabs visible underneath */}
      <div className="relative flex h-full w-full flex-col justify-between overflow-y-auto border-0 bg-black p-6 sm:border sm:border-white/15 sm:bg-black/95 sm:p-10 sm:h-auto sm:max-w-lg sm:rounded-[28px] sm:shadow-2xl sm:backdrop-blur-2xl">
        {/* Top Header: real brand logo + Dismiss */}
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2.5">
            <PersatLogo size={36} className="h-9 w-9" />
            <span className="font-brand-persat text-xl uppercase tracking-[.25em] text-white">
              persat
            </span>
          </div>

          <button
            type="button"
            onClick={handleFinish}
            className="flex h-8 w-8 items-center justify-center font-mono text-lg text-white/40 hover:text-amber transition"
            title="Skip for now"
          >
            *
          </button>
        </div>

        {/* Content Body */}
        <div className="my-auto py-6">
          {!isFinalStep ? (
            <div className="flex flex-col items-center text-center animate-reveal" key={currentStep}>
              <div className="mb-8 flex h-28 w-28 items-center justify-center rounded-3xl border border-white/15 bg-white/[0.04] text-5xl shadow-[0_0_35px_rgba(255,138,0,0.18)]">
                {currentSlide.icon}
              </div>

              <p className="eyebrow text-xs tracking-widest text-amber">{currentSlide.tagline}</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mt-3">
                {currentSlide.title}
              </h2>
              <p className="mt-4 max-w-sm text-sm sm:text-base leading-7 text-white/70">
                {currentSlide.description}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center animate-reveal">
              {/* Final slide: bare transparent logo — no chrome / glow box */}
              <div className="mb-6 flex items-center justify-center">
                <PersatLogo size={88} className="h-[88px] w-[88px]" />
              </div>

              {publicKey ? (
                <div className="space-y-4 w-full">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 font-mono text-[11px] text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Wallet Connected</span>
                  </div>

                  <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
                    Welcome to Persat Finance!
                  </h2>

                  <p className="font-mono text-xs text-amber">
                    @{profile?.username || `user_${publicKey.toBase58().slice(0, 4)}`}
                  </p>

                  <p className="text-sm leading-6 text-white/70 max-w-sm mx-auto">
                    Your terminal is live on Solana Devnet — the Bitcoin pilot of Persat&apos;s lending infrastructure. Request test funds or open the dashboard.
                  </p>

                  <div className="pt-4 space-y-3">
                    <Button
                      className="w-full py-4 text-xs"
                      onClick={() => {
                        handleFinish();
                        onOpenFunding();
                      }}
                    >
                      Request Test Funds (SOL + BTC + USDC)
                    </Button>

                    <Button variant="secondary" className="w-full py-3 text-xs" onClick={handleFinish}>
                      Enter Dashboard →
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 w-full">
                  <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white">
                    Enter the Infrastructure
                  </h2>

                  <p className="max-w-sm mx-auto text-sm sm:text-base leading-7 text-white/70">
                    Connect your Solana wallet to try trust-minimized lending — private deals, marketplace offers, and Bitcoin as the first collateral pilot.
                  </p>

                  <div className="pt-6 space-y-3">
                    <Button
                      type="button"
                      className="w-full py-4 text-xs font-semibold"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Open adapter modal above onboarding (see globals.css z-index)
                        setWalletModalVisible(true);
                      }}
                    >
                      Connect Solana Wallet
                    </Button>

                    <p className="text-center font-mono text-[11px] text-white/40">
                      Supports Phantom, Solflare, and Solana Wallet Standard.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Navigation & Controls */}
        <div className="pt-4 space-y-5">
          <div className="flex justify-center gap-2">
            {[0, 1, 2, 3].map((stepIndex) => (
              <button
                key={stepIndex}
                type="button"
                onClick={() => setCurrentStep(stepIndex)}
                className={`h-2 rounded-full transition-all ${
                  currentStep === stepIndex ? "w-7 bg-amber" : "w-2 bg-white/20 hover:bg-white/40"
                }`}
                title={`Step ${stepIndex + 1}`}
              />
            ))}
          </div>

          {!isFinalStep ? (
            <div className="space-y-3">
              <Button
                className="w-full py-4 text-xs"
                onClick={() => setCurrentStep((prev) => prev + 1)}
              >
                Continue
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleFinish}
                  className="font-ui-persat text-xs uppercase tracking-wider text-white/50 hover:text-white transition"
                >
                  Skip for now
                </button>
              </div>
            </div>
          ) : (
            !publicKey && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={handleFinish}
                  className="font-ui-persat text-xs uppercase tracking-wider text-white/50 hover:text-white transition"
                >
                  Skip for now
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function readOnboardingCompleted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "true";
  } catch {
    return false;
  }
}

/** Returning user with API session token still in browser */
export function readHasPersistedSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const token = getStoredAuthToken();
    const wallet = localStorage.getItem(AUTH_WALLET_KEY);
    return Boolean(token && token.length > 20 && wallet && wallet.length >= 32);
  } catch {
    return false;
  }
}

/**
 * Gate home (strict):
 * - NO connected wallet → always full-screen onboarding (never the dashboard)
 * - Wallet connected → dashboard immediately (session optional for API later)
 * - After onboarding + wallet, other tabs → home still dashboard while wallet stays connected
 * - Disconnect → onboarding again
 *
 * localStorage "completed" only marks that they finished the slides once (for analytics /
 * Guide *); it does NOT unlock the dashboard without a wallet.
 */
export function useOnboarding() {
  const { publicKey, connecting } = useProtocol();
  const [mounted, setMounted] = useState(false);
  const [gateReady, setGateReady] = useState(false);
  /** true until we know a wallet is present */
  const [showOnboarding, setShowOnboarding] = useState(true);
  /** Manual reopen (Guide *) even with wallet connected */
  const [forceShow, setForceShow] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Drop legacy skip flags that used to unlock dashboard without a wallet
    try {
      for (const k of LEGACY_ONBOARDING_KEYS) localStorage.removeItem(k);
    } catch {
      //
    }
  }, []);

  // Cap autoConnect wait — then decide with whatever wallet state we have
  useEffect(() => {
    if (!mounted || gateReady) return;
    const t = window.setTimeout(() => {
      setGateReady(true);
      // Still no wallet after wait → onboarding (never dashboard)
      if (!publicKey) setShowOnboarding(true);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [mounted, gateReady, publicKey]);

  useEffect(() => {
    if (!mounted) return;

    // Wait briefly for autoConnect so returning Phantom users skip the wall
    if (connecting) {
      return;
    }

    if (publicKey) {
      // Connected wallet → dashboard (unless user opened Guide *)
      if (!forceShow) setShowOnboarding(false);
      setGateReady(true);
      return;
    }

    // No wallet → always onboarding. Never use session/onboarded flag to show dashboard.
    setShowOnboarding(true);
    setGateReady(true);
  }, [mounted, publicKey, connecting, forceShow]);

  useEffect(() => {
    const handleTrigger = () => {
      setForceShow(true);
      setShowOnboarding(true);
      setGateReady(true);
    };
    window.addEventListener("persat_show_onboarding", handleTrigger);
    return () => window.removeEventListener("persat_show_onboarding", handleTrigger);
  }, []);

  const mustOnboard = !publicKey || forceShow;

  return {
    /** False until client + wallet autoConnect settled — avoid painting dashboard first */
    gateReady: mounted && gateReady,
    /**
     * Full-screen guide only — home must not render dashboard or mobile tabs.
     * No wallet ⇒ always true. Wallet ⇒ only if Guide * / force.
     */
    showOnboarding: mounted && gateReady && mustOnboard && (forceShow || showOnboarding || !publicKey),
    openOnboarding: () => {
      setForceShow(true);
      setShowOnboarding(true);
      setGateReady(true);
    },
    closeOnboarding: () => {
      try {
        localStorage.setItem(ONBOARDING_KEY, "true");
      } catch {
        //
      }
      setForceShow(false);
      // Without a wallet, closing slides still keeps onboarding wall — user must connect
      // to reach dashboard. "Skip" only dismisses the multi-step deck when wallet is live.
      if (publicKey) {
        setShowOnboarding(false);
      } else {
        // Stay on final connect step feel: keep wall; jump flow still requires connect
        setShowOnboarding(true);
      }
    },
  };
}
