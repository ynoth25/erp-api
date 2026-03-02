import { config } from "dotenv";
config();

import { queryDsql, getAuroraDsqlPool } from "../src/lib/aurora-dsql";

const TABLES = process.argv.length > 2
  ? process.argv.slice(2)
  : [
      "clock_event",
      "attendance",
      "biometric_device",
      "company_member",
      "company_invite",
      "lead",
      "company",
      "app_user",
    ];

async function main() {
  console.log("Dropping all tables...");
  for (const t of TABLES) {
    try {
      await queryDsql(`DROP TABLE IF EXISTS "${t}" CASCADE`);
      console.log(`  Dropped: ${t}`);
    } catch (e: any) {
      console.log(`  Skip ${t}: ${e.message}`);
    }
  }
  const pool = getAuroraDsqlPool();
  await pool.end().catch(() => {});
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
