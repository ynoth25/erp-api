import { getPrisma } from "../lib/prisma";

export const VALID_REQUEST_TYPES = [
  "SF10", "ENROLMENT_CERT", "DIPLOMA", "CAV", "ENG_INST", "CERT_OF_GRAD", "OTHERS",
] as const;

export const VALID_STATUSES = [
  "PENDING", "PROCESSING", "READY", "RELEASED", "REJECTED",
] as const;

export const VALID_SOURCES = ["GOOGLE_FORM", "WEB", "WALK_IN"] as const;

// ─── Create ──────────────────────────────────────────────

export async function createRecordsRequest(
  companyId: string,
  data: {
    lrn?: string;
    studentName: string;
    gender?: string;
    lastSchoolYear?: string;
    gradeSection?: string;
    major?: string;
    adviser?: string;
    contactNo?: string;
    requestorName?: string;
    requestTypes: string;
    otherRequest?: string;
    source?: string;
    remarks?: string;
  }
) {
  const prisma = await getPrisma();
  return prisma.recordsRequest.create({
    data: {
      companyId,
      lrn: data.lrn,
      studentName: data.studentName,
      gender: data.gender,
      lastSchoolYear: data.lastSchoolYear,
      gradeSection: data.gradeSection,
      major: data.major,
      adviser: data.adviser,
      contactNo: data.contactNo,
      requestorName: data.requestorName,
      requestTypes: data.requestTypes,
      otherRequest: data.otherRequest,
      source: data.source ?? "WEB",
      remarks: data.remarks,
    },
  });
}

// ─── List with filters ───────────────────────────────────

export async function listRecordsRequests(
  companyId: string,
  filters?: {
    status?: string;
    source?: string;
    search?: string;
    from?: string;
    to?: string;
    page?: string;
    limit?: string;
  }
) {
  const prisma = await getPrisma();
  const take = Math.min(parseInt(filters?.limit ?? "50", 10) || 50, 200);
  const skip = ((parseInt(filters?.page ?? "1", 10) || 1) - 1) * take;

  const where: Record<string, unknown> = { companyId };

  if (filters?.status) where.status = filters.status;
  if (filters?.source) where.source = filters.source;

  if (filters?.search) {
    where.OR = [
      { studentName: { contains: filters.search, mode: "insensitive" } },
      { lrn: { contains: filters.search, mode: "insensitive" } },
      { requestorName: { contains: filters.search, mode: "insensitive" } },
      { gradeSection: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  if (filters?.from || filters?.to) {
    const dateFilter: Record<string, Date> = {};
    if (filters.from) dateFilter.gte = new Date(filters.from);
    if (filters.to) dateFilter.lte = new Date(filters.to + "T23:59:59.999Z");
    where.submittedAt = dateFilter;
  }

  const [requests, total] = await Promise.all([
    prisma.recordsRequest.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      take,
      skip,
    }),
    prisma.recordsRequest.count({ where }),
  ]);

  return { requests, total, page: Math.floor(skip / take) + 1, limit: take };
}

// ─── Get single ──────────────────────────────────────────

export async function getRecordsRequest(id: string) {
  const prisma = await getPrisma();
  return prisma.recordsRequest.findUnique({ where: { id } });
}

// ─── Update (status, remarks, processedBy) ───────────────

export async function updateRecordsRequest(
  id: string,
  data: {
    status?: string;
    remarks?: string;
    processedBy?: string;
  }
) {
  const prisma = await getPrisma();

  const updateData: Record<string, unknown> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.remarks !== undefined) updateData.remarks = data.remarks;
  if (data.processedBy !== undefined) updateData.processedBy = data.processedBy;

  if (data.status === "PROCESSING" || data.status === "READY") {
    updateData.processedAt = new Date();
  }
  if (data.status === "RELEASED") {
    updateData.releasedAt = new Date();
  }

  return prisma.recordsRequest.update({ where: { id }, data: updateData });
}

// ─── Delete ──────────────────────────────────────────────

export async function deleteRecordsRequest(id: string) {
  const prisma = await getPrisma();
  await prisma.recordsRequest.delete({ where: { id } });
  return { deleted: true };
}

// ─── Stats / Dashboard ───────────────────────────────────

export async function getRecordsStats(companyId: string) {
  const prisma = await getPrisma();

  const [pending, processing, ready, released, rejected, total] = await Promise.all([
    prisma.recordsRequest.count({ where: { companyId, status: "PENDING" } }),
    prisma.recordsRequest.count({ where: { companyId, status: "PROCESSING" } }),
    prisma.recordsRequest.count({ where: { companyId, status: "READY" } }),
    prisma.recordsRequest.count({ where: { companyId, status: "RELEASED" } }),
    prisma.recordsRequest.count({ where: { companyId, status: "REJECTED" } }),
    prisma.recordsRequest.count({ where: { companyId } }),
  ]);

  return { total, pending, processing, ready, released, rejected };
}

// ─── Google Form webhook payload parser ──────────────────

export function parseGoogleFormPayload(body: Record<string, unknown>): {
  studentName: string;
  lrn?: string;
  gender?: string;
  lastSchoolYear?: string;
  gradeSection?: string;
  major?: string;
  adviser?: string;
  contactNo?: string;
  requestorName?: string;
  requestTypes: string;
  otherRequest?: string;
} | null {
  const name = (body.studentName ?? body.student_name ?? body["Name of Student"] ?? body["NAME OF STUDENT"]) as string | undefined;
  if (!name) return null;

  const rawTypes = body.requestTypes ?? body.request_types ?? body["Request For"] ?? body["REQUEST FOR"];
  let requestTypes: string;

  if (Array.isArray(rawTypes)) {
    requestTypes = rawTypes.join(",");
  } else if (typeof rawTypes === "string") {
    requestTypes = rawTypes;
  } else {
    requestTypes = "OTHERS";
  }

  return {
    studentName: name,
    lrn: str(body.lrn ?? body.LRN),
    gender: str(body.gender ?? body.Gender),
    lastSchoolYear: str(body.lastSchoolYear ?? body.last_school_year ?? body["Last School Year Attended"]),
    gradeSection: str(body.gradeSection ?? body.grade_section ?? body["Grade/Section"]),
    major: str(body.major ?? body.Major),
    adviser: str(body.adviser ?? body.Adviser),
    contactNo: str(body.contactNo ?? body.contact_no ?? body["Contact No"]),
    requestorName: str(body.requestorName ?? body.requestor_name ?? body["Name of Person Requesting"]),
    requestTypes,
    otherRequest: str(body.otherRequest ?? body.other_request ?? body["Others"]),
  };
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}
