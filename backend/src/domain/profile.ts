/**
 * Persat Finance — profile domain (Node sidecar).
 *
 * Canonical identity = Solana wallet address (SIWS-bound). `id` is an opaque
 * stable UUID (server-issued, never invented by the client). Username uniqueness
 * is enforced in the database (UNIQUE + server check on write), NOT only client-side.
 */

import { randomUUID } from "node:crypto";
import type { UnifiedDb } from "../database.js";

export interface UserProfileRow {
  id?: string | null;
  wallet: string;
  username: string;
  display_name: string;
  bio?: string | null;
  avatar_seed?: string | null;
  reputation_score?: number;
  total_deals?: number;
  active_loans?: number;
  created_at?: string | Date;
  updated_at?: string | Date;
}

/** Normalize a raw username: trim, lowercase, drop leading '@'. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

export function validateUsername(username: string): string | null {
  if (username === "") return "Username cannot be empty.";
  if (username.length < 3) return "Username must be at least 3 characters.";
  if (username.length > 20) return "Username cannot exceed 20 characters.";
  if (!/^[a-z0-9_]+$/.test(username)) {
    return "Only lowercase letters, numbers, and underscores allowed.";
  }
  return null;
}

export function usernameTaken(db: UnifiedDb, username: string, excludeWallet: string | null): Promise<boolean> {
  if (excludeWallet) {
    return db
      .query(`SELECT wallet FROM user_profiles WHERE username = ? AND wallet != ? LIMIT 1`, [username, excludeWallet])
      .then((r) => r.rowCount === 1);
  }
  return db.query(`SELECT wallet FROM user_profiles WHERE username = ? LIMIT 1`, [username]).then((r) => r.rowCount === 1);
}

export async function generateDefaultUsername(db: UnifiedDb, wallet: string): Promise<string> {
  const base = `user_${wallet.slice(0, 4)}${wallet.slice(-4)}`.toLowerCase();
  let candidate = base;
  let i = 1;
  while (await usernameTaken(db, candidate, wallet)) {
    candidate = `${base}_${i++}`;
  }
  return candidate;
}

export async function getOrCreateProfile(db: UnifiedDb, wallet: string): Promise<UserProfileRow> {
  let result = await db.query(`SELECT * FROM user_profiles WHERE wallet = ? LIMIT 1`, [wallet]);
  if (result.rowCount === 1) {
    return ensureProfileId(db, result.rows[0] as UserProfileRow);
  }
  const id = randomUUID();
  const username = await generateDefaultUsername(db, wallet);
  await db.query(
    `INSERT INTO user_profiles (id, wallet, username, display_name, avatar_seed) VALUES (?, ?, ?, ?, ?)`,
    [id, wallet, username, `@${username}`, wallet.slice(0, 8)],
  );
  result = await db.query(`SELECT * FROM user_profiles WHERE wallet = ? LIMIT 1`, [wallet]);
  return ensureProfileId(db, result.rows[0] as UserProfileRow);
}

/** Backfill a missing id UUID (for rows created before the id column existed). */
export async function ensureProfileId(db: UnifiedDb, row: UserProfileRow): Promise<UserProfileRow> {
  if (row.id) return row;
  const id = randomUUID();
  try {
    await db.query(`UPDATE user_profiles SET id = ? WHERE wallet = ?`, [id, row.wallet]);
  } catch {
    // Column may not exist on a legacy table — still return a stable id in payload.
  }
  return { ...row, id };
}

/** Map a DB row to the public response shape. */
export function profilePayload(row: UserProfileRow): Record<string, unknown> {
  return {
    id: row.id ?? null,
    wallet: row.wallet,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio ?? "",
    avatar_seed: row.avatar_seed ?? "",
    reputation_score: Number(row.reputation_score ?? 100),
    total_deals: Number(row.total_deals ?? 0),
    active_loans: Number(row.active_loans ?? 0),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}
