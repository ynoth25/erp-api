/**
 * One-time helper to rename Prisma-created tables to lowercase
 * so they can be queried unquoted in Aurora DSQL / PostgreSQL.
 *
 * Safe to run multiple times.
 *
 * Usage:
 *   npm run dsql:rename:lowercase
 */
import { config } from "dotenv";
config();

import { getAuroraDsqlPool, queryDsql } from "../src/lib/aurora-dsql";

const TARGETS = [
  { table: "student", desiredPk: "Student_pkey" },
  { table: "employee", desiredPk: "Employee_pkey" },
  { table: "time_record", desiredPk: "TimeRecord_pkey" },
] as const;

function assertSafeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe ${label} identifier: ${value}`);
  }
}

async function main() {
  console.log("Renaming tables to lowercase (if needed)...");
  const pool = getAuroraDsqlPool();

  // Prisma default (model name) tables: "Student", "Employee", "TimeRecord"
  // Target lowercase tables: student, employee, time_record
  try {
    await queryDsql('ALTER TABLE IF EXISTS "Student" RENAME TO student;');
    await queryDsql('ALTER TABLE IF EXISTS "Employee" RENAME TO employee;');
    await queryDsql('ALTER TABLE IF EXISTS "TimeRecord" RENAME TO time_record;');

    // After renaming, PostgreSQL keeps constraint names (e.g. "Student_pkey"),
    // which can make Prisma want to "change primary key" during db push.
    // Normalize PK constraint names to the standard <table>_pkey.
    for (const t of TARGETS) {
      const { rows } = await queryDsql<{ conname: string }>(
        `
        select c.conname
        from pg_constraint c
        join pg_class tbl on c.conrelid = tbl.oid
        join pg_namespace n on tbl.relnamespace = n.oid
        where n.nspname = 'public'
          and tbl.relname = $1
          and c.contype = 'p'
        limit 1
        `,
        [t.table]
      );

      const current = rows[0]?.conname;
      if (!current || current === t.desiredPk) continue;

      assertSafeIdentifier(t.table, "table");
      assertSafeIdentifier(current, "constraint");
      assertSafeIdentifier(t.desiredPk, "constraint");

      await queryDsql(
        `ALTER TABLE "public"."${t.table}" RENAME CONSTRAINT "${current}" TO "${t.desiredPk}";`
      );
    }
  } finally {
    await pool.end().catch(() => {});
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Rename error:", err);
  process.exit(1);
});
