# E2E Verifier — Extended reference

## Example: haji transfer bug (regression pattern)

**Symptom:** Transfer visible in haji list but missing from super admin account ledger.

**Trace that catches it:**

1. UI sets `superAdminDestinationAccountId` in form state.
2. Submit handler builds body with the field.
3. Submit handler runs `delete body.superAdminDestinationAccountId` → **break**.
4. API `resolvePakistanDestinationAccount()` receives nothing → no FK saved.
5. `transferredTo` label still saved → looks correct in UI detail column.
6. Ledger queries `WHERE superAdminBankAccountId = :id` → empty.

**Lesson:** Always grep submit handlers for `delete body.*` after adding new API fields.

---

## Pakistan payment detail formats

| Context | Helper | Example output |
|---------|--------|----------------|
| City payments module | `formatPaymentModuleDetail` | `malik mzn-8235 Online (4564)` |
| Super admin haji payments | `formatSuperAdminPaymentDetail` | `meezan (4002)-bank transfer` |
| Customer ledger payment row | `formatCustomerLedgerPaymentDetail` | `cash-office (879)` |
| Haji transfer auto detail | `buildHajiTransferAutoDetail` | `Cash from Office → Meezan (4002)` |

Detail strings are **display** — verification must also confirm IDs/FKs.

---

## Schema columns (common ledger links)

| Entity | Link columns |
|--------|----------------|
| Payment | `bankAccountId`, `superAdminBankAccountId`, `destination`, `paymentMethod`, `chequeStatus` |
| HajiTransfer | `bankAccountId`, `superAdminBankAccountId`, `superAdminCashAccountId`, `settlementDestination`, `chequePaymentId` |
| LotCost | `superAdminBankAccountId`, `bankAccountId`, `intermediaryId` |
| SupplierPayment | `superAdminBankAccountId`, `superAdminCashAccountId`, `bankAccountId` |

---

## Running balance semantics

| View | Function | Incoming increases balance? |
|------|----------|----------------------------|
| City treasury / payments list | `computeRunningBalances` + `getCombinedItemNetDelta` | Credits to office only |
| Super admin haji payments | `computeSuperAdminRunningBalances` + `getSuperAdminHajiIncomingDelta` | Payments to haji + haji transfers |

---

## Pre-ship checklist (finance PRs)

- [ ] Every new form field appears in submit body (not deleted)
- [ ] API persists field to Prisma
- [ ] Migration if new column
- [ ] Ledger/combined route reads same column
- [ ] All source-type branches checked (not just happy path)
- [ ] Unit test added for pure helpers when format/calc logic changed
- [ ] Verifier report attached or run in separate chat
