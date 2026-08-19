/** Shared protocol-facing types. Wallet signing and program IDs are configured only after the secure deployment gate. */
export type Visibility = "public" | "private";
export type ListingSide = "borrow" | "lend";
export type DurationMonths = 6 | 12 | 24;
export type DealState = "proposed" | "confirmed" | "funding" | "active" | "repaying" | "defaulted" | "partially_liquidated" | "fully_liquidated" | "completed" | "cancelled" | "closed";
export type StructuredTerms = { principalUsd: number; rateBps: number; durationMonths: DurationMonths; collateralLtvBps: number; loanMint: "USDC" | "USDT" };
export type MarketplaceListing = { id: string; side: ListingSide; poster: string; terms: StructuredTerms; completedLoans: number; defaults: number; createdAt: string };
