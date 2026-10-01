// Owns every database row an E2E run creates, so a run leaves zero residue.
//
// Existing session/audit IDs for the configured E2E users are captured before
// the run. Teardown removes only new rows owned by those users; it never deletes
// unrelated rows by a global timestamp. Business fixtures are removed by seed down.
import fs from "node:fs";
import path from "node:path";

import prisma from "../src/lib/prisma";
import { up as seedUp, down as seedDown } from "./e2e-hard-delete-seed";

const STATE_FILE = path.join(process.cwd(), ".e2e-watermark.json");

type E2EState = {
  testUserIds: number[];
  sessionIds: string[];
  auditLogIds: number[];
};

export async function setupE2EFixtures(): Promise<void> {
  await seedUp();
  const usernames = [
    process.env.E2E_SUPERADMIN_USERNAME || "superadmin",
    process.env.E2E_CITYADMIN_USERNAME || "quetta_admin",
  ];
  const users = await prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true } });
  const testUserIds = users.map((user) => user.id);
  if (testUserIds.length !== new Set(usernames).size) {
    throw new Error(`E2E users are missing: ${usernames.join(", ")}`);
  }
  const [sessions, auditLogs] = await Promise.all([
    prisma.userSession.findMany({ where: { userId: { in: testUserIds } }, select: { id: true } }),
    prisma.auditLog.findMany({ where: { userId: { in: testUserIds } }, select: { id: true } }),
  ]);
  const state: E2EState = {
    testUserIds,
    sessionIds: sessions.map((row) => row.id),
    auditLogIds: auditLogs.map((row) => row.id),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

export async function teardownE2EFixtures(): Promise<void> {
  try {
    await seedDown();
  } finally {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as E2EState;
      await prisma.userSession.deleteMany({
        where: { userId: { in: state.testUserIds }, id: { notIn: state.sessionIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { userId: { in: state.testUserIds }, id: { notIn: state.auditLogIds } },
      });
      fs.rmSync(STATE_FILE, { force: true });
    }
    await prisma.$disconnect();
  }
}

// Row counts that an E2E run must never change. Used to assert zero growth.
export async function e2eResidueSnapshot(): Promise<Record<string, number>> {
  const [sessions, banks, audits, sales, payments, customers, lots, journals, godowns, products, distributions, allocations, syncRequests, carryingLayers, foreignMovements] = await Promise.all([
    prisma.userSession.count(),
    prisma.superAdminBankAccount.count(),
    prisma.auditLog.count(),
    prisma.sale.count(),
    prisma.payment.count(),
    prisma.customer.count(),
    prisma.lot.count(),
    prisma.journalEntry.count(),
    prisma.godown.count(),
    prisma.product.count(),
    prisma.lotCityDistribution.count(),
    prisma.lotCityGodownAllocation.count(),
    prisma.syncRequest.count(),
    prisma.foreignCurrencyCarryingLayer.count(),
    prisma.foreignCurrencyMovement.count(),
  ]);
  return { sessions, banks, audits, sales, payments, customers, lots, journals, godowns, products, distributions, allocations, syncRequests, carryingLayers, foreignMovements };
}
