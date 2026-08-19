import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";

const DOMAIN = "Persat Finance";
const STATEMENT = "Sign this message to authenticate your wallet. This request does not create a transaction or grant access to funds.";
export const hashSecret = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export function createChallenge(wallet: string, appUrl: string, now = new Date()) {
  const nonce = randomBytes(32).toString("base64url");
  const issuedAt = now.toISOString();
  const message = `${DOMAIN} wants you to sign in with your Solana account:\n${wallet}\n\n${STATEMENT}\n\nURI: ${appUrl}\nIssued At: ${issuedAt}\nNonce: ${nonce}`;
  return { nonce, nonceHash: hashSecret(nonce), message };
}
export function verifySolanaMessage(wallet: string, message: string, signature: string) {
  try { return nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(signature), bs58.decode(wallet)); } catch { return false; }
}
export function createSessionToken() { const token = randomBytes(32).toString("base64url"); return { token, tokenHash: hashSecret(token) }; }
