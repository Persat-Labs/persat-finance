import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { createChallenge, verifySolanaMessage } from "../src/domain/walletAuth.js";

test("a Solana wallet signature verifies only against its exact challenge", () => {
  const pair = nacl.sign.keyPair(); const wallet = bs58.encode(pair.publicKey); const challenge = createChallenge(wallet, "https://example.test", new Date("2026-01-01T00:00:00.000Z"));
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), pair.secretKey));
  assert.equal(verifySolanaMessage(wallet, challenge.message, signature), true);
  assert.equal(verifySolanaMessage(wallet, `${challenge.message}tampered`, signature), false);
});
