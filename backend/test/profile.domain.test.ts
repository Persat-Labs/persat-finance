/**
 * Profile domain tests — run against an in-memory UnifiedDb mock so they pass
 * with no external MySQL/Postgres. Verifies the identity model (wallet = primary,
 * server-issued UUID id, UNIQUE username) that the PHP + Node routes share.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { UnifiedDb } from "../src/database.js";
import {
  getOrCreateProfile,
  normalizeUsername,
  profilePayload,
  usernameTaken,
  validateUsername,
} from "../src/domain/profile.js";

type Row = Record<string, unknown>;

/** Minimal in-memory store that understands the exact SQL the domain module emits. */
function makeDb(): { db: UnifiedDb; rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const db: UnifiedDb = {
    type: "mysql",
    query: async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      // SELECT by wallet
      if (normalized.includes("user_profiles WHERE wallet = ? LIMIT 1")) {
        const w = params[0];
        const row = rows.get(String(w));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      // SELECT by username (public read)
      if (normalized.includes("WHERE username = ? LIMIT 1")) {
        const u = String(params[0]);
        const found = [...rows.values()].filter((r) => r.username === u);
        return { rows: found, rowCount: found.length };
      }
      // SELECT wallet conflict check (excluding a wallet)
      if (normalized.includes("WHERE username = ? AND wallet != ? LIMIT 1")) {
        const [u, w] = [String(params[0]), String(params[1])];
        const found = [...rows.values()].filter((r) => r.username === u && r.wallet !== w);
        return { rows: found, rowCount: found.length };
      }
      // SELECT wallet conflict check (no exclude)
      if (normalized.includes("SELECT wallet FROM user_profiles WHERE username = ? LIMIT 1")) {
        const u = String(params[0]);
        const found = [...rows.values()].filter((r) => r.username === u);
        return { rows: found, rowCount: found.length };
      }
      // INSERT new profile
      if (normalized.startsWith("INSERT INTO user_profiles")) {
        const [id, wallet, username, displayName, avatarSeed] = params;
        rows.set(String(wallet), {
          id: String(id),
          wallet: String(wallet),
          username: String(username),
          display_name: String(displayName),
          avatar_seed: String(avatarSeed),
          bio: "",
          reputation_score: 100,
          total_deals: 0,
          active_loans: 0,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        });
        return { rows: [], rowCount: 1 };
      }
      // UPDATE backfill id
      if (normalized.startsWith("UPDATE user_profiles SET id = ?")) {
        const [id, wallet] = params;
        if (rows.has(String(wallet))) {
          (rows.get(String(wallet)) as Row).id = String(id);
        }
        return { rows: [], rowCount: rows.has(String(wallet)) ? 1 : 0 };
      }
      // UPDATE profile fields
      if (normalized.startsWith("UPDATE user_profiles SET username = ?")) {
        const [username, displayName, bio, avatarSeed, wallet] = params;
        const row = rows.get(String(wallet));
        if (row) {
          row.username = username;
          row.display_name = displayName;
          row.bio = bio;
          row.avatar_seed = avatarSeed;
          row.updated_at = "2026-09-01T00:00:00Z";
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      throw new Error(`Unhandled SQL: ${normalized}`);
    },
  };
  return { db, rows };
}

test("normalizeUsername strips @ and lowercases", () => {
  assert.equal(normalizeUsername("  @Satoshi "), "satoshi");
});

test("validateUsername enforces format and length", () => {
  assert.equal(validateUsername("sat"), null);
  assert.equal(validateUsername("_satoshi9"), null);
  assert.match(validateUsername("ab") ?? "", /at least 3/);
  assert.match(validateUsername("has space") ?? "", /lowercase letters/);
  assert.match(validateUsername("UPPER") ?? "", /lowercase letters/);
});

test("getOrCreateProfile creates a server-issued id + unique default handle", async () => {
  const { db, rows } = makeDb();
  const wallet = "9QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD";
  const p = await getOrCreateProfile(db, wallet);
  assert.ok(p.id, "id must be server-issued");
  assert.equal(p.wallet, wallet);
  assert.equal(p.username, `user_${wallet.slice(0, 4)}${wallet.slice(-4)}`.toLowerCase()); // first4 + last4, lowercased
  assert.equal(rows.size, 1);

  // Calling again must NOT create a new row — returns the existing one.
  const again = await getOrCreateProfile(db, wallet);
  assert.equal(again.id, p.id);
  assert.equal(rows.size, 1);
});

test("collision-aware default username appends _N when the derived base is taken", async () => {
  const { db } = makeDb();
  const wallet = "9QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD";
  const base = `user_${wallet.slice(0, 4)}${wallet.slice(-4)}`.toLowerCase();
  // Seed a DIFFERENT wallet that already owns the derived base handle.
  await db.query(
    `INSERT INTO user_profiles (id, wallet, username, display_name, avatar_seed) VALUES (?, ?, ?, ?, ?)`,
    ["seed-id", "seed-wallet", base, `@${base}`, "seed"],
  );
  const p = await getOrCreateProfile(db, wallet);
  assert.equal(p.username, `${base}_1`, "must append _1 when base is taken");
  assert.notEqual(p.wallet, "seed-wallet");
});

test("usernameTaken detects conflicts, excluding the caller wallet", async () => {
  const { db } = makeDb();
  const w1 = "9QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD";
  const w2 = "9QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAE";
  // Manually set w1's username to satoshi
  const p = await getOrCreateProfile(db, w1);
  (p as Row).username = "satoshi";
  db.query(`UPDATE user_profiles SET username = ?, display_name = ?, bio = ?, avatar_seed = ? WHERE wallet = ?`, [
    "satoshi",
    "Satoshi",
    "",
    "",
    w1,
  ]);

  assert.equal(await usernameTaken(db, "satoshi", w2), true, "w2 cannot take w1's username");
  assert.equal(await usernameTaken(db, "satoshi", w1), false, "w1 may keep its own username");
  assert.equal(await usernameTaken(db, "free_handle", null), false);
});

test("profilePayload maps DB snake_case to the public response shape", async () => {
  const { db } = makeDb();
  const w = "9QGZmjKBsm9Bcnw21jn61Qe9SLAKS5ZAFoKLZDu3aAD";
  const p = await getOrCreateProfile(db, w);
  const payload = profilePayload(p);
  assert.equal(payload.wallet, w);
  assert.ok(payload.id);
  assert.equal(typeof payload.reputation_score, "number");
  assert.ok("display_name" in payload);
});
