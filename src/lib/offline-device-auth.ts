import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { JWTPayload } from "@/lib/auth";
import prisma from "@/lib/prisma";

const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueOfflineSyncDeviceToken(input: {
  userId: number;
  deviceId: string;
  platform: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_MS);
  await prisma.offlineSyncDevice.upsert({
    where: {
      unique_offline_sync_user_device: {
        userId: input.userId,
        deviceId: input.deviceId,
      },
    },
    create: {
      userId: input.userId,
      deviceId: input.deviceId,
      platform: input.platform,
      tokenHash: hashDeviceToken(token),
      expiresAt,
    },
    update: {
      platform: input.platform,
      tokenHash: hashDeviceToken(token),
      expiresAt,
      // Deliberately not cleared: re-issuing on every login must not undo an admin
      // revocation. A revoked device stays revoked until it is re-provisioned.
    },
  });
  return { token, expiresAt };
}

export async function authenticateOfflineSyncDevice(request: NextRequest): Promise<JWTPayload | null> {
  const token = request.headers.get("x-offline-device-token")?.trim();
  if (!token) return null;
  const device = await prisma.offlineSyncDevice.findUnique({
    where: { tokenHash: hashDeviceToken(token) },
    include: { user: { include: { city: true } } },
  });
  if (!device || device.revokedAt || device.expiresAt <= new Date() || !device.user.isActive) return null;
  await prisma.offlineSyncDevice.update({
    where: { id: device.id },
    data: { lastUsedAt: new Date() },
  });
  return {
    userId: device.user.id,
    username: device.user.username,
    role: device.user.role,
    cityId: device.user.cityId,
    countryId: device.user.city?.countryId ?? null,
  };
}

export async function revokeOfflineSyncDeviceToken(token: string): Promise<void> {
  await prisma.offlineSyncDevice.updateMany({
    where: { tokenHash: hashDeviceToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
