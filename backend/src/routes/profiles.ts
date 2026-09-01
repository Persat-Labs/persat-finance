import type { FastifyInstance } from "fastify";
import { requireDatabase } from "../database.js";
import {
  getOrCreateProfile,
  normalizeUsername,
  profilePayload,
  validateUsername,
  usernameTaken,
} from "../domain/profile.js";
import { getRequestWallet, requireWalletSession } from "../middleware/auth.js";

export async function profileRoutes(app: FastifyInstance) {
  /** GET /v1/profiles/me — auth; get-or-create own profile. */
  app.get("/v1/profiles/me", { preHandler: [requireWalletSession] }, async (request, reply) => {
    const wallet = getRequestWallet(request);
    if (!wallet) return reply.code(401).send({ error: "Wallet session required." });
    try {
      const db = await requireDatabase();
      const profile = await getOrCreateProfile(db, wallet);
      return { ok: true, wallet, profile: profilePayload(profile) };
    } catch (err) {
      request.log.error(err, "[profiles] get/me failed");
      return reply.code(503).send({ error: "Profiles unavailable — check PERSAT_DATABASE_URL." });
    }
  });

  /** PUT /v1/profiles/me — auth; update own profile, enforce UNIQUE username. */
  app.put("/v1/profiles/me", { preHandler: [requireWalletSession] }, async (request, reply) => {
    const wallet = getRequestWallet(request);
    if (!wallet) return reply.code(401).send({ error: "Wallet session required." });

    const body = (request.body ?? {}) as Record<string, unknown>;
    const usernameRaw = String(body.username ?? "");
    const displayName = String(body.display_name ?? body.displayName ?? "").trim();
    const bio = String(body.bio ?? "").trim();
    const avatarSeed = String(body.avatar_seed ?? body.avatarSeed ?? "").trim();

    const username = normalizeUsername(usernameRaw);
    const validationError = validateUsername(username);
    if (validationError) {
      return reply.code(400).send({ error: validationError, field: "username" });
    }

    try {
      const db = await requireDatabase();
      if (await usernameTaken(db, username, wallet)) {
        return reply.code(409).send({
          error: `Username @${username} is already taken by another wallet.`,
          field: "username",
          username,
        });
      }

      // Ensure the row exists first.
      await getOrCreateProfile(db, wallet);

      const cleanDisplay = displayName || `@${username}`;
      await db.query(
        `UPDATE user_profiles SET username = ?, display_name = ?, bio = ?, avatar_seed = ? WHERE wallet = ?`,
        [username, cleanDisplay, bio, avatarSeed, wallet],
      );

      const result = await db.query(`SELECT * FROM user_profiles WHERE wallet = ? LIMIT 1`, [wallet]);
      const row = result.rows[0];
      return { ok: true, wallet, profile: profilePayload(row) };
    } catch (err) {
      request.log.error(err, "[profiles] update failed");
      if ((err as Error).message.includes("not configured")) {
        return reply.code(503).send({ error: "Profiles persistence requires PERSAT_DATABASE_URL (MySQL)." });
      }
      return reply.code(503).send({ error: "Profile update unavailable — try again." });
    }
  });

  /** GET /v1/profiles/username/:name/available — public availability (exclude ?wallet=). */
  app.get("/v1/profiles/username/:name/available", async (request, reply) => {
    const { name } = request.params as { name: string };
    const wallet = (request.query as { wallet?: string }).wallet;
    const username = normalizeUsername(name);

    const validationError = validateUsername(username);
    if (validationError) return { available: false, reason: validationError };

    try {
      const db = await requireDatabase();
      const taken = await usernameTaken(db, username, wallet || null);
      return taken
        ? { available: false, username, reason: `@${username} is already claimed by another wallet.` }
        : { available: true, username };
    } catch (err) {
      request.log.error(err, "[profiles] availability failed");
      // Fail closed: if we cannot verify server-side, don't claim it is free.
      return { available: false, username, reason: "Availability check unavailable — try again." };
    }
  });

  /** GET /v1/profiles/:walletOrUsername — public read. */
  app.get("/v1/profiles/:identifier", async (request, reply) => {
    const { identifier } = request.params as { identifier: string };
    const decoded = decodeURIComponent(identifier);

    // Solana wallets are base58 (32–44 chars); usernames are 3–20 chars.
    const isWallet = decoded.length >= 32 && decoded.length <= 44;

    try {
      const db = await requireDatabase();
      const result = isWallet
        ? await db.query(`SELECT * FROM user_profiles WHERE wallet = ? LIMIT 1`, [decoded])
        : await db.query(`SELECT * FROM user_profiles WHERE username = ? LIMIT 1`, [normalizeUsername(decoded)]);
      if (result.rowCount === 1) {
        return { ok: true, profile: profilePayload(result.rows[0]) };
      }
      return reply.code(404).send({ ok: true, profile: null });
    } catch (err) {
      request.log.error(err, "[profiles] lookup failed");
      return reply.code(503).send({ error: "Profiles unavailable — check PERSAT_DATABASE_URL." });
    }
  });
}
