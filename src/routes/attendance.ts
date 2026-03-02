/**
 * Attendance & clock event routes.
 *
 * Core flow:
 *   1. Member (or device on behalf of member) sends clock-in/out
 *   2. A ClockEvent is created (granular audit trail)
 *   3. The Attendance record for that day is upserted and totals recomputed
 *
 * EventType: CLOCK_IN | CLOCK_OUT | BREAK_START | BREAK_END
 * Source: BIOMETRIC | FACIAL | MANUAL | WEB | MOBILE
 * AttendanceStatus: PRESENT | ABSENT | LATE | HALF_DAY | ON_LEAVE
 */
import { getPrisma } from "../lib/prisma";

export const VALID_EVENT_TYPES = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as const;
export const VALID_SOURCES = ["BIOMETRIC", "FACIAL", "MANUAL", "WEB", "MOBILE"] as const;
export const VALID_ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "HALF_DAY", "ON_LEAVE"] as const;

export type EventType = (typeof VALID_EVENT_TYPES)[number];
export type ClockSource = (typeof VALID_SOURCES)[number];

// ─── Clock In ───────────────────────────────────────────

export async function clockIn(params: {
  companyId: string;
  memberId: string;
  source: string;
  deviceId?: string;
  locationLat?: number;
  locationLng?: number;
  photoUrl?: string;
  remarks?: string;
}) {
  const prisma = await getPrisma();
  const now = new Date();
  const today = startOfDay(now);

  // Check if already clocked in today (has CLOCK_IN without a matching CLOCK_OUT)
  const lastEvent = await prisma.clockEvent.findFirst({
    where: {
      companyId: params.companyId,
      memberId: params.memberId,
      timestamp: { gte: today },
    },
    orderBy: { timestamp: "desc" },
  });

  if (lastEvent?.eventType === "CLOCK_IN") {
    return { error: "Already clocked in. Clock out first.", event: lastEvent };
  }

  const event = await prisma.clockEvent.create({
    data: {
      companyId: params.companyId,
      memberId: params.memberId,
      eventType: "CLOCK_IN",
      timestamp: now,
      source: params.source,
      deviceId: params.deviceId,
      locationLat: params.locationLat,
      locationLng: params.locationLng,
      photoUrl: params.photoUrl,
      remarks: params.remarks,
    },
  });

  const attendance = await upsertAttendance(params.companyId, params.memberId, today);
  await prisma.clockEvent.update({
    where: { id: event.id },
    data: { attendanceId: attendance.id },
  });

  return { event, attendance };
}

// ─── Clock Out ──────────────────────────────────────────

export async function clockOut(params: {
  companyId: string;
  memberId: string;
  source: string;
  deviceId?: string;
  locationLat?: number;
  locationLng?: number;
  photoUrl?: string;
  remarks?: string;
}) {
  const prisma = await getPrisma();
  const now = new Date();
  const today = startOfDay(now);

  const lastEvent = await prisma.clockEvent.findFirst({
    where: {
      companyId: params.companyId,
      memberId: params.memberId,
      timestamp: { gte: today },
    },
    orderBy: { timestamp: "desc" },
  });

  if (!lastEvent || lastEvent.eventType !== "CLOCK_IN") {
    return { error: "No active clock-in found for today." };
  }

  const event = await prisma.clockEvent.create({
    data: {
      companyId: params.companyId,
      memberId: params.memberId,
      eventType: "CLOCK_OUT",
      timestamp: now,
      source: params.source,
      deviceId: params.deviceId,
      locationLat: params.locationLat,
      locationLng: params.locationLng,
      photoUrl: params.photoUrl,
      remarks: params.remarks,
    },
  });

  const attendance = await upsertAttendance(params.companyId, params.memberId, today);
  await prisma.clockEvent.update({
    where: { id: event.id },
    data: { attendanceId: attendance.id },
  });

  return { event, attendance };
}

// ─── Attendance queries ─────────────────────────────────

export async function getAttendance(companyId: string, filters: {
  memberId?: string;
  from?: string;
  to?: string;
  status?: string;
}) {
  const prisma = await getPrisma();

  const where: Record<string, unknown> = { companyId };
  if (filters.memberId) where.memberId = filters.memberId;
  if (filters.status) where.status = filters.status;

  const dateFilter: Record<string, Date> = {};
  if (filters.from) dateFilter.gte = startOfDay(new Date(filters.from));
  if (filters.to) dateFilter.lte = endOfDay(new Date(filters.to));
  if (Object.keys(dateFilter).length > 0) where.date = dateFilter;

  return prisma.attendance.findMany({
    where,
    orderBy: [{ date: "desc" }, { memberId: "asc" }],
  });
}

export async function getDailyDashboard(companyId: string, date: string) {
  const prisma = await getPrisma();
  const day = startOfDay(new Date(date));
  const dayEnd = endOfDay(new Date(date));

  const attendance = await prisma.attendance.findMany({
    where: { companyId, date: { gte: day, lte: dayEnd } },
    orderBy: { firstClockIn: "asc" },
  });

  // Hydrate with member + user info
  const memberIds = attendance.map((a) => a.memberId);
  const members = memberIds.length > 0
    ? await prisma.companyMember.findMany({ where: { id: { in: memberIds } } })
    : [];
  const userIds = members.map((m) => m.userId);
  const users = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } } })
    : [];

  const memberMap = new Map(members.map((m) => [m.id, m]));
  const userMap = new Map(users.map((u) => [u.id, u]));

  return attendance.map((a) => {
    const member = memberMap.get(a.memberId);
    return {
      ...a,
      member: member ? { ...member, user: userMap.get(member.userId) ?? null } : null,
    };
  });
}

export async function getClockEvents(companyId: string, filters: {
  memberId?: string;
  date?: string;
  attendanceId?: string;
}) {
  const prisma = await getPrisma();

  const where: Record<string, unknown> = { companyId };
  if (filters.memberId) where.memberId = filters.memberId;
  if (filters.attendanceId) where.attendanceId = filters.attendanceId;
  if (filters.date) {
    where.timestamp = {
      gte: startOfDay(new Date(filters.date)),
      lte: endOfDay(new Date(filters.date)),
    };
  }

  return prisma.clockEvent.findMany({
    where,
    orderBy: { timestamp: "desc" },
  });
}

// ─── Internal helpers ───────────────────────────────────

/**
 * Upsert the daily Attendance record and recompute totals from ClockEvents.
 */
async function upsertAttendance(companyId: string, memberId: string, day: Date) {
  const prisma = await getPrisma();
  const dayEnd = endOfDay(day);

  let attendance = await prisma.attendance.findFirst({
    where: { companyId, memberId, date: { gte: day, lte: dayEnd } },
  });

  const events = await prisma.clockEvent.findMany({
    where: {
      companyId,
      memberId,
      timestamp: { gte: day, lte: dayEnd },
    },
    orderBy: { timestamp: "asc" },
  });

  const clockIns = events.filter((e) => e.eventType === "CLOCK_IN");
  const clockOuts = events.filter((e) => e.eventType === "CLOCK_OUT");

  const firstClockIn = clockIns[0]?.timestamp ?? null;
  const lastClockOut = clockOuts[clockOuts.length - 1]?.timestamp ?? null;

  // Compute total minutes from paired CLOCK_IN → CLOCK_OUT sessions
  let totalMinutes = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].eventType === "CLOCK_IN") {
      const matchingOut = events.slice(i + 1).find((e) => e.eventType === "CLOCK_OUT");
      if (matchingOut) {
        totalMinutes += Math.round(
          (matchingOut.timestamp.getTime() - events[i].timestamp.getTime()) / 60000
        );
      }
    }
  }

  const data = {
    firstClockIn,
    lastClockOut,
    totalMinutes: totalMinutes || null,
    status: "PRESENT",
  };

  if (attendance) {
    attendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data,
    });
  } else {
    attendance = await prisma.attendance.create({
      data: {
        companyId,
        memberId,
        date: day,
        ...data,
      },
    });
  }

  return attendance;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(23, 59, 59, 999);
  return out;
}
