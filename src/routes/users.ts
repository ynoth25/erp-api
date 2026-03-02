/**
 * User routes — registration and profile management.
 *
 * After Cognito signup, the client calls POST /auth/register to create the
 * User record in our database. This links the Cognito sub to our data model.
 */
import { getPrisma } from "../lib/prisma";
import type { CognitoUser } from "../lib/cognito";

export async function registerUser(cognitoUser: CognitoUser, data: {
  firstName: string;
  lastName: string;
  phone?: string;
}) {
  const prisma = await getPrisma();

  const existing = await prisma.user.findFirst({
    where: { cognitoSub: cognitoUser.sub },
  });
  if (existing) {
    return { user: existing, created: false };
  }

  const user = await prisma.user.create({
    data: {
      cognitoSub: cognitoUser.sub,
      email: cognitoUser.email ?? cognitoUser.username ?? "",
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
    },
  });

  return { user, created: true };
}

export async function getProfile(cognitoSub: string) {
  const prisma = await getPrisma();

  const user = await prisma.user.findFirst({
    where: { cognitoSub },
  });
  if (!user) return null;

  const memberships = await prisma.companyMember.findMany({
    where: { userId: user.id, status: "ACTIVE" },
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

export async function updateProfile(cognitoSub: string, data: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
}) {
  const prisma = await getPrisma();
  const user = await prisma.user.findFirst({ where: { cognitoSub } });
  if (!user) return null;
  return prisma.user.update({ where: { id: user.id }, data });
}
