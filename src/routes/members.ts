/**
 * Company member management — list, add, update role/status, remove.
 */
import { getPrisma } from "../lib/prisma";

export const VALID_ROLES = ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const;
export const VALID_MEMBER_TYPES = ["EMPLOYEE", "STUDENT", "CONTRACTOR"] as const;
export const VALID_MEMBER_STATUSES = ["ACTIVE", "PENDING", "INACTIVE", "SUSPENDED"] as const;

export type MemberRole = (typeof VALID_ROLES)[number];
export type MemberType = (typeof VALID_MEMBER_TYPES)[number];
export type MemberStatus = (typeof VALID_MEMBER_STATUSES)[number];

export async function listMembers(companyId: string, filters?: {
  status?: string;
  role?: string;
  memberType?: string;
  search?: string;
}) {
  const prisma = await getPrisma();

  const where: Record<string, unknown> = { companyId };
  if (filters?.status) where.status = filters.status;
  if (filters?.role) where.role = filters.role;
  if (filters?.memberType) where.memberType = filters.memberType;
  if (filters?.search) {
    where.OR = [
      { employeeId: { contains: filters.search, mode: "insensitive" } },
      { department: { contains: filters.search, mode: "insensitive" } },
      { position: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const members = await prisma.companyMember.findMany({
    where,
    orderBy: { joinedAt: "desc" },
  });

  // Hydrate with user info
  const userIds = members.map((m) => m.userId);
  const users = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } } })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return members.map((m) => ({
    ...m,
    user: userMap.get(m.userId) ?? null,
  }));
}

export async function getMember(memberId: string) {
  const prisma = await getPrisma();
  const member = await prisma.companyMember.findUnique({ where: { id: memberId } });
  if (!member) return null;

  const user = await prisma.user.findFirst({ where: { id: member.userId } });
  return { ...member, user };
}

export async function updateMember(memberId: string, data: {
  role?: string;
  memberType?: string;
  employeeId?: string;
  department?: string;
  position?: string;
  status?: string;
}) {
  const prisma = await getPrisma();
  return prisma.companyMember.update({ where: { id: memberId }, data });
}

/**
 * Approve a pending membership (set status to ACTIVE).
 */
export async function approveMember(memberId: string) {
  const prisma = await getPrisma();
  return prisma.companyMember.update({
    where: { id: memberId },
    data: { status: "ACTIVE" },
  });
}

/**
 * Resolve a user's member record within a company by their userId.
 */
export async function resolveMember(companyId: string, userId: string) {
  const prisma = await getPrisma();
  return prisma.companyMember.findFirst({
    where: { companyId, userId, status: "ACTIVE" },
  });
}
