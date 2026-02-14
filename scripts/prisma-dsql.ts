/**
 * Helper: generates a fresh IAM token for Aurora DSQL, sets DATABASE_URL,
 * then runs the Prisma CLI command passed as arguments.
 *
 * Usage:  npx tsx scripts/prisma-dsql.ts db push
 *         npx tsx scripts/prisma-dsql.ts studio
 *         npx tsx scripts/prisma-dsql.ts db push --force-reset
 *
 * Reads DSQL_HOST, DSQL_REGION, DSQL_USER, DSQL_DATABASE from .env
 */
import { config } from "dotenv";
import { execSync } from "node:child_process";
import { buildDatabaseUrl, getDsqlConfig } from "../src/lib/db";

config(); // load .env

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx scripts/prisma-dsql.ts <prisma-args...>");
    console.error("  e.g. npx tsx scripts/prisma-dsql.ts db push");
    process.exit(1);
  }

  const cfg = getDsqlConfig();
  console.log(`Generating IAM token for ${cfg.user}@${cfg.host} (${cfg.region})...`);

  const databaseUrl = await buildDatabaseUrl(cfg);
  console.log("Token generated. Running: prisma", args.join(" "), "\n");

  execSync(`npx prisma ${args.join(" ")}`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
