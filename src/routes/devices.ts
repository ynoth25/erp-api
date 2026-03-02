/**
 * Biometric device management and webhook endpoint.
 *
 * Devices authenticate via `x-device-key` header (their unique apiKey).
 * The biometric webhook receives clock events from physical hardware.
 */
import { randomBytes } from "crypto";
import { getPrisma } from "../lib/prisma";

export const VALID_DEVICE_TYPES = [
  "FINGERPRINT", "FACIAL_RECOGNITION", "IRIS", "RFID",
] as const;

export type DeviceType = (typeof VALID_DEVICE_TYPES)[number];

// ─── Device CRUD ────────────────────────────────────────

export async function registerDevice(companyId: string, data: {
  name: string;
  serialNumber?: string;
  deviceType: string;
  location?: string;
  metadata?: string;
}) {
  const prisma = await getPrisma();
  const apiKey = `dev_${randomBytes(24).toString("hex")}`;

  return prisma.biometricDevice.create({
    data: {
      companyId,
      name: data.name,
      serialNumber: data.serialNumber,
      deviceType: data.deviceType,
      location: data.location,
      metadata: data.metadata,
      apiKey,
    },
  });
}

export async function listDevices(companyId: string) {
  const prisma = await getPrisma();
  return prisma.biometricDevice.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
  });
}

export async function getDevice(deviceId: string) {
  const prisma = await getPrisma();
  return prisma.biometricDevice.findUnique({ where: { id: deviceId } });
}

export async function updateDevice(deviceId: string, data: {
  name?: string;
  location?: string;
  isActive?: boolean;
  metadata?: string;
}) {
  const prisma = await getPrisma();
  return prisma.biometricDevice.update({ where: { id: deviceId }, data });
}

// ─── Device authentication ──────────────────────────────

/**
 * Authenticate a device by its x-device-key header.
 * Returns the device record or null if invalid.
 */
export async function authenticateDevice(apiKey: string) {
  const prisma = await getPrisma();
  const device = await prisma.biometricDevice.findFirst({
    where: { apiKey, isActive: true },
  });
  if (!device) return null;

  // Update heartbeat
  await prisma.biometricDevice.update({
    where: { id: device.id },
    data: { lastHeartbeat: new Date() },
  });

  return device;
}

/**
 * Resolve a company member by their employeeId within the device's company.
 * This is how biometric scanners map a badge/fingerprint ID to a member.
 */
export async function resolveMemberByEmployeeId(companyId: string, employeeId: string) {
  const prisma = await getPrisma();
  return prisma.companyMember.findFirst({
    where: { companyId, employeeId, status: "ACTIVE" },
  });
}
