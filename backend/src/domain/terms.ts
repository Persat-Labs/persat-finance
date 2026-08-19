import { z } from "zod";

/** Marketplace terms intentionally contain no user-authored message, description, or contact field. */
export const loanMintSchema = z.enum(["USDC", "USDT"]);
export const durationSchema = z.union([z.literal(6), z.literal(12), z.literal(24)]);
export const structuredTermsSchema = z.object({
  principalAtoms: z.string().regex(/^\d+$/, "principalAtoms must be an unsigned integer string"),
  loanMint: loanMintSchema,
  rateBps: z.number().int().min(1).max(100_000),
  durationMonths: durationSchema,
  collateralLtvBps: z.number().int().min(1).max(5_000),
});
export const proposalSchema = z.object({
  listingId: z.string().uuid(),
  proposerWallet: z.string().min(32).max(44),
  terms: structuredTermsSchema,
});
export type StructuredTerms = z.infer<typeof structuredTermsSchema>;
