/**
 * Aurora DSQL connection pool (Lambda-safe singleton).
 * Uses IAM authentication; set DSQL_HOST and DSQL_USER (and optional env) to enable.
 * @see https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_program-with-dsql-connector-for-node-postgres.html
 */
import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";
import type { QueryResultRow } from "pg";

const globalForDsql = globalThis as unknown as { dsqlPool: AuroraDSQLPool | null };

function getConfig() {
  const host = process.env.DSQL_HOST;
  const user = process.env.DSQL_USER;
  if (!host || !user) {
    return null;
  }
  return {
    host,
    user,
    database: process.env.DSQL_DATABASE ?? "postgres",
    port: process.env.DSQL_PORT ? parseInt(process.env.DSQL_PORT, 10) : 5432,
    region: process.env.DSQL_REGION ?? undefined,
    max: 3,
    idleTimeoutMillis: 60_000,
  };
}

/**
 * Returns the Aurora DSQL pool when DSQL_HOST and DSQL_USER are set.
 * In Lambda, the same pool is reused per container. Throws if env is missing when you call this.
 */
export function getAuroraDsqlPool(): AuroraDSQLPool {
  const config = getConfig();
  if (!config) {
    throw new Error(
      "Aurora DSQL not configured: set DSQL_HOST and DSQL_USER (and optionally DSQL_DATABASE, DSQL_REGION, DSQL_PORT)"
    );
  }
  if (!globalForDsql.dsqlPool) {
    globalForDsql.dsqlPool = new AuroraDSQLPool(config);
  }
  return globalForDsql.dsqlPool;
}

/**
 * Run a query against Aurora DSQL. Use when DSQL is configured (e.g. in Lambda).
 * @returns query result or null if DSQL env vars are not set
 */
export async function queryAuroraDsql<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null } | null> {
  const config = getConfig();
  if (!config) {
    return null;
  }
  const pool = getAuroraDsqlPool();
  const result = await pool.query<T>(text, values);
  return { rows: result.rows, rowCount: result.rowCount };
}

/**
 * Check if Aurora DSQL is configured (DSQL_HOST and DSQL_USER set).
 */
export function isAuroraDsqlConfigured(): boolean {
  return getConfig() !== null;
}
