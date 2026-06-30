import test from "node:test";
import assert from "node:assert/strict";
import { formatSuperAdminBankLabel } from "@/lib/haji-transfer-detail";
import { PAKISTAN_HAJI_TARGET } from "@/lib/pakistan-haji-destination";

test("formatSuperAdminBankLabel formats bank name and account", () => {
  assert.equal(
    formatSuperAdminBankLabel({ bankName: "Meezan", accountNumber: "4002" }),
    "Meezan (4002)",
  );
});

test("PAKISTAN_HAJI_TARGET is generic fallback label", () => {
  assert.equal(PAKISTAN_HAJI_TARGET, "Super Admin Account");
});
