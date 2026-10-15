import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as approveDevice } from "@/app/api/v1/offline-devices/[id]/approve/route";
import { POST as revokeDevice } from "@/app/api/v1/offline-devices/[id]/revoke/route";
import { generateToken } from "@/lib/auth";
import { issueOfflineSyncDeviceToken } from "@/lib/offline-device-auth";
import prisma from "@/lib/prisma";

function request(url: string, token: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
}

test("offline device revoke and re-approve are idempotent under concurrent replay", async () => {
  const user = await prisma.user.findFirst({ where: { role: "super_admin", isActive: true } });
  assert.ok(user, "An active superadmin is required");
  const marker = `offline-device-control-${Date.now()}`;
  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  try {
    await issueOfflineSyncDeviceToken({ userId: user.id, deviceId: marker, platform: "test" });
    const device = await prisma.offlineSyncDevice.findUnique({
      where: { unique_offline_sync_user_device: { userId: user.id, deviceId: marker } },
    });
    assert.ok(device?.approvedAt && !device.revokedAt);

    const revokeUrl = `http://localhost/api/v1/offline-devices/${device.id}/revoke`;
    const [revokeA, revokeB] = await Promise.all([
      revokeDevice(request(revokeUrl, token), { params: { id: device.id } }),
      revokeDevice(request(revokeUrl, token), { params: { id: device.id } }),
    ]);
    assert.equal(revokeA.status, 200);
    assert.equal(revokeB.status, 200);
    const revoked = await prisma.offlineSyncDevice.findUnique({ where: { id: device.id } });
    assert.ok(revoked?.revokedAt);

    const approveUrl = `http://localhost/api/v1/offline-devices/${device.id}/approve`;
    const [approveA, approveB] = await Promise.all([
      approveDevice(request(approveUrl, token), { params: { id: device.id } }),
      approveDevice(request(approveUrl, token), { params: { id: device.id } }),
    ]);
    assert.equal(approveA.status, 200);
    assert.equal(approveB.status, 200);
    const approved = await prisma.offlineSyncDevice.findUnique({ where: { id: device.id } });
    assert.ok(approved?.approvedAt && !approved.revokedAt);
  } finally {
    await prisma.offlineSyncDevice.deleteMany({ where: { userId: user.id, deviceId: marker } });
  }
});
