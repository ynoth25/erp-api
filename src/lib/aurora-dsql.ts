/**
 * Aurora DSQL connection pool for raw SQL queries (Lambda-safe singleton).
 *
 * Uses the AWS DSQL connector which wraps node-postgres and handles
 * IAM token generation/refresh automatically — no manual token management.
 *
 * @see https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_program-with-dsql-connector-for-node-postgres.html
 */
import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";
import type { QueryResultRow } from "pg";
import { getDsqlConfig } from "./db";

const globalForDsql = globalThis as unknown as { dsqlPool: AuroraDSQLPool | null };

/**
 * Returns a singleton AuroraDSQLPool.
 * The DSQL connector handles IAM token generation automatically.
 */
export function getAuroraDsqlPool(): AuroraDSQLPool {
  if (!globalForDsql.dsqlPool) {
    const cfg = getDsqlConfig();
    globalForDsql.dsqlPool = new AuroraDSQLPool({
      host: cfg.host,
      user: cfg.user,
      database: cfg.database,
      port: cfg.port,
      region: cfg.region,
      max: 3,
      idleTimeoutMillis: 60_000,
    });
  }
  return globalForDsql.dsqlPool;
}

/**
 * Run a raw SQL query against Aurora DSQL.
 */
export async function queryDsql<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const pool = getAuroraDsqlPool();
  const result = await pool.query<T>(text, values);
  return { rows: result.rows, rowCount: result.rowCount };
}
