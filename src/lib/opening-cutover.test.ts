import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOpeningCutoverReadiness } from "@/lib/opening-cutover";

const readyInput = {
  backupAcknowledged: true,
  backupReference: "backup-2026-09-23.dump",
  cutoverDate: "2026-09-23",
  fiscalYearStart: "2026-02-19",
  fiscalYearEnd: "2027-02-08",
  openingClearingPkr: 0,
  activeParticipantIds: [1, 2],
  participantBalanceIds: [1, 2],
  managerCount: 1,
  totalParticipatingCapitalPkr: 25_000_000,
  missingForeignLayers: [],
  inventoryMismatches: [],
  openingDateMismatches: [],
};

test("opening cutover is ready only after backup, exact reconciliation, participants, inventory, and FX", () => {
  assert.deepEqual(evaluateOpeningCutoverReadiness(readyInput), { ready: true, blockers: [] });
});

test("opening cutover reports every accounting blocker without guessing", () => {
  const result = evaluateOpeningCutoverReadiness({
    ...readyInput,
    backupAcknowledged: false,
    backupReference: "",
    openingClearingPkr: 10,
    participantBalanceIds: [1],
    managerCount: 0,
    missingForeignLayers: ["opening cheque #7 USD"],
    inventoryMismatches: ["Lot 601 / 3.2mm"],
    openingDateMismatches: ["opening cheque #7"],
  });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /backup/i);
  assert.match(result.blockers.join("\n"), /PKR 10/i);
  assert.match(result.blockers.join("\n"), /participant 2/i);
  assert.match(result.blockers.join("\n"), /exactly one manager/i);
  assert.match(result.blockers.join("\n"), /opening cheque #7 USD/i);
  assert.match(result.blockers.join("\n"), /Lot 601 \/ 3.2mm/i);
  assert.match(result.blockers.join("\n"), /opening date outside approved financial year.*opening cheque #7/i);
});

test("cutover date must remain inside the manually approved Ramadan financial year", () => {
  const result = evaluateOpeningCutoverReadiness({ ...readyInput, cutoverDate: "2027-02-09" });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /financial year/i);
});
