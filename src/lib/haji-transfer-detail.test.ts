import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHajiTransferAutoDetail,
  buildCityHajiTransferDetail,
  formatSuperAdminBankLabel,
  getHajiTransferFromLabel,
  getHajiTransferDetailLine,
  getCityHajiTransferListDetail,
  getHajiTransferDestinationShortName,
} from "@/lib/haji-transfer-detail";

test("formatSuperAdminBankLabel formats bank name and account", () => {
  assert.equal(
    formatSuperAdminBankLabel({ bankName: "malik mzn", accountNumber: "8235" }),
    "malik mzn (8235)",
  );
});

test("buildHajiTransferAutoDetail includes source and destination", () => {
  assert.equal(
    buildHajiTransferAutoDetail({
      sourceType: "cash_office",
      transferredTo: "malik mzn (8235)",
    }),
    "Cash from Office → malik mzn (8235)",
  );
});

test("getHajiTransferFromLabel uses customer name for cheques and direct payments", () => {
  assert.equal(
    getHajiTransferFromLabel({ recordType: "customer_payment", transferredTo: "Ali" }),
    "Ali",
  );
  assert.equal(
    getHajiTransferFromLabel({ sourceType: "mixed_cash_cheque", chequeCustomerName: "Khan" }),
    "Khan",
  );
  assert.equal(getHajiTransferFromLabel({ sourceType: "cash_office" }), "Direct");
});

test("getHajiTransferDetailLine strips auto source prefix and appends ref", () => {
  assert.equal(
    getHajiTransferDetailLine({
      detail: "Cash from Office → Meezan (4002)",
      referenceNo: "452",
    }),
    "Meezan (4002) (452)",
  );
  assert.equal(
    getHajiTransferDetailLine({ detail: "test chq transfer fix" }),
    "test chq transfer fix",
  );
});

test("getHajiTransferDestinationShortName uses bankName-accountNumber", () => {
  assert.equal(
    getHajiTransferDestinationShortName(null, { bankName: "mzn", accountNumber: "4002" }),
    "mzn-4002",
  );
  assert.equal(getHajiTransferDestinationShortName("mzn (4002)"), "mzn-4002");
  assert.equal(getHajiTransferDestinationShortName("malik mzn (8235)"), "malik mzn-8235");
  assert.equal(getHajiTransferDestinationShortName("Khan Haji"), "Khan Haji");
});

test("getCityHajiTransferListDetail formats PK/AFG city list detail", () => {
  assert.equal(
    getCityHajiTransferListDetail({
      sourceType: "cheque",
      destinationAccount: { bankName: "mzn", accountNumber: "4002" },
    }),
    "mzn-4002 transfer",
  );
  assert.equal(
    getCityHajiTransferListDetail({
      sourceType: "cheque",
      transferredTo: "HBL (hbl-043)",
    }),
    "HBL-hbl-043 transfer",
  );
  assert.equal(
    getCityHajiTransferListDetail({
      sourceType: "mixed_cash_cheque",
      transferredTo: "mzn (4002)",
    }),
    "mzn-4002 transfer",
  );
  assert.equal(
    getCityHajiTransferListDetail({
      sourceType: "bank_transfer",
      transferredTo: "malik mzn (8325)",
    }),
    "malik mzn-8325 online",
  );
  assert.equal(
    getCityHajiTransferListDetail({
      sourceType: "cash_office",
      destinationAccount: { bankName: "mzn", accountNumber: "4002" },
    }),
    "mzn-4002 transfer",
  );
});

test("buildCityHajiTransferDetail matches list detail for create payload", () => {
  assert.equal(
    buildCityHajiTransferDetail({
      sourceType: "bank_transfer",
      destinationAccount: { bankName: "malik mzn", accountNumber: "8325" },
    }),
    "malik mzn-8325 online",
  );
});
