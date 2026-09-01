/**
 * Load .env files for local / Railway-style deploys.
 * Order (first wins for each key — dotenv default does not override existing process.env):
 *   1. process environment (host secrets, CI, Railway Variables)
 *   2. backend/.env
 *   3. repo root .env
 *
 * Never commit .env — only .env.example. Never log values.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, "..");
const repoRoot = resolve(backendRoot, "..");

const candidates = [
  resolve(backendRoot, ".env"),
  resolve(backendRoot, ".env.local"),
  resolve(repoRoot, ".env"),
  resolve(repoRoot, ".env.local"),
];

const loaded: string[] = [];
for (const path of candidates) {
  if (!existsSync(path)) continue;
  const result = loadDotenv({ path, override: false });
  if (!result.error) loaded.push(path.replace(repoRoot + "/", "").replace(backendRoot + "/", "backend/"));
}

if (loaded.length > 0) {
  console.log(`[env] loaded ${loaded.join(", ")} (existing process.env wins)`);
} else {
  console.log("[env] no .env file found — using process environment only");
}
