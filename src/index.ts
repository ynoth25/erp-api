import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from "aws-lambda";
import { authorize, getCorsHeaders, type AuthResult } from "./lib/auth";
import { getPrisma } from "./lib/prisma";
import { queryDsql } from "./lib/aurora-dsql";

// Docs
import { getOpenApiSpec } from "./docs/openapi";
import { getSwaggerHtml } from "./docs/swagger-html";

// Routes
import {
  signUp, confirmSignUp, resendConfirmation, signIn,
  refreshToken, forgotPassword, confirmForgotPassword, changePassword,
} from "./routes/cognito-auth";
import { registerUser, getProfile, updateProfile } from "./routes/users";
import { createCompany, getCompany, updateCompany, listUserCompanies, joinByCode, regenerateCode } from "./routes/companies";
import { listMembers, getMember, updateMember, approveMember, resolveMember, VALID_ROLES, VALID_MEMBER_TYPES, VALID_MEMBER_STATUSES } from "./routes/members";
import { clockIn, clockOut, getAttendance, getDailyDashboard, getClockEvents, VALID_EVENT_TYPES, VALID_SOURCES } from "./routes/attendance";
import { registerDevice, listDevices, updateDevice, authenticateDevice, resolveMemberByEmployeeId, VALID_DEVICE_TYPES } from "./routes/devices";
import {
  createRecordsRequest, listRecordsRequests, getRecordsRequest,
  updateRecordsRequest, deleteRecordsRequest, getRecordsStats,
  parseGoogleFormPayload, VALID_STATUSES as VALID_RR_STATUSES,
} from "./routes/records-requests";
import {
  adminListUsers, adminGetUser, adminUpdateUser,
  adminListCompanies, adminAddUserToCompany,
  requirePlatformAdmin, requireCompanyAdminOrPlatformAdmin,
  AdminForbiddenError,
} from "./routes/admin";


/**
 * Lambda handler — Function URL / HTTP API (payload 2.0).
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? "/";
  const cors = getCorsHeaders(event);

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  // ─── API Docs (no auth) ────────────────────────────
  if (path === "/docs" && method === "GET") {
    const proto = event.headers?.["x-forwarded-proto"] ?? "https";
    const host = event.headers?.["host"] ?? "";
    const baseUrl = host ? `${proto}://${host}` : "";
    const html = getSwaggerHtml(`${baseUrl}/docs/openapi.json`);
    return { statusCode: 200, headers: { "content-type": "text/html", ...cors }, body: html };
  }
  if (path === "/docs/openapi.json" && method === "GET") {
    const proto = event.headers?.["x-forwarded-proto"] ?? "https";
    const host = event.headers?.["host"] ?? "";
    const baseUrl = host ? `${proto}://${host}` : "";
    const spec = getOpenApiSpec(baseUrl);
    return { statusCode: 200, headers: { "content-type": "application/json", ...cors }, body: JSON.stringify(spec) };
  }

  // ─── Google Form webhook (API key auth) ──────────────
  if (path === "/webhook/google-form" && method === "POST") {
    return handleGoogleFormWebhook(event, cors);
  }

  // ─── Biometric device webhook (device-key auth) ─────
  if (path === "/webhook/biometric" && method === "POST") {
    return handleBiometricWebhook(event, cors);
  }

  // ─── Public auth routes (no token required) ────────
  if (path.startsWith("/auth/") && method === "POST") {
    const publicAuthResult = await handlePublicAuth(path, parseBody(event), event, cors);
    if (publicAuthResult) return publicAuthResult;
  }

  // ─── Auth check ─────────────────────────────────────
  const auth = await authorize(event);
  if (!auth.authorized) {
    return json(401, { error: "Unauthorized", message: auth.error }, cors);
  }

  try {
    return await route(method, path, event, cors, auth);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof AdminForbiddenError) {
      return json(403, { error: "Forbidden", message: err.message }, cors);
    }
    console.error("Handler error:", err);
    return json(500, {
      error: "Internal Server Error",
      message: err instanceof Error ? err.message : String(err),
    }, cors);
  }
}

// ═══════════════════════════════════════════════════════════
// ROUTE DISPATCHER
// ═══════════════════════════════════════════════════════════

async function route(
  method: string,
  path: string,
  event: APIGatewayProxyEventV2,
  cors: Record<string, string>,
  auth: AuthResult
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event);
  const qs = event.queryStringParameters ?? {};

  // ─── Health ─────────────────────────────────────────
  if (path === "/" || path === "/health") {
    return json(200, { ok: true, service: "erp-api", version: "2.0" }, cors);
  }
  if (path === "/health/db") {
    const prisma = await getPrisma();
    const prismaResult = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW()`;
    const dsqlResult = await queryDsql<{ now: Date }>("SELECT NOW()");
    return json(200, {
      ok: true,
      prisma: { connected: true, now: prismaResult[0]?.now },
      dsql: { connected: true, now: dsqlResult.rows[0]?.now },
    }, cors);
  }

  // ─── Auth / User ────────────────────────────────────
  if (path === "/auth/register" && method === "POST") {
    if (!auth.user) return json(400, { error: "Cognito token required to register" }, cors);
    if (!body?.firstName || !body?.lastName) {
      return json(400, { error: "firstName and lastName are required" }, cors);
    }
    return json(201, await registerUser(auth.user, body as { firstName: string; lastName: string; phone?: string }), cors);
  }

  if (path === "/auth/me" && method === "GET") {
    if (!auth.user) return json(200, { authMethod: auth.authMethod, user: null }, cors);
    const profile = await getProfile(auth.user.sub);
    return json(200, { authMethod: auth.authMethod, user: profile }, cors);
  }

  if (path === "/auth/me" && method === "PUT") {
    if (!auth.user) return json(401, { error: "Cognito token required" }, cors);
    const updated = await updateProfile(auth.user.sub, body ?? {});
    return json(200, updated, cors);
  }

  // ─── Companies ──────────────────────────────────────
  if (path === "/companies" && method === "POST") {
    const userId = await resolveUserId(auth);
    if (!userId) return json(400, { error: "Register first (POST /auth/register)" }, cors);
    if (!body?.name) return json(400, { error: "name is required" }, cors);
    return json(201, await createCompany(userId, body as { name: string; address?: string; timezone?: string }), cors);
  }

  if (path === "/companies" && method === "GET") {
    const userId = await resolveUserId(auth);
    if (!userId) return json(200, [], cors);
    return json(200, await listUserCompanies(userId), cors);
  }

  if (path === "/companies/join" && method === "POST") {
    const userId = await resolveUserId(auth);
    if (!userId) return json(400, { error: "Register first (POST /auth/register)" }, cors);
    if (!body?.code) return json(400, { error: "code is required" }, cors);
    const result = await joinByCode(userId, body.code as string, body as Record<string, string>);
    if ("error" in result && !("company" in result)) return json(400, result, cors);
    return json(200, result, cors);
  }

  // /companies/:companyId
  const companyMatch = path.match(/^\/companies\/([^/]+)$/);
  if (companyMatch) {
    const companyId = companyMatch[1];
    if (method === "GET") {
      const company = await getCompany(companyId);
      return company ? json(200, company, cors) : json(404, { error: "Company not found" }, cors);
    }
    if (method === "PUT") {
      await requireRole(auth, companyId, ["OWNER", "ADMIN"]);
      return json(200, await updateCompany(companyId, body ?? {}), cors);
    }
  }

  // /companies/:companyId/regenerate-code
  const regenMatch = path.match(/^\/companies\/([^/]+)\/regenerate-code$/);
  if (regenMatch && method === "POST") {
    const companyId = regenMatch[1];
    await requireRole(auth, companyId, ["OWNER", "ADMIN"]);
    return json(200, await regenerateCode(companyId), cors);
  }

  // ─── Members ────────────────────────────────────────
  // /companies/:companyId/members
  const membersMatch = path.match(/^\/companies\/([^/]+)\/members$/);
  if (membersMatch) {
    const companyId = membersMatch[1];
    if (method === "GET") {
      return json(200, await listMembers(companyId, {
        status: qs.status,
        role: qs.role,
        memberType: qs.memberType,
        search: qs.search,
      }), cors);
    }
  }

  // /companies/:companyId/members/:memberId
  const memberMatch = path.match(/^\/companies\/([^/]+)\/members\/([^/]+)$/);
  if (memberMatch) {
    const [, , memberId] = memberMatch;
    if (method === "GET") {
      const member = await getMember(memberId);
      return member ? json(200, member, cors) : json(404, { error: "Member not found" }, cors);
    }
    if (method === "PUT") {
      const companyId = memberMatch[1];
      await requireRole(auth, companyId, ["OWNER", "ADMIN", "MANAGER"]);
      if (body?.role && !VALID_ROLES.includes(body.role as typeof VALID_ROLES[number])) {
        return json(400, { error: `role must be: ${VALID_ROLES.join(", ")}` }, cors);
      }
      if (body?.status && !VALID_MEMBER_STATUSES.includes(body.status as typeof VALID_MEMBER_STATUSES[number])) {
        return json(400, { error: `status must be: ${VALID_MEMBER_STATUSES.join(", ")}` }, cors);
      }
      return json(200, await updateMember(memberId, body ?? {}), cors);
    }
  }

  // /companies/:companyId/members/:memberId/approve
  const approveMatch = path.match(/^\/companies\/([^/]+)\/members\/([^/]+)\/approve$/);
  if (approveMatch && method === "POST") {
    const companyId = approveMatch[1];
    await requireRole(auth, companyId, ["OWNER", "ADMIN", "MANAGER"]);
    return json(200, await approveMember(approveMatch[2]), cors);
  }

  // ─── Attendance / DTR ───────────────────────────────
  // /companies/:companyId/clock-in
  const clockInMatch = path.match(/^\/companies\/([^/]+)\/clock-in$/);
  if (clockInMatch && method === "POST") {
    const companyId = clockInMatch[1];
    const memberId = await resolveCurrentMemberId(auth, companyId);
    if (!memberId) return json(403, { error: "Not a member of this company" }, cors);
    const result = await clockIn({
      companyId,
      memberId,
      source: (body?.source as string) ?? "WEB",
      locationLat: body?.locationLat as number | undefined,
      locationLng: body?.locationLng as number | undefined,
      photoUrl: body?.photoUrl as string | undefined,
      remarks: body?.remarks as string | undefined,
    });
    if ("error" in result && !("attendance" in result)) return json(400, result, cors);
    return json(200, result, cors);
  }

  // /companies/:companyId/clock-out
  const clockOutMatch = path.match(/^\/companies\/([^/]+)\/clock-out$/);
  if (clockOutMatch && method === "POST") {
    const companyId = clockOutMatch[1];
    const memberId = await resolveCurrentMemberId(auth, companyId);
    if (!memberId) return json(403, { error: "Not a member of this company" }, cors);
    const result = await clockOut({
      companyId,
      memberId,
      source: (body?.source as string) ?? "WEB",
      locationLat: body?.locationLat as number | undefined,
      locationLng: body?.locationLng as number | undefined,
      photoUrl: body?.photoUrl as string | undefined,
      remarks: body?.remarks as string | undefined,
    });
    if ("error" in result && !("attendance" in result)) return json(400, result, cors);
    return json(200, result, cors);
  }

  // /companies/:companyId/attendance
  const attendanceMatch = path.match(/^\/companies\/([^/]+)\/attendance$/);
  if (attendanceMatch && method === "GET") {
    return json(200, await getAttendance(attendanceMatch[1], {
      memberId: qs.memberId,
      from: qs.from,
      to: qs.to,
      status: qs.status,
    }), cors);
  }

  // /companies/:companyId/attendance/daily?date=YYYY-MM-DD
  const dailyMatch = path.match(/^\/companies\/([^/]+)\/attendance\/daily$/);
  if (dailyMatch && method === "GET") {
    if (!qs.date) return json(400, { error: "date query param required (YYYY-MM-DD)" }, cors);
    return json(200, await getDailyDashboard(dailyMatch[1], qs.date), cors);
  }

  // /companies/:companyId/clock-events
  const eventsMatch = path.match(/^\/companies\/([^/]+)\/clock-events$/);
  if (eventsMatch && method === "GET") {
    return json(200, await getClockEvents(eventsMatch[1], {
      memberId: qs.memberId,
      date: qs.date,
      attendanceId: qs.attendanceId,
    }), cors);
  }

  // ─── Biometric Devices ─────────────────────────────
  // /companies/:companyId/devices
  const devicesMatch = path.match(/^\/companies\/([^/]+)\/devices$/);
  if (devicesMatch) {
    const companyId = devicesMatch[1];
    if (method === "GET") {
      return json(200, await listDevices(companyId), cors);
    }
    if (method === "POST") {
      await requireRole(auth, companyId, ["OWNER", "ADMIN"]);
      if (!body?.name || !body?.deviceType) {
        return json(400, { error: "name and deviceType are required" }, cors);
      }
      if (!VALID_DEVICE_TYPES.includes(body.deviceType as typeof VALID_DEVICE_TYPES[number])) {
        return json(400, { error: `deviceType must be: ${VALID_DEVICE_TYPES.join(", ")}` }, cors);
      }
      const device = await registerDevice(companyId, body as {
        name: string; deviceType: string; serialNumber?: string; location?: string;
      });
      return json(201, device, cors);
    }
  }

  // /companies/:companyId/devices/:deviceId
  const deviceMatch = path.match(/^\/companies\/([^/]+)\/devices\/([^/]+)$/);
  if (deviceMatch && method === "PUT") {
    const companyId = deviceMatch[1];
    await requireRole(auth, companyId, ["OWNER", "ADMIN"]);
    return json(200, await updateDevice(deviceMatch[2], body ?? {}), cors);
  }

  // ─── Records Requests ─────────────────────────────────
  // /companies/:companyId/records-requests
  const rrListMatch = path.match(/^\/companies\/([^/]+)\/records-requests$/);
  if (rrListMatch) {
    const companyId = rrListMatch[1];
    if (method === "GET") {
      return json(200, await listRecordsRequests(companyId, {
        status: qs.status, source: qs.source, search: qs.search,
        from: qs.from, to: qs.to, page: qs.page, limit: qs.limit,
      }), cors);
    }
    if (method === "POST") {
      if (!body?.studentName || !body?.requestTypes) {
        return json(400, { error: "studentName and requestTypes are required" }, cors);
      }
      return json(201, await createRecordsRequest(companyId, body as {
        studentName: string; requestTypes: string;
        lrn?: string; gender?: string; lastSchoolYear?: string;
        gradeSection?: string; major?: string; adviser?: string;
        contactNo?: string; requestorName?: string; otherRequest?: string;
        source?: string; remarks?: string;
      }), cors);
    }
  }

  // /companies/:companyId/records-requests/stats
  const rrStatsMatch = path.match(/^\/companies\/([^/]+)\/records-requests\/stats$/);
  if (rrStatsMatch && method === "GET") {
    return json(200, await getRecordsStats(rrStatsMatch[1]), cors);
  }

  // /companies/:companyId/records-requests/:id
  const rrMatch = path.match(/^\/companies\/([^/]+)\/records-requests\/([^/]+)$/);
  if (rrMatch) {
    const requestId = rrMatch[2];
    if (method === "GET") {
      const rr = await getRecordsRequest(requestId);
      return rr ? json(200, rr, cors) : json(404, { error: "Records request not found" }, cors);
    }
    if (method === "PUT") {
      if (body?.status && !VALID_RR_STATUSES.includes(body.status as typeof VALID_RR_STATUSES[number])) {
        return json(400, { error: `status must be: ${VALID_RR_STATUSES.join(", ")}` }, cors);
      }
      return json(200, await updateRecordsRequest(requestId, body ?? {}), cors);
    }
    if (method === "DELETE") {
      await requireRole(auth, rrMatch[1], ["OWNER", "ADMIN"]);
      return json(200, await deleteRecordsRequest(requestId), cors);
    }
  }

  // ─── Admin: Platform Users ───────────────────────────
  if (path === "/admin/users" && method === "GET") {
    requirePlatformAdmin(auth);
    return json(200, await adminListUsers(qs), cors);
  }

  const adminUserMatch = path.match(/^\/admin\/users\/([^/]+)$/);
  if (adminUserMatch) {
    const targetUserId = adminUserMatch[1];
    if (method === "GET") {
      requirePlatformAdmin(auth);
      const user = await adminGetUser(targetUserId);
      return user ? json(200, user, cors) : json(404, { error: "User not found" }, cors);
    }
    if (method === "PUT") {
      requirePlatformAdmin(auth);
      const updated = await adminUpdateUser(targetUserId, body ?? {});
      return json(200, updated, cors);
    }
  }

  // ─── Admin: Platform Companies ─────────────────────
  if (path === "/admin/companies" && method === "GET") {
    requirePlatformAdmin(auth);
    return json(200, await adminListCompanies(qs), cors);
  }

  // ─── Admin: Add User to Company ────────────────────
  const adminAddMemberMatch = path.match(/^\/admin\/companies\/([^/]+)\/add-user$/);
  if (adminAddMemberMatch && method === "POST") {
    const companyId = adminAddMemberMatch[1];
    await requireCompanyAdminOrPlatformAdmin(auth, companyId);
    if (!body?.email || !body?.firstName || !body?.lastName) {
      return json(400, { error: "email, firstName, and lastName are required" }, cors);
    }
    if (body?.role && !VALID_ROLES.includes(body.role as typeof VALID_ROLES[number])) {
      return json(400, { error: `role must be: ${VALID_ROLES.join(", ")}` }, cors);
    }
    const result = await adminAddUserToCompany(companyId, body as {
      email: string; firstName: string; lastName: string;
      phone?: string; role?: string; memberType?: string;
      employeeId?: string; department?: string; position?: string;
    });
    if ("error" in result && !("member" in result) && !("user" in result)) {
      return json(400, result, cors);
    }
    return json(201, result, cors);
  }

  return json(404, { error: "Not Found", path, method }, cors);
}

// ═══════════════════════════════════════════════════════════
// GOOGLE FORM WEBHOOK
// ═══════════════════════════════════════════════════════════

async function handleGoogleFormWebhook(
  event: APIGatewayProxyEventV2,
  cors: Record<string, string>
): Promise<APIGatewayProxyResultV2> {
  const requestKey = event.headers?.["x-api-key"] ?? "";
  if (!requestKey) return json(401, { error: "x-api-key header required" }, cors);

  const apiKeysEnv = process.env.API_KEYS ?? "";
  const validKeys = apiKeysEnv.split(",").map((k) => k.trim()).filter(Boolean);
  if (!validKeys.includes(requestKey)) {
    return json(401, { error: "Invalid API key" }, cors);
  }

  const body = parseBody(event);
  if (!body?.companyId) {
    return json(400, { error: "companyId is required" }, cors);
  }

  const parsed = parseGoogleFormPayload(body);
  if (!parsed) {
    return json(400, { error: "studentName is required in form data" }, cors);
  }

  const record = await createRecordsRequest(body.companyId as string, {
    ...parsed,
    source: "GOOGLE_FORM",
  });

  return json(201, record, cors);
}

// ═══════════════════════════════════════════════════════════
// PUBLIC AUTH HANDLER (no token required)
// ═══════════════════════════════════════════════════════════

async function handlePublicAuth(
  path: string,
  body: Record<string, unknown> | null,
  event: APIGatewayProxyEventV2,
  cors: Record<string, string>
): Promise<APIGatewayProxyResultV2 | null> {
  try {
    if (path === "/auth/signup") {
      if (!body?.email || !body?.password || !body?.firstName || !body?.lastName) {
        return json(400, { error: "email, password, firstName, and lastName are required" }, cors);
      }
      const result = await signUp(body as { email: string; password: string; firstName: string; lastName: string; phone?: string });
      return json(201, result, cors);
    }

    if (path === "/auth/confirm") {
      if (!body?.email || !body?.code) {
        return json(400, { error: "email and code are required" }, cors);
      }
      return json(200, await confirmSignUp(body as { email: string; code: string }), cors);
    }

    if (path === "/auth/resend-code") {
      if (!body?.email) return json(400, { error: "email is required" }, cors);
      return json(200, await resendConfirmation(body as { email: string }), cors);
    }

    if (path === "/auth/login") {
      if (!body?.email || !body?.password) {
        return json(400, { error: "email and password are required" }, cors);
      }
      const result = await signIn(body as { email: string; password: string; firstName?: string; lastName?: string });
      return json(200, result, cors);
    }

    if (path === "/auth/refresh") {
      if (!body?.refreshToken) return json(400, { error: "refreshToken is required" }, cors);
      return json(200, await refreshToken(body as { refreshToken: string }), cors);
    }

    if (path === "/auth/forgot-password") {
      if (!body?.email) return json(400, { error: "email is required" }, cors);
      return json(200, await forgotPassword(body as { email: string }), cors);
    }

    if (path === "/auth/confirm-forgot-password") {
      if (!body?.email || !body?.code || !body?.newPassword) {
        return json(400, { error: "email, code, and newPassword are required" }, cors);
      }
      return json(200, await confirmForgotPassword(body as { email: string; code: string; newPassword: string }), cors);
    }

    if (path === "/auth/change-password") {
      const authHeader = event.headers?.["authorization"] ?? "";
      if (!authHeader.startsWith("Bearer ")) {
        return json(401, { error: "Bearer token required" }, cors);
      }
      if (!body?.previousPassword || !body?.newPassword) {
        return json(400, { error: "previousPassword and newPassword are required" }, cors);
      }
      return json(200, await changePassword({
        accessToken: authHeader.slice(7),
        previousPassword: body.previousPassword as string,
        newPassword: body.newPassword as string,
      }), cors);
    }

    return null;
  } catch (err: any) {
    const code = err.name === "UsernameExistsException" ? 409
      : err.name === "UserNotConfirmedException" ? 403
      : err.name === "NotAuthorizedException" ? 401
      : err.name === "CodeMismatchException" ? 400
      : err.name === "ExpiredCodeException" ? 400
      : err.name === "InvalidPasswordException" ? 400
      : err.name === "TooManyRequestsException" ? 429
      : err.name === "LimitExceededException" ? 429
      : err.name === "UserNotFoundException" ? 404
      : 500;

    return json(code, {
      error: err.name ?? "AuthError",
      message: err.message ?? String(err),
    }, cors);
  }
}

// ═══════════════════════════════════════════════════════════
// BIOMETRIC DEVICE WEBHOOK
// ═══════════════════════════════════════════════════════════

async function handleBiometricWebhook(
  event: APIGatewayProxyEventV2,
  cors: Record<string, string>
): Promise<APIGatewayProxyResultV2> {
  const deviceKey = event.headers?.["x-device-key"] ?? "";
  if (!deviceKey) return json(401, { error: "x-device-key header required" }, cors);

  const device = await authenticateDevice(deviceKey);
  if (!device) return json(401, { error: "Invalid device key" }, cors);

  const body = parseBody(event);
  if (!body?.employeeId || !body?.eventType) {
    return json(400, { error: "employeeId and eventType are required" }, cors);
  }

  if (!VALID_EVENT_TYPES.includes(body.eventType as typeof VALID_EVENT_TYPES[number])) {
    return json(400, { error: `eventType must be: ${VALID_EVENT_TYPES.join(", ")}` }, cors);
  }

  const member = await resolveMemberByEmployeeId(device.companyId, body.employeeId as string);
  if (!member) {
    return json(404, { error: `No active member with employeeId: ${body.employeeId}` }, cors);
  }

  const params = {
    companyId: device.companyId,
    memberId: member.id,
    source: "BIOMETRIC" as const,
    deviceId: device.id,
    remarks: body.remarks as string | undefined,
  };

  let result;
  if (body.eventType === "CLOCK_IN") {
    result = await clockIn(params);
  } else if (body.eventType === "CLOCK_OUT") {
    result = await clockOut(params);
  } else {
    return json(400, { error: "Only CLOCK_IN and CLOCK_OUT supported via device webhook" }, cors);
  }

  if ("error" in result && !("attendance" in result)) return json(400, result, cors);
  return json(200, result, cors);
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

async function resolveUserId(auth: AuthResult): Promise<string | null> {
  if (!auth.user) return null;
  const prisma = await getPrisma();
  const user = await prisma.user.findFirst({ where: { cognitoSub: auth.user.sub } });
  return user?.id ?? null;
}

async function resolveCurrentMemberId(auth: AuthResult, companyId: string): Promise<string | null> {
  const userId = await resolveUserId(auth);
  if (!userId) return null;
  const member = await resolveMember(companyId, userId);
  return member?.id ?? null;
}

class ForbiddenError extends Error {}

async function requireRole(auth: AuthResult, companyId: string, roles: string[]) {
  const userId = await resolveUserId(auth);
  if (!userId) throw new ForbiddenError("Not registered");
  const member = await resolveMember(companyId, userId);
  if (!member || !roles.includes(member.role)) {
    throw new ForbiddenError(`Requires role: ${roles.join(" or ")}`);
  }
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function json(
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}
