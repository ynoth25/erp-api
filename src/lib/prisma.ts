import { PrismaClient } from "@prisma/client";
import { buildDatabaseUrl } from "./db";

/**
 * IAM tokens for Aurora DSQL expire in ~15 minutes.
 * Recreate the PrismaClient before expiry so Lambda containers
 * that live for hours don't hit stale-token errors.
 */
const TOKEN_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes (safe margin under 15 min)

let cachedPrisma: PrismaClient | null = null;
let tokenCreatedAt = 0;

function isTokenExpired(): boolean {
  return Date.now() - tokenCreatedAt > TOKEN_MAX_AGE_MS;
}

/**
 * Get a PrismaClient connected to Aurora DSQL with a fresh IAM token.
 *
 * - First call (cold start): generates token, creates client, caches it.
 * - Subsequent calls: returns cached client if token is still valid.
 * - After ~10 min: disconnects old client, generates a new token, creates a new client.
 *
 * Safe for Lambda (singleton per container) and local dev.
 */
export async function getPrisma(): Promise<PrismaClient> {
  if (cachedPrisma && !isTokenExpired()) {
    return cachedPrisma;
  }

  // Disconnect old client if token expired
  if (cachedPrisma) {
    await cachedPrisma.$disconnect().catch(() => {});
    cachedPrisma = null;
  }

  const datasourceUrl = await buildDatabaseUrl();

  cachedPrisma = new PrismaClient({
    datasourceUrl,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

  tokenCreatedAt = Date.now();
  return cachedPrisma;
}
