/**
 * Prisma seeder — generates ~20,000 records for load testing.
 *
 * Distribution:
 *   2,000 Users
 *   2,000 Companies (1 per user, user becomes OWNER)
 *   2,000 CompanyMembers (1 OWNER per company)
 *   2,000 BiometricDevices (1 per company)
 *   6,000 Attendance records (3 days per member)
 *   6,000 ClockEvents (1 CLOCK_IN per attendance)
 *   ─────────────────────────────
 *   ~20,000 total
 *
 * Run:  npm run dsql:seed
 */
import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";
import { buildDatabaseUrl } from "../src/lib/db";
import { randomBytes } from "crypto";

const BATCH = 200;
const TOTAL_USERS = 2000;
const DAYS_OF_ATTENDANCE = 3;

const FIRST_NAMES = [
  "Carlos", "Sofia", "Miguel", "Isabella", "Rafael", "Maria", "Jose", "Ana",
  "Juan", "Gabriela", "Pedro", "Lucia", "Marco", "Elena", "Diego", "Rosa",
  "Fernando", "Carmen", "Andres", "Patricia", "Luis", "Teresa", "Jorge",
  "Beatriz", "Ricardo", "Pilar", "Manuel", "Laura", "Roberto", "Cristina",
  "Eduardo", "Angela", "Daniel", "Marta", "Alejandro", "Paula", "Alberto",
  "Sandra", "Raul", "Monica", "Oscar", "Irene", "Victor", "Sara", "Adrian",
  "Natalia", "Ivan", "Claudia", "Hugo", "Valentina",
];

const LAST_NAMES = [
  "Mendoza", "Lim", "Tan", "Cruz", "Torres", "Santos", "Dela Cruz", "Reyes",
  "Garcia", "Flores", "Rivera", "Gonzales", "Lopez", "Martinez", "Hernandez",
  "Ramirez", "Aquino", "Bautista", "Castro", "Dizon", "Enriquez", "Francisco",
  "Go", "Ignacio", "Jimenez", "Lacson", "Magno", "Navarro", "Ong", "Padilla",
  "Quizon", "Ramos", "Salvador", "Tinio", "Uy", "Villanueva", "Wong", "Yap",
  "Zamora", "Aguilar",
];

const DEPARTMENTS = [
  "Engineering", "Finance", "HR", "Marketing", "Sales", "Operations",
  "IT", "Legal", "Admin", "Support", "R&D", "QA",
];

const POSITIONS = [
  "Manager", "Senior Engineer", "Developer", "Analyst", "Coordinator",
  "Specialist", "Associate", "Director", "Lead", "Officer",
];

const COMPANY_SUFFIXES = [
  "Corp", "Inc", "LLC", "Solutions", "Technologies", "Systems",
  "Global", "Enterprises", "Group", "Holdings", "Industries", "Services",
];

const DEVICE_TYPES = ["FINGERPRINT", "FACIAL_RECOGNITION", "IRIS", "RFID"];
const SOURCES = ["BIOMETRIC", "WEB", "MOBILE"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function cuid(): string {
  const ts = Date.now().toString(36);
  const rnd = randomBytes(8).toString("hex");
  return `c${ts}${rnd}`;
}

function generateCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

async function main() {
  const datasourceUrl = await buildDatabaseUrl();
  const prisma = new PrismaClient({ datasourceUrl });

  console.log("=== Seeding ~20,000 records ===\n");
  const t0 = Date.now();

  // ─── Generate all data in memory ──────────────────
  const userRows: Array<{
    id: string; cognitoSub: string; email: string;
    firstName: string; lastName: string; phone: string;
    isAdmin: boolean;
  }> = [];

  const companyRows: Array<{
    id: string; name: string; code: string; address: string;
    timezone: string; ownerId: string;
  }> = [];

  const memberRows: Array<{
    id: string; companyId: string; userId: string; role: string;
    memberType: string; employeeId: string; department: string;
    position: string; status: string;
  }> = [];

  const deviceRows: Array<{
    id: string; companyId: string; name: string; serialNumber: string;
    deviceType: string; location: string; apiKey: string;
  }> = [];

  const attendanceRows: Array<{
    id: string; companyId: string; memberId: string; date: Date;
    status: string; firstClockIn: Date; lastClockOut: Date; totalMinutes: number;
  }> = [];

  const clockEventRows: Array<{
    id: string; companyId: string; memberId: string; attendanceId: string;
    eventType: string; timestamp: Date; source: string;
  }> = [];

  console.log("Generating data in memory...");

  for (let i = 0; i < TOTAL_USERS; i++) {
    const userId = cuid();
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const companyId = cuid();
    const memberId = cuid();
    const deviceId = cuid();

    userRows.push({
      id: userId,
      cognitoSub: `seed-${i.toString().padStart(5, "0")}`,
      email: `user${i}@seed-${companyId.slice(-6)}.test`,
      firstName,
      lastName,
      phone: `+63917${(1000000 + i).toString()}`,
      isAdmin: i === 0,
    });

    companyRows.push({
      id: companyId,
      name: `${firstName} ${lastName} ${pick(COMPANY_SUFFIXES)}`,
      code: generateCode(),
      address: `${100 + i} Business Ave, Metro Manila`,
      timezone: "Asia/Manila",
      ownerId: userId,
    });

    memberRows.push({
      id: memberId,
      companyId,
      userId,
      role: "OWNER",
      memberType: "EMPLOYEE",
      employeeId: `E-${i.toString().padStart(5, "0")}`,
      department: pick(DEPARTMENTS),
      position: pick(POSITIONS),
      status: "ACTIVE",
    });

    deviceRows.push({
      id: deviceId,
      companyId,
      name: `Scanner ${i + 1}`,
      serialNumber: `DEV-${i.toString().padStart(5, "0")}`,
      deviceType: pick(DEVICE_TYPES),
      location: `Building ${String.fromCharCode(65 + (i % 26))}`,
      apiKey: `dev_${randomBytes(16).toString("hex")}`,
    });

    for (let d = 0; d < DAYS_OF_ATTENDANCE; d++) {
      const attId = cuid();
      const day = new Date();
      day.setUTCDate(day.getUTCDate() - d);
      day.setUTCHours(0, 0, 0, 0);

      const clockInHour = 7 + Math.random() * 2;
      const clockOutHour = clockInHour + 7 + Math.random() * 2;
      const clockIn = new Date(day);
      clockIn.setUTCHours(Math.floor(clockInHour), Math.floor((clockInHour % 1) * 60), 0, 0);
      const clockOut = new Date(day);
      clockOut.setUTCHours(Math.floor(clockOutHour), Math.floor((clockOutHour % 1) * 60), 0, 0);
      const totalMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000);

      attendanceRows.push({
        id: attId,
        companyId,
        memberId,
        date: day,
        status: "PRESENT",
        firstClockIn: clockIn,
        lastClockOut: clockOut,
        totalMinutes,
      });

      clockEventRows.push({
        id: cuid(),
        companyId,
        memberId,
        attendanceId: attId,
        eventType: "CLOCK_IN",
        timestamp: clockIn,
        source: pick(SOURCES),
      });
    }
  }

  const total = userRows.length + companyRows.length + memberRows.length +
    deviceRows.length + attendanceRows.length + clockEventRows.length;
  console.log(`  Users: ${userRows.length}`);
  console.log(`  Companies: ${companyRows.length}`);
  console.log(`  Members: ${memberRows.length}`);
  console.log(`  Devices: ${deviceRows.length}`);
  console.log(`  Attendance: ${attendanceRows.length}`);
  console.log(`  ClockEvents: ${clockEventRows.length}`);
  console.log(`  TOTAL: ${total}\n`);

  // ─── Batch insert helper ──────────────────────────
  async function batchInsert<T>(
    label: string,
    rows: T[],
    fn: (batch: T[]) => Promise<unknown>,
  ) {
    console.log(`Inserting ${label} (${rows.length} rows)...`);
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await fn(batch);
      const done = Math.min(i + BATCH, rows.length);
      if (done % 1000 === 0 || done === rows.length) {
        console.log(`  ${label}: ${done}/${rows.length}`);
      }
    }
  }

  // ─── Insert in order (FKs) ────────────────────────
  await batchInsert("Users", userRows, (batch) =>
    prisma.user.createMany({ data: batch }),
  );

  await batchInsert("Companies", companyRows, (batch) =>
    prisma.company.createMany({ data: batch }),
  );

  await batchInsert("Members", memberRows, (batch) =>
    prisma.companyMember.createMany({ data: batch }),
  );

  await batchInsert("Devices", deviceRows, (batch) =>
    prisma.biometricDevice.createMany({ data: batch }),
  );

  await batchInsert("Attendance", attendanceRows, (batch) =>
    prisma.attendance.createMany({ data: batch }),
  );

  await batchInsert("ClockEvents", clockEventRows, (batch) =>
    prisma.clockEvent.createMany({ data: batch }),
  );

  await prisma.$disconnect();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== Seeding complete! ${total} records in ${elapsed}s ===`);
}

main().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
