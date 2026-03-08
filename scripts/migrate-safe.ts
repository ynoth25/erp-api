/**
 * Safe CI migration for Aurora DSQL.
 *
 * Each migration wraps its DDL in BEGIN/COMMIT (DSQL requires one DDL
 * statement per transaction). Migrations are idempotent — tables use
 * CREATE TABLE IF NOT EXISTS and columns use ADD COLUMN IF NOT EXISTS.
 *
 * Usage:  npx tsx scripts/migrate-safe.ts
 *         npx tsx scripts/migrate-safe.ts --force-reset   # DROP all then recreate
 */
import { config } from "dotenv";
import * as pg from "pg";
import { getDsqlConfig, generateDsqlToken } from "../src/lib/db";

config();

const forceReset = process.argv.includes("--force-reset");

const DROP_ALL = [
  `DROP TABLE IF EXISTS "records_request"`,
  `DROP TABLE IF EXISTS "clock_event"`,
  `DROP TABLE IF EXISTS "attendance"`,
  `DROP TABLE IF EXISTS "biometric_device"`,
  `DROP TABLE IF EXISTS "company_invite"`,
  `DROP TABLE IF EXISTS "company_member"`,
  `DROP TABLE IF EXISTS "company"`,
  `DROP TABLE IF EXISTS "app_user"`,
];

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "create_app_user",
    sql: `
      CREATE TABLE IF NOT EXISTS "app_user" (
        "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "cognitoSub"  TEXT NOT NULL,
        "email"       TEXT NOT NULL,
        "firstName"   TEXT NOT NULL,
        "lastName"    TEXT NOT NULL,
        "phone"       TEXT,
        "avatarUrl"   TEXT,
        "isAdmin"     BOOLEAN NOT NULL DEFAULT false,
        "isActive"    BOOLEAN NOT NULL DEFAULT true,
        "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
      );
    `,
  },
  {
    name: "create_company",
    sql: `
      CREATE TABLE IF NOT EXISTS "company" (
        "id"        TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "name"      TEXT NOT NULL,
        "code"      TEXT NOT NULL,
        "address"   TEXT,
        "timezone"  TEXT NOT NULL DEFAULT 'Asia/Manila',
        "logoUrl"   TEXT,
        "settings"  TEXT,
        "isActive"  BOOLEAN NOT NULL DEFAULT true,
        "ownerId"   TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "company_pkey" PRIMARY KEY ("id")
      );
    `,
  },
  {
    name: "create_company_member",
    sql: `
      CREATE TABLE IF NOT EXISTS "company_member" (
        "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "companyId"   TEXT NOT NULL,
        "userId"      TEXT NOT NULL,
        "role"        TEXT NOT NULL DEFAULT 'MEMBER',
        "memberType"  TEXT NOT NULL DEFAULT 'EMPLOYEE',
        "employeeId"  TEXT,
        "department"  TEXT,
        "position"    TEXT,
        "status"      TEXT NOT NULL DEFAULT 'ACTIVE',
        "joinedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "company_member_pkey" PRIMARY KEY ("id")
      );
    `,
  },
  {
    name: "create_company_invite",
    sql: `
      CREATE TABLE IF NOT EXISTS "company_invite" (
        "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "companyId"  TEXT NOT NULL,
        "email"      TEXT,
        "role"       TEXT NOT NULL DEFAULT 'MEMBER',
        "memberType" TEXT NOT NULL DEFAULT 'EMPLOYEE',
        "token"      TEXT NOT NULL,
        "expiresAt"  TIMESTAMP(3) NOT NULL,
        "acceptedAt" TIMESTAMP(3),
        "acceptedBy" TEXT,
        "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "company_invite_pkey" PRIMARY KEY ("id")
      );
    `,
  },
  {
    name: "create_biometric_device",
    sql: `
      CREATE TABLE IF NOT EXISTS "biometric_device" (
        "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "companyId"     TEXT NOT NULL,
        "name"          TEXT NOT NULL,
        "serialNumber"  TEXT,
        "deviceType"    TEXT NOT NULL,
        "location"      TEXT,
        "apiKey"        TEXT NOT NULL,
        "isActive"      BOOLEAN NOT NULL DEFAULT true,
        "lastHeartbeat" TIMESTAMP(3),
        "metadata"      TEXT,
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "biometric_device_pkey" PRIMARY KEY ("id")
      );
    `,
  },
  {
    name: "create_attendance",
    sql: `
      CREATE TABLE IF NOT EXISTS "attendance" (
        "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "companyId"     TEXT NOT NULL,
        "memberId"      TEXT NOT NULL,
        "date"          TIMESTAMP(3) NOT NULL,
        "status"        TEXT NOT NULL DEFAULT 'PRESENT',
        "firstClockIn"  TIMESTAMP(3),
        "lastClockOut"  TIMESTAMP(3),
        "totalMinutes"  INTEGER,
        "overtimeMin"   INTEGER,
        "remarks"       TEXT,
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
      );
    `,
  },
  {
    name: "create_clock_event",
    sql: `
      CREATE TABLE IF NOT EXISTS "clock_event" (
        "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "companyId"     TEXT NOT NULL,
        "memberId"      TEXT NOT NULL,
        "attendanceId"  TEXT,
        "eventType"     TEXT NOT NULL,
        "timestamp"     TIMESTAMP(3) NOT NULL,
        "source"        TEXT NOT NULL,
        "deviceId"      TEXT,
        "locationLat"   DOUBLE PRECISION,
        "locationLng"   DOUBLE PRECISION,
        "photoUrl"      TEXT,
        "remarks"       TEXT,
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "clock_event_pkey" PRIMARY KEY ("id")
      );
    `,
  },
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
  {
    name: "create_indexes",
    sql: `
      CREATE INDEX ASYNC IF NOT EXISTS idx_user_cognitosub ON "app_user" ("cognitoSub");
      CREATE INDEX ASYNC IF NOT EXISTS idx_user_email ON "app_user" ("email");
      CREATE INDEX ASYNC IF NOT EXISTS idx_company_code ON "company" ("code");
      CREATE INDEX ASYNC IF NOT EXISTS idx_company_ownerid ON "company" ("ownerId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_member_companyid ON "company_member" ("companyId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_member_userid ON "company_member" ("userId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_member_company_user ON "company_member" ("companyId", "userId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_member_employeeid ON "company_member" ("companyId", "employeeId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_invite_token ON "company_invite" ("token");
      CREATE INDEX ASYNC IF NOT EXISTS idx_invite_companyid ON "company_invite" ("companyId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_device_apikey ON "biometric_device" ("apiKey");
      CREATE INDEX ASYNC IF NOT EXISTS idx_device_companyid ON "biometric_device" ("companyId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_attendance_company_date ON "attendance" ("companyId", "date");
      CREATE INDEX ASYNC IF NOT EXISTS idx_attendance_member_date ON "attendance" ("memberId", "date");
      CREATE INDEX ASYNC IF NOT EXISTS idx_clockevent_companyid ON "clock_event" ("companyId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_clockevent_memberid ON "clock_event" ("memberId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_clockevent_attendanceid ON "clock_event" ("attendanceId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_clockevent_deviceid ON "clock_event" ("deviceId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_clockevent_timestamp ON "clock_event" ("companyId", "timestamp");
      CREATE INDEX ASYNC IF NOT EXISTS idx_recreq_companyid ON "records_request" ("companyId");
      CREATE INDEX ASYNC IF NOT EXISTS idx_recreq_status ON "records_request" ("companyId", "status");
      CREATE INDEX ASYNC IF NOT EXISTS idx_recreq_lrn ON "records_request" ("companyId", "lrn");
      CREATE INDEX ASYNC IF NOT EXISTS idx_recreq_submitted ON "records_request" ("companyId", "submittedAt");
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

  if (forceReset) {
    console.log("⚠️  --force-reset: dropping all tables...\n");
    for (const sql of DROP_ALL) {
      const table = sql.match(/"([^"]+)"$/)?.[1] ?? sql;
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`  ✓ Dropped ${table}`);
      } catch (err: any) {
        await client.query("ROLLBACK");
        console.log(`  – ${table}: ${err.message}`);
      }
    }
    console.log();
  }

  for (const m of MIGRATIONS) {
    console.log(`Running: ${m.name}`);
    const statements = m.sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        await client.query("BEGIN");
        await client.query(stmt);
        await client.query("COMMIT");
      } catch (err: any) {
        await client.query("ROLLBACK");
        if (err.message?.includes("already exists")) {
          console.log(`  – skipped (already exists)`);
        } else {
          console.error(`  ✗ Error: ${err.message}`);
          throw err;
        }
      }
    }
    console.log(`  ✓ ${m.name} applied`);
  }

  await client.end();
  console.log("\nDone. All migrations applied.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
