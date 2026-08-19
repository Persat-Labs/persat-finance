import pg from "pg";

const databaseUrl = process.env.PERSAT_DATABASE_URL;
/** Persistent storage is mandatory for deal-link single-use semantics and proposals. */
export const database = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined }) : null;

export async function requireDatabase() {
  if (!database) throw new Error("Persistent database is not configured");
  return database;
}
