/**
 * Aurora DSQL database configuration.
 *
 * Aurora DSQL is PostgreSQL-compatible but uses IAM authentication:
 * - No static passwords — tokens are generated via @aws-sdk/dsql-signer
 * - Tokens expire in ~15 minutes, so they're generated fresh per connection/cold-start
 * - The DSQL Node.js connector (@aws/aurora-dsql-node-postgres-connector)
 *   wraps node-postgres and handles token generation automatically for raw pg queries.
 * - For Prisma, we generate a token and build a DATABASE_URL dynamically.
 */

import { DsqlSigner } from "@aws-sdk/dsql-signer";

export interface DsqlConfig {
  host: string;
  user: string;
  database: string;
  region: string;
  port: number;
}

/**
 * Read DSQL connection config from environment variables.
 */
export function getDsqlConfig(): DsqlConfig {
  const host = process.env.DSQL_HOST;
  const region = process.env.DSQL_REGION;
  if (!host || !region) {
    throw new Error("DSQL_HOST and DSQL_REGION must be set");
  }
  return {
    host,
    user: process.env.DSQL_USER ?? "admin",
    database: process.env.DSQL_DATABASE ?? "postgres",
    region,
    port: process.env.DSQL_PORT ? parseInt(process.env.DSQL_PORT, 10) : 5432,
  };
}

/**
 * Generate a fresh IAM auth token for Aurora DSQL.
 * The token acts as the password in a standard PostgreSQL connection string.
 */
export async function generateDsqlToken(config: DsqlConfig): Promise<string> {
  const signer = new DsqlSigner({
    hostname: config.host,
    region: config.region,
  });

  // admin user uses the admin token endpoint
  const token =
    config.user === "admin"
      ? await signer.getDbConnectAdminAuthToken()
      : await signer.getDbConnectAuthToken();

  return token;
}

/**
 * Build a PostgreSQL connection string with a fresh IAM token as password.
 * Used by Prisma (which reads DATABASE_URL).
 */
export async function buildDatabaseUrl(config?: DsqlConfig): Promise<string> {
  const cfg = config ?? getDsqlConfig();
  const token = await generateDsqlToken(cfg);
  const encodedToken = encodeURIComponent(token);
  return `postgresql://${cfg.user}:${encodedToken}@${cfg.host}:${cfg.port}/${cfg.database}?sslmode=require`;
}
