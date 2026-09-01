/**
 * Instant route transition shell — mimics AppFrame chrome, no brand text flash.
 * Skeleton bars only; disappears the moment the page chunk hydrates.
 */
export default function Loading() {
  return (
    <main className="app-shell hud-grid min-h-screen bg-black pb-24 md:pb-12" aria-busy="true">
      {/* Header pill — same geometry as AppFrame */}
      <header className="sticky top-0 z-40 px-4 pt-3 sm:px-8">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 rounded-full border border-white/10 bg-white/[0.03] px-6 py-2 backdrop-blur-xl">
          <div className="h-4 w-20 rounded bg-white/10" />
          <div className="hidden items-center gap-6 md:flex">
            <div className="h-3 w-14 rounded bg-white/8" />
            <div className="h-3 w-14 rounded bg-white/8" />
            <div className="h-3 w-16 rounded bg-white/8" />
            <div className="h-3 w-14 rounded bg-white/8" />
          </div>
          <div className="h-8 w-24 rounded-full bg-white/10" />
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-6 px-4 pt-6 sm:px-8 sm:pt-8">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-full bg-white/10" />
          <div className="space-y-2">
            <div className="h-5 w-40 rounded bg-white/10" />
            <div className="h-3 w-56 rounded bg-white/5" />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          <div className="h-52 rounded-2xl border border-white/10 bg-white/[0.03]" />
          <div className="h-52 rounded-2xl border border-white/10 bg-white/[0.03]" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          <div className="h-64 rounded-2xl border border-white/10 bg-white/[0.03]" />
          <div className="h-64 rounded-2xl border border-white/10 bg-white/[0.03]" />
        </div>
      </section>
    </main>
  );
}
