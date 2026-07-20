import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPaymentModuleDetail,
  formatSuperAdminPaymentDetail,
  formatPakistanCityPaymentDetail,
  getPakistanPaymentAccountSelectValue,
  parsePakistanPaymentAccountSelectValue,
  buildPakistanPaymentAccountOptions,
  buildPaymentSubmitPayload,
  sanitizePaymentSubmitPayload,
  validatePakistanPaymentForm,
} from "@/lib/payment-module-detail";

test("formatPakistanCityPaymentDetail formats online payment to super admin account", () => {
  assert.equal(
    formatPakistanCityPaymentDetail({
      paymentMethod: "online",
      destination: "haji",
      superAdminBankAccount: { bankName: "mzn", accountNumber: "4002" },
    }),
    "mzn-4002 online",
  );
});

test("formatPakistanCityPaymentDetail formats bank transfer to city treasury", () => {
  assert.equal(
    formatPakistanCityPaymentDetail({
      paymentMethod: "bank_transfer",
      destination: "our_account",
      bankAccount: { bankName: "mzn", accountNumber: "4002" },
    }),
    "mzn-4002 transfer",
  );
});

test("parsePakistanPaymentAccountSelectValue maps city and super admin accounts", () => {
  assert.deepEqual(parsePakistanPaymentAccountSelectValue("city-5"), {
    destination: "our_account",
    bankAccountId: 5,
    superAdminBankAccountId: 0,
  });
  assert.deepEqual(parsePakistanPaymentAccountSelectValue("super-9"), {
    destination: "haji",
    bankAccountId: 0,
    superAdminBankAccountId: 9,
  });
});

test("getPakistanPaymentAccountSelectValue encodes selected account", () => {
  assert.equal(getPakistanPaymentAccountSelectValue({ bankAccountId: 5 }), "city-5");
  assert.equal(getPakistanPaymentAccountSelectValue({ superAdminBankAccountId: 9 }), "super-9");
});

test("buildPakistanPaymentAccountOptions lists PKR city and super admin accounts", () => {
  const currencies = [{ id: 1, code: "PKR" }, { id: 2, code: "USD" }];
  const options = buildPakistanPaymentAccountOptions({
    paymentCurrencyId: 1,
    currencies,
    cityBankAccounts: [{ id: 3, isActive: true, bankName: "mzn", accountNumber: "4002" }],
    superAdminBankAccounts: [
      { id: 4, isActive: true, bankName: "malik mzn", accountNumber: "8235", currencyId: 1, currency: { code: "PKR", id: 1 } },
      { id: 5, isActive: true, bankName: "usd acct", accountNumber: "9999", currencyId: 2, currency: { code: "USD", id: 2 } },
    ],
  });
  assert.equal(options.length, 2);
  assert.equal(options[0].key, "city-3");
  assert.equal(options[0].label, "mzn-4002");
  assert.equal(options[1].key, "super-4");
});

test("buildPakistanPaymentAccountOptions hides accounts for non-PKR payment currency", () => {
  const currencies = [{ id: 1, code: "PKR" }, { id: 2, code: "USD" }];
  const options = buildPakistanPaymentAccountOptions({
    paymentCurrencyId: 2,
    currencies,
    cityBankAccounts: [{ id: 3, isActive: true, bankName: "mzn", accountNumber: "4002" }],
    superAdminBankAccounts: [{ id: 4, isActive: true, bankName: "malik mzn", accountNumber: "8235", currencyId: 1 }],
  });
  assert.equal(options.length, 0);
});

test("formatPaymentModuleDetail formats online payment with bank and ref", () => {
  assert.equal(
    formatPaymentModuleDetail({
      paymentMethod: "online",
      destination: "haji",
      manualVoucherNo: "4564",
      superAdminBankAccount: { bankName: "malik mzn", accountNumber: "8235" },
    }),
    "malik mzn-8235 Online (4564)",
  );
});

test("formatPaymentModuleDetail formats cash to office", () => {
  assert.equal(
    formatPaymentModuleDetail({
      paymentMethod: "cash",
      destination: "our_account",
    }),
    "cash to office",
  );
});

test("formatSuperAdminPaymentDetail formats account and method", () => {
  assert.equal(
    formatSuperAdminPaymentDetail({
      paymentMethod: "bank_transfer",
      superAdminBankAccount: { bankName: "Meezan", accountNumber: "4002" },
    }),
    "meezan (4002)-bank transfer",
  );
});

test("payment submit payload omits placeholder zero bank account ids", () => {
  assert.deepEqual(
    sanitizePaymentSubmitPayload({
      customerId: 1,
      amount: 100,
      bankAccountId: 0,
      superAdminBankAccountId: 0,
    }),
    { customerId: 1, amount: 100 },
  );

  const payload = buildPaymentSubmitPayload(
    {
      customerId: 1,
      amount: 100,
      paymentMethod: "cash",
      destination: "our_account",
      bankAccountId: 0,
      superAdminBankAccountId: 0,
    },
    { currencyId: 1 },
  );
  assert.equal("bankAccountId" in payload, false);
  assert.equal("superAdminBankAccountId" in payload, false);
});

test("Pakistan receive payment validation allows signed return amounts but rejects zero", () => {
  assert.equal(validatePakistanPaymentForm({ customerId: 1, amount: -9000, paymentMethod: "cash" }), null);
  assert.equal(
    validatePakistanPaymentForm({ customerId: 1, amount: 0, paymentMethod: "cash" }),
    "Customer and non-zero amount are required",
  );
});
