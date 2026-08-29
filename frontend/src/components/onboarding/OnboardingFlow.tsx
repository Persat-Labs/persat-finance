"use client";
import { useState, useEffect } from "react";
import { Button } from "@/lib/design-system";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useProtocol } from "@/lib/protocol/hooks";
import { useProfile } from "@/lib/profile/userProfile";

const ONBOARDING_KEY = "persat_onboarding_completed_v1";

interface SlideData {
  icon: string;
  title: string;
  tagline: string;
  description: string;
}

const SLIDES: SlideData[] = [
  {
    icon: "🛡️",
    title: "Secure. Private. Yours.",
    tagline: "Bank-Grade Non-Custodial Protocol",
    description:
      "Your data is protected with bank-level security. Your Bitcoin stays locked in cryptographically verified smart contract vaults on Solana. We never take custody of your keys or funds.",
  },
  {
    icon: "📊",
    title: "Track. Analyze. Grow.",
    tagline: "Instant Overcollateralized Liquidity",
    description:
      "Get insights that help you make smarter decisions and grow your finances. Access instant USDC and USDT stablecoin loans against your BTC collateral without selling your stack.",
  },
  {
    icon: "🚀",
    title: "Let's launch your goals!",
    tagline: "Decentralized Peer-to-Peer Marketplace",
    description:
      "Join thousands of people who are already building a better future. Lend stablecoins directly to borrowers at fixed annual rates or borrow with zero counterparty risk.",
  },
];

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
    onComplete();
  };

  const isFinalStep = currentStep === 3;
  const currentSlide = SLIDES[currentStep];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-0 sm:p-4 backdrop-blur-2xl animate-reveal">
      {/* Full-screen on mobile (covers 100% of viewport without half-screens), sleek centered card on desktop */}
      <div className="glass sheen relative flex h-full w-full flex-col justify-between overflow-y-auto border-0 sm:border border-white/15 bg-black/95 p-6 sm:p-10 sm:h-auto sm:max-w-lg sm:rounded-[28px] shadow-2xl">
        {/* Top Header: Brand + Dismiss Asterisk */}
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber/30 to-orange/40 font-bold text-sm text-white">
              ⚡
            </div>
            <span className="font-brand-persat text-xl uppercase tracking-[.25em] text-white">
              persat
            </span>
          </div>

          <button
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
            /* Steps 0, 1, 2: The 3 Slides matching reference image */
            <div className="flex flex-col items-center text-center animate-reveal" key={currentStep}>
              {/* 3D-Style Illustrated Icon */}
              <div className="flex h-28 w-28 items-center justify-center rounded-3xl border border-white/15 bg-white/[0.04] text-5xl shadow-[0_0_35px_rgba(255,138,0,0.18)] mb-8">
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
            /* Step 3: The Final One - Exact requested Trust Layer screen */
            <div className="flex flex-col items-center text-center animate-reveal">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-amber/30 bg-gradient-to-br from-amber/20 to-orange/30 text-3xl shadow-[0_0_30px_rgba(255,171,0,0.25)] mb-6">
                ⚡
              </div>

              {publicKey ? (
                /* Connected State: Celebration & Actions */
                <div className="space-y-4 w-full">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 font-mono text-[11px] text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Wallet Connected</span>
                  </div>

                  <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
                    Welcome to Persat Finance! 🎉
                  </h2>

                  <p className="font-mono text-xs text-amber">
                    @{profile?.username || `user_${publicKey.toBase58().slice(0, 4)}`}
                  </p>

                  <p className="text-sm leading-6 text-white/70 max-w-sm mx-auto">
                    Your non-custodial terminal is active on Solana Devnet. You can request test funds now or head straight to your dashboard.
                  </p>

                  <div className="pt-4 space-y-3">
                    <Button
                      className="w-full py-4 text-xs"
                      onClick={() => {
                        handleFinish();
                        onOpenFunding();
                      }}
                    >
                      ⚡ Request Test Funds (SOL + BTC + USDC)
                    </Button>

                    <Button variant="secondary" className="w-full py-3 text-xs" onClick={handleFinish}>
                      Enter Dashboard →
                    </Button>
                  </div>
                </div>
              ) : (
                /* Final Trust Layer Auth Screen */
                <div className="space-y-4 w-full">
                  <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white">
                    Enter the Trust Layer
                  </h2>

                  <p className="max-w-sm mx-auto text-sm sm:text-base leading-7 text-white/70">
                    Connect your Solana wallet to explore peer-to-peer Bitcoin loans, create private deal links, and browse verified marketplace offers.
                  </p>

                  <div className="pt-6 space-y-3">
                    <Button
                      className="w-full py-4 text-xs font-semibold"
                      onClick={() => setWalletModalVisible(true)}
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
          {/* Pagination Indicator Dots */}
          <div className="flex justify-center gap-2">
            {[0, 1, 2, 3].map((stepIndex) => (
              <button
                key={stepIndex}
                onClick={() => setCurrentStep(stepIndex)}
                className={`h-2 rounded-full transition-all ${
                  currentStep === stepIndex ? "w-7 bg-amber" : "w-2 bg-white/20 hover:bg-white/40"
                }`}
                title={`Step ${stepIndex + 1}`}
              />
            ))}
          </div>

          {/* Primary Action Button */}
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

/**
 * Gate home load:
 * - Wallet already connected → dashboard immediately (no guide)
 * - New visitor (no wallet) → guide immediately, never flash dashboard
 * - While wallet adapter is still auto-connecting → hold (not dashboard)
 */
export function useOnboarding() {
  const { publicKey, connecting } = useProtocol();
  const [ready, setReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const handleTrigger = () => setShowOnboarding(true);
    window.addEventListener("persat_show_onboarding", handleTrigger);
    return () => window.removeEventListener("persat_show_onboarding", handleTrigger);
  }, []);

  useEffect(() => {
    // Hold until auto-connect finishes so returning wallets don't flash the guide
    if (connecting) {
      setReady(false);
      return;
    }

    const t = window.setTimeout(() => {
      const done = readOnboardingCompleted();
      setCompleted(done);

      if (publicKey) {
        // Wallet already connected → dashboard only, skip guide
        setShowOnboarding(false);
        setReady(true);
        return;
      }

      // No wallet: new users get guide first — never show dashboard underneath
      if (!done) {
        setShowOnboarding(true);
      } else {
        // Completed guide earlier but disconnected — dashboard OK (or they can reopen Guide *)
        setShowOnboarding(false);
      }
      setReady(true);
    }, 80);

    return () => window.clearTimeout(t);
  }, [publicKey, connecting]);

  return {
    /** false until guide-vs-dashboard is decided — home must not paint dashboard while false */
    ready,
    showOnboarding,
    onboardingCompleted: completed,
    openOnboarding: () => setShowOnboarding(true),
    closeOnboarding: () => {
      setCompleted(true);
      setShowOnboarding(false);
    },
  };
}
