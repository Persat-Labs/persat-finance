import mysql from "mysql2/promise";
import pg from "pg";
import { config } from "./config.js";

type DbType = "mysql" | "pg" | "none";
let dbType: DbType = "none";
let mysqlPool: mysql.Pool | null = null;
let pgPool: pg.Pool | null = null;

function detectDbType(url: string | undefined): DbType {
  if (!url) return "none";
  if (url.startsWith("mysql://") || url.startsWith("mysql2://")) return "mysql";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "pg";
  // Default to mysql for new deployments if url contains @ and / but no postgres
  if (url.includes("@") && !url.includes("postgres")) return "mysql";
  return "pg";
}

function createMysqlPool(): mysql.Pool | null {
  if (!config.databaseUrl) return null;
  if (mysqlPool) return mysqlPool;
  // mysql2 connection string: mysql://user:pass@host:port/db
  mysqlPool = mysql.createPool({
    uri: config.databaseUrl,
    waitForConnections: true,
    connectionLimit: Number(process.env.PG_POOL_MAX ?? 20),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  dbType = "mysql";
  return mysqlPool;
}

function createPgPool(): pg.Pool | null {
  if (!config.databaseUrl) return null;
  if (pgPool) return pgPool;
  pgPool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.nodeEnv === "production" ? { rejectUnauthorized: true } : undefined,
    max: Number(process.env.PG_POOL_MAX ?? 20),
    min: Number(process.env.PG_POOL_MIN ?? 2),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pgPool.on("error", (err) => {
    console.error("[db] Unexpected pg pool error", err);
  });
  dbType = "pg";
  return pgPool;
}

function createPool() {
  if (!config.databaseUrl) {
    dbType = "none";
    return null;
  }
  const detected = detectDbType(config.databaseUrl);
  if (detected === "mysql") return createMysqlPool();
  if (detected === "pg") return createPgPool();
  // Fallback: try mysql first, then pg
  return createMysqlPool() || createPgPool();
}

// Unified query interface — handles both mysql (?) and pg ($1) placeholders
export interface UnifiedDb {
  type: DbType;
  query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>;
}

export const database = (() => {
  const pool = createPool();
  if (!pool) return null;
  // Return wrapper later via requireDatabase
  return pool as any;
})();

export async function requireDatabase(): Promise<UnifiedDb> {
  const url = config.databaseUrl;
  if (!url) throw new Error("Persistent database is not configured — set PERSAT_DATABASE_URL (MySQL recommended: mysql://user:pass@host:port/db)");

  const detected = detectDbType(url);
  if (detected === "mysql" || (!pgPool && (detected === "none" || url.includes("mysql")))) {
    const pool = mysqlPool ?? createMysqlPool();
    if (!pool) throw new Error("MySQL pool not configured");
    // Liveness check
    try {
      await pool.query("SELECT 1");
    } catch (e) {
      throw new Error(`MySQL unavailable: ${(e as Error).message}`);
    }
    return {
      type: "mysql",
      query: async (sql: string, params?: any[]) => {
        let mysqlSql = sql;
        // Convert PG placeholders $1,$2 to ?
        if (mysqlSql.includes("$1") || mysqlSql.includes("$2")) {
          mysqlSql = mysqlSql.replace(/\$\d+/g, "?");
        }
        // Normalize PG functions to MySQL
        mysqlSql = mysqlSql.replace(/gen_random_uuid\(\)/gi, "UUID()");
        mysqlSql = mysqlSql.replace(/now\(\) \+ interval '5 minutes'/gi, "DATE_ADD(NOW(), INTERVAL 5 MINUTE)");
        mysqlSql = mysqlSql.replace(/NOW\(\) \+ \(\$\d+ \* INTERVAL '1 minute'\)/gi, "DATE_ADD(NOW(), INTERVAL ? MINUTE)");
        mysqlSql = mysqlSql.replace(/NOW\(\) \+ \(\? \* INTERVAL '1 minute'\)/gi, "DATE_ADD(NOW(), INTERVAL ? MINUTE)");
        const [rows] = await pool.query(mysqlSql, params);
        const rowCount = Array.isArray(rows) ? (rows as any[]).length : (rows as any).affectedRows ?? 0;
        return { rows: rows as any[], rowCount };
      },
    };
  } else {
    const pool = pgPool ?? createPgPool();
    if (!pool) throw new Error("PG pool not configured");
    try {
      await pool.query("SELECT 1");
    } catch (e) {
      throw new Error(`Postgres unavailable: ${(e as Error).message}`);
    }
    return {
      type: "pg",
      query: async (sql: string, params?: any[]) => {
        // Convert MySQL-style ? and UUID() to PG $1 and gen_random_uuid()
        let pgSql = sql;
        if (pgSql.includes("?")) {
          pgSql = pgSql.replace(/DATE_ADD\(NOW\(\), INTERVAL \? MINUTE\)/gi, "NOW() + (? * INTERVAL '1 minute')");
          pgSql = pgSql.replace(/UUID\(\)/gi, "gen_random_uuid()");
          // Convert ? to $1,$2 sequentially
          let idx = 0;
          pgSql = pgSql.replace(/\?/g, () => {
            idx += 1;
            return `$${idx}`;
          });
        } else {
          // Already PG style, but ensure UUID() fallback handled
          pgSql = pgSql.replace(/UUID\(\)/gi, "gen_random_uuid()");
        }
        const result = await pool.query(pgSql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
      },
    };
  }
}

export async function closeDatabase(): Promise<void> {
  if (mysqlPool) {
    await mysqlPool.end();
    mysqlPool = null;
  }
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  dbType = "none";
}
