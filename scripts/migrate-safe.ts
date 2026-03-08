/**
 * Safe CI migration: runs only additive SQL (CREATE TABLE IF NOT EXISTS).
 *
 * Unlike `prisma db push`, this never touches existing tables — it only
 * creates new ones. Place each migration in the MIGRATIONS array below.
 *
 * Usage:  npx tsx scripts/migrate-safe.ts
 */
import { config } from "dotenv";
import * as pg from "pg";
import { getDsqlConfig, generateDsqlToken } from "../src/lib/db";

config();

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "create_records_request",
    sql: `
      CREATE TABLE IF NOT EXISTS "records_request" (
        "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "companyId"       TEXT NOT NULL,
        "lrn"             TEXT,
        "studentName"     TEXT NOT NULL,
        "gender"          TEXT,
        "lastSchoolYear"  TEXT,
        "gradeSection"    TEXT,
        "major"           TEXT,
        "adviser"         TEXT,
        "contactNo"       TEXT,
        "requestorName"   TEXT,
        "requestTypes"    TEXT NOT NULL,
        "otherRequest"    TEXT,
        "status"          TEXT NOT NULL DEFAULT 'PENDING',
        "remarks"         TEXT,
        "source"          TEXT NOT NULL DEFAULT 'WEB',
        "processedBy"     TEXT,
        "submittedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "processedAt"     TIMESTAMP(3),
        "releasedAt"      TIMESTAMP(3),
        "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "records_request_pkey" PRIMARY KEY ("id")
      );
    `,
  },
];

async function main() {
  const cfg = getDsqlConfig();
  console.log(`Connecting to ${cfg.host} as ${cfg.user}...`);

  const token = await generateDsqlToken(cfg);
  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: token,
    database: cfg.database,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected.\n");

  for (const m of MIGRATIONS) {
    console.log(`Running: ${m.name}`);
    try {
      await client.query(m.sql);
      console.log(`  ✓ ${m.name} applied\n`);
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        console.log(`  – ${m.name} skipped (already exists)\n`);
      } else {
        throw err;
      }
    }
  }

  await client.end();
  console.log("Done. All migrations applied safely.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
