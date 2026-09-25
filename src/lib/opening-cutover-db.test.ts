import assert from "node:assert/strict";
import test from "node:test";

import prisma from "@/lib/prisma";
import { journalOpeningParticipantBalance } from "@/lib/accounting";
import { loadParticipantBalance } from "@/lib/investor-participant-actions";

test("opening cutover journals capital and retained profit separately and rolls test data back", async () => {
  const before = await Promise.all([prisma.openingCutover.count(), prisma.openingParticipantBalance.count()]);
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.investmentParticipant.updateMany({ data: { isActive: false } });
      const participant = await tx.investmentParticipant.create({
        data: { name: "CUTOVER DB TEST MANAGER", type: "manager", createdBy: null },
      });
      const cutover = await tx.openingCutover.create({
        data: {
          revision: 999_999,
          status: "draft",
          cutoverDate: new Date("2026-09-23"),
          fiscalYearStart: new Date("2026-02-19"),
          fiscalYearEnd: new Date("2027-02-08"),
          backupReference: "rollback-only-test.dump",
          backupAcknowledged: true,
          createdBy: 1,
        },
      });
      const opening = await tx.openingParticipantBalance.create({
        data: {
          cutoverId: cutover.id,
          participantId: participant.id,
          capitalPkr: 10_000_000,
          currentYearProfitPkr: 1_200_000,
          ongoingLotRealizedProfitPkr: 300_000,
          openingDate: new Date("2026-09-23"),
          createdBy: 1,
        },
      });
      await journalOpeningParticipantBalance({
        id: opening.id,
        participantId: participant.id,
        participantName: participant.name,
        capitalPkr: 10_000_000,
        currentYearProfitPkr: 1_200_000,
        ongoingLotRealizedProfitPkr: 300_000,
        openingDate: opening.openingDate,
        createdBy: 1,
        journalVersion: 1,
      }, tx);
      const journal = await tx.journalEntry.findMany({
        where: { transactionId: `OPENPART-${opening.id}-V1` },
        include: { account: { select: { accountType: true } } },
      });
      assert.equal(journal.reduce((sum, row) => sum + Number(row.debit), 0), 11_500_000);
      assert.equal(journal.reduce((sum, row) => sum + Number(row.credit), 0), 11_500_000);
      assert.equal(journal.filter((row) => row.account.accountType === "equity").reduce((sum, row) => sum + Number(row.credit), 0), 11_500_000);
      assert.equal(journal.filter((row) => row.account.accountType === "liability").reduce((sum, row) => sum + Number(row.credit), 0), 0);
      assert.equal(journal.filter((row) => Number(row.credit) > 0).length, 3);

      await tx.investmentCapitalEvent.create({
        data: { participantId: participant.id, eventType: "opening", amountPkr: 10_000_000, effectiveDate: opening.openingDate, sourceType: "opening_cutover_finalization", sourceId: cutover.id, createdBy: 1 },
      });
      await tx.openingCutover.update({ where: { id: cutover.id }, data: { status: "finalized", finalizedBy: 1, finalizedAt: new Date() } });
      const balance = await loadParticipantBalance(participant.id, tx);
      assert.equal(balance.currentParticipatingCapitalPkr, 10_000_000);
      assert.equal(balance.currentAvailableProfitPkr, 1_500_000);
      throw new Error("ROLLBACK_OPENING_CUTOVER_TEST");
    }),
    /ROLLBACK_OPENING_CUTOVER_TEST/,
  );
  const after = await Promise.all([prisma.openingCutover.count(), prisma.openingParticipantBalance.count()]);
  assert.deepEqual(after, before);
});
