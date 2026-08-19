import { createHash, randomBytes } from "node:crypto";

/** Raw deal-link tokens are returned exactly once and are never persisted. */
export function createDealLinkToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashDealLinkToken(token) };
}
export function hashDealLinkToken(token: string) { return createHash("sha256").update(token, "utf8").digest("hex"); }
