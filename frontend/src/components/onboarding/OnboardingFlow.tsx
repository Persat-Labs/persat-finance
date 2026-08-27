"use client";
import { useState, useEffect } from "react";
import { Button } from "@/lib/design-system";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useProtocol } from "@/lib/protocol/hooks";
import { useProfile } from "@/lib/profile/userProfile";

const ONBOARDING_KEY = "persat_onboarding_completed_v1";

interface OnboardingSlide {
  title: string;
  tagline: string;
  description: string;
  icon: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    icon: "🛡️",
    title: "Secure. Private. Yours.",
    tagline: "Bank-Grade Non-Custodial Architecture",
    description:
      "Your Bitcoin stays locked in cryptographically verified smart contract vaults on Solana. Nobody—not even the protocol—can touch your keys or collateral.",
  },
  {
    icon: "⚡",
    title: "Borrow USD. Keep Your Bitcoin.",
    tagline: "Instant Overcollateralized Liquidity",
    description:
      "Access immediate USDC and USDT stablecoin loans against your BTC collateral. Avoid taxable capital gains and keep full upside on your stack.",
  },
  {
    icon: "🚀",
    title: "Earn Fixed Yield. Zero Middlemen.",
    tagline: "Decentralized Peer-to-Peer Marketplace",
    description:
      "Lend stablecoins directly to borrowers at transparent fixed annual rates. Protected by real-time Pyth price oracles and automated liquidation safeties.",
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

  const [activeSlide, setActiveSlide] = useState(0);

  const handleFinish = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch {
      //
    }
    onComplete();
  };

  const currentSlide = SLIDES[activeSlide];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-2xl animate-reveal">
      {/* Container: Split Card on Desktop (Image 2), Slide Card on Mobile (Image 1) */}
      <div className="glass sheen relative w-full max-w-4xl overflow-hidden rounded-[26px] border border-white/15 bg-black/95 shadow-2xl">
        {/* Dismiss Asterisk in top-right */}
        <button
          onClick={handleFinish}
          className="absolute right-5 top-5 z-20 flex h-8 w-8 items-center justify-center font-mono text-lg text-white/40 hover:text-amber transition"
          title="Skip to Dashboard"
        >
          *
        </button>

        <div className="grid lg:grid-cols-2">
          {/* Left Column: Auth / Wallet Connection / Welcome Step */}
          <div className="flex flex-col justify-between p-6 sm:p-10 border-b border-white/10 lg:border-b-0 lg:border-r">
            <div>
              {/* Brand Wordmark */}
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber/30 to-orange/40 text-base">
                  ⚡
                </div>
                <span className="font-brand-persat text-xl uppercase tracking-[.25em] text-white">
                  persat
                </span>
              </div>

              {/* Dynamic Content: Welcome vs Connect */}
              <div className="mt-8">
                {publicKey ? (
                  <div className="space-y-4 animate-reveal">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Wallet Connected</span>
                    </div>

                    <h2 className="font-display text-3xl uppercase tracking-tight text-white sm:text-4xl">
                      Welcome to Persat Finance! 🎉
                    </h2>

                    <p className="font-mono text-xs text-amber">
                      @{profile?.username || `user_${publicKey.toBase58().slice(0, 4)}`}
                    </p>

                    <p className="text-sm leading-6 text-white/70">
                      Your non-custodial terminal is active on Solana Devnet. You can claim test assets right now or head straight to the dashboard to explore.
                    </p>

                    <div className="pt-4 space-y-2.5">
                      <Button
                        className="w-full py-3.5 text-xs"
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
                  <div className="space-y-4">
                    <h2 className="font-display text-3xl uppercase tracking-tight text-white sm:text-4xl">
                      Enter the Trust Layer
                    </h2>

                    <p className="text-sm leading-6 text-white/70">
                      Connect your Solana wallet to explore peer-to-peer Bitcoin loans, create private deal links, and browse verified marketplace offers.
                    </p>

                    <div className="pt-4 space-y-3">
                      <Button className="w-full py-4 text-xs" onClick={() => setWalletModalVisible(true)}>
                        Connect Solana Wallet
                      </Button>

                      <p className="text-center font-mono text-[11px] text-white/40">
                        Supports Phantom, Solflare, and Solana Wallet Standard.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Skip Link */}
            <div className="mt-8 border-t border-white/10 pt-4 text-center">
              <button
                type="button"
                onClick={handleFinish}
                className="font-ui-persat text-xs uppercase tracking-wider text-white/50 hover:text-white transition"
              >
                Skip Onboarding &amp; Explore Dashboard →
              </button>
            </div>
          </div>

          {/* Right Column: Visual Slides Carousel (Derived from Image 1 & 2) */}
          <div className="flex flex-col justify-between bg-gradient-to-br from-white/[0.03] to-transparent p-6 sm:p-10">
            <div>
              {/* Feature Slide Display */}
              <div className="flex flex-col items-center text-center pt-4">
                <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/15 bg-white/[0.04] text-5xl shadow-[0_0_30px_rgba(255,138,0,0.15)]">
                  {currentSlide.icon}
                </div>

                <p className="eyebrow mt-6 text-xs">{currentSlide.tagline}</p>
                <h3 className="font-display text-2xl uppercase tracking-tight text-white mt-2">
                  {currentSlide.title}
                </h3>
                <p className="mt-3 max-w-sm text-sm leading-6 text-white/70">
                  {currentSlide.description}
                </p>
              </div>
            </div>

            {/* Carousel Controls */}
            <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-5">
              {/* Pagination Indicator Dots from reference */}
              <div className="flex gap-2">
                {SLIDES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveSlide(i)}
                    className={`h-2 rounded-full transition-all ${
                      activeSlide === i ? "w-7 bg-amber" : "w-2 bg-white/20 hover:bg-white/40"
                    }`}
                    title={`Slide ${i + 1}`}
                  />
                ))}
              </div>

              {/* Next Slide Button */}
              <div className="flex gap-2">
                {activeSlide < SLIDES.length - 1 ? (
                  <Button
                    variant="secondary"
                    onClick={() => setActiveSlide((prev) => prev + 1)}
                    className="text-xs px-4 py-1.5"
                  >
                    Next Slide →
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => setActiveSlide(0)}
                    className="text-xs px-4 py-1.5"
                  >
                    Replay ↺
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    try {
      const completed = localStorage.getItem(ONBOARDING_KEY);
      if (!completed) {
        setShowOnboarding(true);
      }
    } catch {
      //
    }
  }, []);

  return {
    showOnboarding,
    openOnboarding: () => setShowOnboarding(true),
    closeOnboarding: () => setShowOnboarding(false),
  };
}
