/**
 * Session + challenge store.
 * - With PERSAT_DATABASE_URL: durable tables (wallet_auth_challenges / wallet_sessions)
 * - Without DB (Mode W / local preview): in-memory maps — process-local, lost on restart
 *
 * Tokens are random 32-byte secrets; only SHA-256 hashes are stored.
 * Never log raw tokens.
 */

import { randomUUID } from "node:crypto";
import { createChallenge, createSessionToken, hashSecret, verifySolanaMessage } from "./walletAuth.js";
import { config } from "../config.js";

export type ChallengeRecord = {
  id: string;
  wallet: string;
  nonceHash: string;
  message: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export type SessionRecord = {
  id: string;
  wallet: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

const memChallenges = new Map<string, ChallengeRecord>();
const memSessions = new Map<string, SessionRecord>(); // key = tokenHash

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function pruneMemory() {
  const now = Date.now();
  for (const [id, c] of memChallenges) {
    if (c.expiresAt.getTime() < now || c.usedAt) memChallenges.delete(id);
  }
  for (const [h, s] of memSessions) {
    if (s.expiresAt.getTime() < now || s.revokedAt) memSessions.delete(h);
  }
}

export function sessionBackendMode(): "database" | "memory" {
  return config.persistentStoreConfigured ? "database" : "memory";
}

export async function issueChallenge(wallet: string): Promise<{ challengeId: string; message: string; expiresAt: string; mode: string }> {
  const built = createChallenge(wallet, config.appUrl);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  if (sessionBackendMode() === "database") {
    try {
      const { requireDatabase } = await import("../database.js");
      const db = await requireDatabase();
      const id = randomUUID();
      await db.query(
        `INSERT INTO wallet_auth_challenges (id, wallet, nonce_hash, message, expires_at) VALUES (?, ?, ?, ?, ?)`,
        [id, wallet, built.nonceHash, built.message, expiresAt.toISOString()],
      );
      return { challengeId: id, message: built.message, expiresAt: expiresAt.toISOString(), mode: "database" };
    } catch {
      // fall through to memory
    }
  }

  pruneMemory();
  const id = randomUUID();
  memChallenges.set(id, {
    id,
    wallet,
    nonceHash: built.nonceHash,
    message: built.message,
    expiresAt,
    usedAt: null,
  });
  return { challengeId: id, message: built.message, expiresAt: expiresAt.toISOString(), mode: "memory" };
}

export async function verifyChallengeAndCreateSession(
  challengeId: string,
  signature: string,
): Promise<{ token: string; wallet: string; expiresInSeconds: number; mode: string } | { error: string; status: number }> {
  const now = new Date();

  if (sessionBackendMode() === "database") {
    try {
      const { requireDatabase } = await import("../database.js");
      const db = await requireDatabase();
      const result = await db.query(
        `SELECT wallet, message FROM wallet_auth_challenges WHERE id = ? AND used_at IS NULL AND expires_at > ? LIMIT 1`,
        [challengeId, now.toISOString()],
      );
      if (result.rowCount !== 1) return { error: "Challenge expired or already used.", status: 401 };
      const row = result.rows[0];
      if (!verifySolanaMessage(row.wallet, row.message, signature)) {
        return { error: "Signature verification failed.", status: 401 };
      }
      await db.query(`UPDATE wallet_auth_challenges SET used_at = ? WHERE id = ?`, [now.toISOString(), challengeId]);
      const session = createSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await db.query(
        `INSERT INTO wallet_sessions (id, wallet, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
        [randomUUID(), row.wallet, session.tokenHash, expiresAt.toISOString()],
      );
      return { token: session.token, wallet: row.wallet, expiresInSeconds: 86400, mode: "database" };
    } catch {
      // memory path below
    }
  }

  pruneMemory();
  const challenge = memChallenges.get(challengeId);
  if (!challenge || challenge.usedAt || challenge.expiresAt.getTime() < Date.now()) {
    return { error: "Challenge expired or already used.", status: 401 };
  }
  if (!verifySolanaMessage(challenge.wallet, challenge.message, signature)) {
    return { error: "Signature verification failed.", status: 401 };
  }
  challenge.usedAt = now;
  memChallenges.set(challengeId, challenge);

  const session = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const rec: SessionRecord = {
    id: randomUUID(),
    wallet: challenge.wallet,
    tokenHash: session.tokenHash,
    expiresAt,
    revokedAt: null,
  };
  memSessions.set(session.tokenHash, rec);
  return { token: session.token, wallet: challenge.wallet, expiresInSeconds: 86400, mode: "memory" };
}

export async function lookupSessionWallet(rawToken: string): Promise<string | null> {
  const tokenHash = hashSecret(rawToken);
  const now = new Date();

  if (sessionBackendMode() === "database") {
    try {
      const { requireDatabase } = await import("../database.js");
      const db = await requireDatabase();
      const result = await db.query(
        `SELECT wallet FROM wallet_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
        [tokenHash, now.toISOString()],
      );
      if (result.rowCount === 1) return result.rows[0].wallet as string;
    } catch {
      // try memory
    }
  }

  pruneMemory();
  const s = memSessions.get(tokenHash);
  if (!s || s.revokedAt || s.expiresAt.getTime() < Date.now()) return null;
  return s.wallet;
}

export async function revokeSession(rawToken: string): Promise<void> {
  const tokenHash = hashSecret(rawToken);
  if (sessionBackendMode() === "database") {
    try {
      const { requireDatabase } = await import("../database.js");
      const db = await requireDatabase();
      await db.query(`UPDATE wallet_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`, [
        new Date().toISOString(),
        tokenHash,
      ]);
    } catch {
      //
    }
  }
  const s = memSessions.get(tokenHash);
  if (s) {
    s.revokedAt = new Date();
    memSessions.set(tokenHash, s);
  }
}

export async function revokeAllForWallet(wallet: string): Promise<void> {
  if (sessionBackendMode() === "database") {
    try {
      const { requireDatabase } = await import("../database.js");
      const db = await requireDatabase();
      await db.query(`UPDATE wallet_sessions SET revoked_at = ? WHERE wallet = ? AND revoked_at IS NULL`, [
        new Date().toISOString(),
        wallet,
      ]);
    } catch {
      //
    }
  }
  for (const [h, s] of memSessions) {
    if (s.wallet === wallet && !s.revokedAt) {
      s.revokedAt = new Date();
      memSessions.set(h, s);
    }
  }
}
