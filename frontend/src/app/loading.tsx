import { CardSkeleton, ChartSkeleton, Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="app-shell hud-grid min-h-screen px-6 py-10">
      <div className="mx-auto max-w-7xl space-y-8 animate-reveal">
        {/* Header skeleton */}
        <div className="flex justify-between items-center pb-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-64" />
          </div>
          <Skeleton className="h-10 w-36 rounded-full" />
        </div>

        {/* Dashboard Grid skeleton */}
        <div className="grid gap-6 lg:grid-cols-2">
          <CardSkeleton />
          <ChartSkeleton />
        </div>

        {/* List skeleton */}
        <div className="glass sheen rounded-[22px] p-6 space-y-4">
          <Skeleton className="h-5 w-40" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-white/[0.01]">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-8 w-24 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
