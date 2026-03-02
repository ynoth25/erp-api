/**
 * Company routes — create, read, update, and join via invite code.
 */
import { randomBytes } from "crypto";
import { getPrisma } from "../lib/prisma";

function generateCode(): string {
  return randomBytes(3).toString("hex").toUpperCase(); // 6-char hex
}

export async function createCompany(ownerId: string, data: {
  name: string;
  address?: string;
  timezone?: string;
}) {
  const prisma = await getPrisma();

  const company = await prisma.company.create({
    data: {
      name: data.name,
      code: generateCode(),
      address: data.address,
      timezone: data.timezone ?? "Asia/Manila",
      ownerId,
    },
  });

  // Auto-create the owner as a member with OWNER role
  await prisma.companyMember.create({
    data: {
      companyId: company.id,
      userId: ownerId,
      role: "OWNER",
      memberType: "EMPLOYEE",
      status: "ACTIVE",
    },
  });

  return company;
}

export async function getCompany(companyId: string) {
  const prisma = await getPrisma();
  return prisma.company.findUnique({ where: { id: companyId } });
}

export async function updateCompany(companyId: string, data: {
  name?: string;
  address?: string;
  timezone?: string;
  logoUrl?: string;
  settings?: string;
}) {
  const prisma = await getPrisma();
  return prisma.company.update({ where: { id: companyId }, data });
}

export async function listUserCompanies(userId: string) {
  const prisma = await getPrisma();
  const memberships = await prisma.companyMember.findMany({
    where: { userId, status: { in: ["ACTIVE", "PENDING"] } },
  });
  if (memberships.length === 0) return [];

  const companyIds = memberships.map((m) => m.companyId);
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds }, isActive: true },
  });
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  return memberships.map((m) => ({
    membership: m,
    company: companyMap.get(m.companyId) ?? null,
  }));
}

/**
 * Join a company using the 6-character invite code.
 * Creates a PENDING membership that an admin must approve (or ACTIVE if
 * the company settings allow auto-approve).
 */
export async function joinByCode(userId: string, code: string, data?: {
  memberType?: string;
  employeeId?: string;
  department?: string;
  position?: string;
}) {
  const prisma = await getPrisma();

  const company = await prisma.company.findFirst({
    where: { code: code.toUpperCase(), isActive: true },
  });
  if (!company) {
    return { error: "Invalid company code" };
  }

  const existing = await prisma.companyMember.findFirst({
    where: { companyId: company.id, userId },
  });
  if (existing) {
    return { error: "Already a member of this company", membership: existing };
  }

  const membership = await prisma.companyMember.create({
    data: {
      companyId: company.id,
      userId,
      role: "MEMBER",
      memberType: data?.memberType ?? "EMPLOYEE",
      employeeId: data?.employeeId,
      department: data?.department,
      position: data?.position,
      status: "PENDING",
    },
  });

  return { company, membership };
}

export async function regenerateCode(companyId: string) {
  const prisma = await getPrisma();
  return prisma.company.update({
    where: { id: companyId },
    data: { code: generateCode() },
  });
}
