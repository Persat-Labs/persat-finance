"use client";
import { useState } from "react";
import { Input } from "@/lib/design-system";

/** Structured discovery controls only. No free-text or contact data is accepted in marketplace UX. */
export function MarketplaceFilters() {
  const [side, setSide] = useState<"all" | "borrow" | "lend">("all");
  const [duration, setDuration] = useState<"all" | "6" | "12" | "24">("all");
  const [sort, setSort] = useState<"rate" | "history">("rate");
  return <section className="mt-8 border-y border-amber/15 py-5"><div className="grid gap-5 lg:grid-cols-4"><fieldset><legend className="eyebrow mb-3">Looking to</legend><div className="flex gap-2">{(["all", "borrow", "lend"] as const).map((value) => <FilterButton key={value} selected={side === value} onClick={() => setSide(value)}>{value}</FilterButton>)}</div></fieldset><fieldset><legend className="eyebrow mb-3">Duration</legend><div className="flex gap-2">{(["all", "6", "12", "24"] as const).map((value) => <FilterButton key={value} selected={duration === value} onClick={() => setDuration(value)}>{value === "all" ? "Any" : `${value} mo`}</FilterButton>)}</div></fieldset><label><span className="eyebrow mb-3 block">Amount range (USD)</span><div className="flex gap-2"><Input aria-label="Minimum amount" type="number" min="1" placeholder="Min" /><Input aria-label="Maximum amount" type="number" min="1" placeholder="Max" /></div></label><fieldset><legend className="eyebrow mb-3">Sort listings</legend><div className="flex gap-2"><FilterButton selected={sort === "rate"} onClick={() => setSort("rate")}>Rate</FilterButton><FilterButton selected={sort === "history"} onClick={() => setSort("history")}>History</FilterButton></div></fieldset></div><p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-orange-50/60">Filters are ready. Verified on-chain listings appear after the Deal Registry and indexer are connected.</p></section>;
}
function FilterButton({ children, selected, onClick }: { children: string; selected: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={`min-h-12 border px-3 font-mono text-[11px] uppercase tracking-wider ${selected ? "border-amber bg-amber/10 text-white" : "border-amber/20 bg-ink text-orange-50"}`}>{children}</button>; }
