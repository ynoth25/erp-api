/**
 * Admin routes — platform-level and company-level admin operations.
 *
 * Platform admins (User.isAdmin=true) can manage all companies and users.
 * Company admins (OWNER/ADMIN role) can manage their own company's users.
 *
 * When an admin adds a user, the system:
 *   1. Creates the user in Cognito (AdminCreateUser)
 *   2. Creates the User record in the database
 *   3. Creates the CompanyMember record
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { getPrisma } from "../lib/prisma";
import type { AuthResult } from "../lib/auth";

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION ?? "ap-northeast-1",
});

function getUserPoolId(): string {
  const id = process.env.COGNITO_USER_POOL_ID;
  if (!id) throw new Error("COGNITO_USER_POOL_ID not configured");
  return id;
}

// ─── Platform Admin: Users ──────────────────────────────────

export async function adminListUsers(filters?: {
  search?: string;
  isAdmin?: string;
  isActive?: string;
  page?: string;
  limit?: string;
}) {
  const prisma = await getPrisma();
  const take = Math.min(parseInt(filters?.limit ?? "50", 10) || 50, 200);
  const skip = ((parseInt(filters?.page ?? "1", 10) || 1) - 1) * take;

  const where: Record<string, unknown> = {};
  if (filters?.isAdmin === "true") where.isAdmin = true;
  if (filters?.isAdmin === "false") where.isAdmin = false;
  if (filters?.isActive === "true") where.isActive = true;
  if (filters?.isActive === "false") where.isActive = false;
  if (filters?.search) {
    where.OR = [
      { email: { contains: filters.search, mode: "insensitive" } },
      { firstName: { contains: filters.search, mode: "insensitive" } },
      { lastName: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
    prisma.user.count({ where }),
  ]);

  return { users, total, page: Math.floor(skip / take) + 1, limit: take };
}

export async function adminGetUser(userId: string) {
  const prisma = await getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const memberships = await prisma.companyMember.findMany({
    where: { userId: user.id },
  });
  const companyIds = memberships.map((m) => m.companyId);
  const companies = companyIds.length > 0
    ? await prisma.company.findMany({ where: { id: { in: companyIds } } })
    : [];
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  return {
    ...user,
    memberships: memberships.map((m) => ({
      ...m,
      company: companyMap.get(m.companyId) ?? null,
    })),
  };
}

export async function adminUpdateUser(userId: string, data: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  isAdmin?: boolean;
  isActive?: boolean;
}) {
  const prisma = await getPrisma();
  return prisma.user.update({ where: { id: userId }, data });
}

// ─── Platform Admin: Companies ──────────────────────────────

export async function adminListCompanies(filters?: {
  search?: string;
  isActive?: string;
  page?: string;
  limit?: string;
}) {
  const prisma = await getPrisma();
  const take = Math.min(parseInt(filters?.limit ?? "50", 10) || 50, 200);
  const skip = ((parseInt(filters?.page ?? "1", 10) || 1) - 1) * take;

  const where: Record<string, unknown> = {};
  if (filters?.isActive === "true") where.isActive = true;
  if (filters?.isActive === "false") where.isActive = false;
  if (filters?.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { code: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const [companies, total] = await Promise.all([
    prisma.company.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
    prisma.company.count({ where }),
  ]);

  return { companies, total, page: Math.floor(skip / take) + 1, limit: take };
}

// ─── Add User to Company (with Cognito auto-creation) ───────

export async function adminAddUserToCompany(
  companyId: string,
  data: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role?: string;
    memberType?: string;
    employeeId?: string;
    department?: string;
    position?: string;
  }
) {
  const prisma = await getPrisma();

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: "Company not found" };

  let cognitoSub: string;

  // Check if Cognito user already exists
  try {
    const existing = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: getUserPoolId(),
        Username: data.email,
      })
    );
    cognitoSub = existing.UserAttributes?.find((a) => a.Name === "sub")?.Value ?? "";
  } catch (err: any) {
    if (err.name === "UserNotFoundException") {
      // Create the Cognito user — they'll receive a temp password via email
      const result = await cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: getUserPoolId(),
          Username: data.email,
          UserAttributes: [
            { Name: "email", Value: data.email },
            { Name: "email_verified", Value: "true" },
            { Name: "given_name", Value: data.firstName },
            { Name: "family_name", Value: data.lastName },
          ],
          DesiredDeliveryMediums: ["EMAIL"],
        })
      );
      cognitoSub = result.User?.Attributes?.find((a) => a.Name === "sub")?.Value ?? "";
    } else {
      throw err;
    }
  }

  if (!cognitoSub) {
    return { error: "Failed to resolve Cognito sub" };
  }

  // Find or create the DB user
  let dbUser = await prisma.user.findFirst({ where: { cognitoSub } });
  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        cognitoSub,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
      },
    });
  }

  // Check existing membership
  const existingMember = await prisma.companyMember.findFirst({
    where: { companyId, userId: dbUser.id },
  });
  if (existingMember) {
    return { error: "User is already a member of this company", member: existingMember, user: dbUser };
  }

  const member = await prisma.companyMember.create({
    data: {
      companyId,
      userId: dbUser.id,
      role: data.role ?? "MEMBER",
      memberType: data.memberType ?? "EMPLOYEE",
      employeeId: data.employeeId,
      department: data.department,
      position: data.position,
      status: "ACTIVE",
    },
  });

  return { user: dbUser, member, cognitoCreated: true };
}

// ─── Auth guard helpers ─────────────────────────────────────

export function requirePlatformAdmin(auth: AuthResult) {
  if (!auth.isAdmin) {
    throw new AdminForbiddenError("Platform admin access required");
  }
}

export async function requireCompanyAdminOrPlatformAdmin(
  auth: AuthResult,
  companyId: string,
): Promise<void> {
  if (auth.isAdmin) return;

  if (!auth.userId) throw new AdminForbiddenError("Not registered");
  const prisma = await getPrisma();
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId: auth.userId, status: "ACTIVE" },
  });
  if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
    throw new AdminForbiddenError("Company OWNER or ADMIN role required");
  }
}

export class AdminForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminForbiddenError";
  }
}
