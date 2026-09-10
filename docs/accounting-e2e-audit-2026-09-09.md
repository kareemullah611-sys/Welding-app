# Accounting E2E Audit — 2026-09-09

## Scope and environment

- Roles: City Admin (Quetta) and Super Admin
- Currency: PKR
- Isolated database: `welding_app_accounting_e2e_20260909`
- Application data in `welding_app` was not used for the controlled scenario.
- The verifier and executor were the same session; results are therefore reported conservatively.

## Deterministic controlled scenario

| Transaction | Amount / quantity | Expected entry |
| --- | ---: | --- |
| Opening cash | 100,000 | Dr Cash 100,000 / Cr Opening Equity 100,000 |
| Opening bank | 50,000 | Dr Bank 50,000 / Cr Opening Equity 50,000 |
| Opening receivable | 20,000 | Dr Customer AR 20,000 / Cr Opening Equity 20,000 |
| Opening cheque | 10,000 | Dr Cheques in Hand 10,000 / Cr Opening Equity 10,000 |
| Opening supplier payable | 30,000 | Dr Opening Equity 30,000 / Cr Supplier Payable 30,000 |
| Lot purchase | 10 MT; 20 kg/carton; 500 cartons; USD 100 at PKR 280 | Dr Inventory 28,000 / Cr Supplier Payable 28,000 |
| Distribution | Quetta 300; Lahore 200 | Quantity movement only; no P&L |
| Credit sale | 20 cartons × 1,000 = 20,000 | Dr AR 20,000 / Cr Revenue 20,000 |
| Sale COGS | 20 × 56 = 1,120 | Dr COGS 1,120 / Cr Inventory 1,120 |
| Cash receipt | 5,000 | Dr Cash 5,000 / Cr AR 5,000 |
| Bank receipt | 7,000 | Dr Bank 7,000 / Cr AR 7,000 |
| Cheque receipt | 3,000 | Dr Cheques in Hand 3,000 / Cr AR 3,000 |
| Cash expense | 2,000 | Dr Expense 2,000 / Cr Cash 2,000 |

## Final expected versus actual reconciliation

| Balance | System | Expected | Difference |
| --- | ---: | ---: | ---: |
| Cash | 103,000 | 103,000 | 0 |
| City bank | 57,000 | 57,000 | 0 |
| Cheques in hand | 13,000 | 13,000 | 0 |
| Customer receivable | 25,000 | 25,000 | 0 |
| Inventory | 26,880 | 26,880 | 0 |
| Supplier payable | 58,000 | 58,000 | 0 |
| Opening equity | 150,000 | 150,000 | 0 |
| Revenue | 20,000 | 20,000 | 0 |
| COGS | 1,120 | 1,120 | 0 |
| Operating expense | 2,000 | 2,000 | 0 |
| Gross profit | 18,880 | 18,880 | 0 |
| Net profit | 16,880 | 16,880 | 0 |
| Total assets | 224,880 | 224,880 | 0 |
| Total liabilities | 58,000 | 58,000 | 0 |
| Closing equity including current profit | 166,880 | 166,880 | 0 |
| Journal debits | 276,120 | 276,120 | 0 |
| Journal credits | 276,120 | 276,120 | 0 |

Independent equation: `224,880 assets = 58,000 liabilities + 150,000 opening equity + 16,880 current profit`.

## Edit, date, mode, cancel, and delete tests

| Flow | Change | Result |
| --- | --- | --- |
| Customer receipt | 1,000 cash → 1,200 bank; date moved to prior month | PASS |
| Customer receipt | Super Admin permanent delete with password confirmation | PASS; DB row and journal effect removed |
| Expense | 500 cash → 600 bank; date moved to prior month | PASS |
| Expense | City Admin delete | PASS; soft-deleted and reversal journals restored balances |
| Sale | Create one-carton sale, then cancel | PASS; revenue, AR, COGS, inventory all returned to baseline |
| Aggregate accounts | Compare before and after all transient tests | PASS; every account returned exactly to baseline |

Collections did not affect revenue or profit. Internal lot distribution did not create income, expense, profit, or additional inventory value.

## Financial report comparison

The P&L, cash position, receivables, and payables endpoints matched the independent model exactly. The balance-sheet endpoint returned all underlying balances correctly but omitted current-period profit from its equity section.

| Report | Result |
| --- | --- |
| P&L | PASS — revenue 20,000; COGS 1,120; expenses 2,000; net profit 16,880 |
| Cash position | PASS — cash 103,000; bank 57,000; cheques 13,000 |
| Receivables | PASS — 25,000 |
| Payables | PASS — 58,000 |
| Balance sheet presentation | FAIL — current profit 16,880 absent from equity |

## Remaining finance variants

All create/delete or create/reversal pairs below were checked by comparing every non-zero general-ledger account balance before and after the pair. The final isolated-database journal remained balanced at 582,944 debit and 582,944 credit after the persistent liability and participant scenarios.

| Variant | API / DB outcome | Journal / ledger outcome | Result |
| --- | --- | --- | --- |
| Super-admin bank → cash transfer, PKR 10,000 | Transfer and reversal rows persisted | Source/destination account balances returned exactly to baseline; company assets unchanged | PASS |
| Lender liability | Loan received 20,000; payment 5,000; liability effect 15,000 | Bank net increase 15,000; liability closing balance 15,000 | PASS |
| Pakistan Haji — office cash | Create 1,000 and delete | Reversal restored every GL account to baseline | PASS |
| Pakistan Haji — city bank | Create 2,000 and delete | Reversal restored every GL account to baseline | PASS |
| Pakistan Haji — cheque | Cheque claimed, transfer created, then deleted | GL restored; cheque returned to `in_hand` | PASS |
| Pakistan Haji — mixed cash + cheque | One request created two transfer rows; both deleted | GL restored; cheque returned to `in_hand` | PASS |
| Afghanistan Haji — office cash | AFN cash transfer to an AFN super-admin cash destination, then delete | GL restored exactly | PASS |
| Afghanistan Haji — bank / cheque | Both invalid sources rejected with HTTP 400 | No financial mutation | PASS |
| Cheque → bank | Cheque moved `in_hand` → `deposited_to_bank`; deposit deleted | Cheque returned to `in_hand`; GL restored | PASS |
| Cheque → cash | Transfer created and deleted | Cheque returned to `in_hand`; GL restored | PASS |
| Bank → cash | Transfer created and deleted | GL restored exactly | PASS |
| Bank → bank | Paired source/destination rows created and deleted | GL restored exactly | PASS |
| Investor | Initial capital 30,000 + contribution 5,000 | Participation capital 35,000; zero general-journal entries | PASS as participation ledger only |
| Manager | Initial capital 10,000 − withdrawal 2,000 | Participation capital 8,000; zero general-journal entries | PASS as participation ledger only |

Investor/manager capital events currently update the participation ledger only. Cash settlement actions are feature-disabled, so a real treasury-funded contribution/withdrawal flow remains unavailable for E2E execution.

## Bugs

### A-001 — Balance sheet omits current earnings

- Severity: High
- Scenario: Run the balance-sheet report after the controlled scenario.
- Expected: Assets 224,880; liabilities 58,000; equity 166,880.
- Actual: Assets 224,880; liabilities 58,000; equity section 150,000.
- Difference: 16,880, exactly equal to current net profit.
- Likely root cause: `src/app/api/v1/financial-reports/route.ts` groups posted equity accounts but does not add current-period retained earnings/net profit to balance-sheet equity.

### A-002 — Clean migration deployment fails

- Severity: High (deployment/data-recovery risk)
- Scenario: Apply all migrations to a new empty PostgreSQL database.
- Expected: All 66 migrations apply successfully.
- Actual: `P3018`; migration `20260301000000_expense_soft_delete` fails because relation `expenses` does not exist.
- Difference: A clean environment cannot be built from the migration chain.
- Workaround used only for this isolated audit: `prisma db push`, followed by the normal seed.

### A-003 — Browser smoke suite is stale

- Severity: Medium (verification reliability)
- Result: 8/14 pass; 6 fail on obsolete labels/selectors or missing seed prerequisites.
- Examples: tests expect “New Sale” while the dashboard exposes “Sale”; the bank-ledger test assumes a seeded bank account; the dashboard test expects “Welcome,” which is no longer rendered.
- Accounting implication: these failures reduce UI regression confidence but did not invalidate the route/DB/journal reconciliation above.

### A-004 — Super-admin account opening returns HTTP 500

- Severity: High
- Scenario: Create an opening balance with kind `super_admin_account` through the openings API.
- Expected: Opening row and balanced opening journal are created.
- Actual: HTTP 500 before creation.
- Root cause observed: the route calls `openingSuperAdminAccountBalance.findUnique({ where: { accountId } })`, but the generated Prisma client requires `id` or the named compound unique selector `unique_opening_super_admin_account`.
- Audit continuation: the two isolated test openings were inserted directly and posted using the production journal helper. This bypass was limited to the isolated audit database; the API defect remains unfixed.

## Required finance trace table

| Flow | Form | API | DB | Journal | Ledger | Running Balance | Dashboard | Edit | Delete | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Opening cash/bank/AR/cheque/payable | Static UI traced; route executed | PASS | PASS | PASS | PASS | PASS | PASS via reports | Opening behavior covered by unit suite | Opening delete covered by unit suite | PASS |
| Purchase and lot recognition | Static UI traced; route executed | PASS | PASS | PASS | PASS | N/A | PASS via inventory/report | NOT EXECUTED | NOT EXECUTED | PARTIAL |
| City distribution | Static UI traced; route executed | PASS | PASS | No P&L journal expected | Quantity reconciled | N/A | Inventory value unchanged | NOT EXECUTED | NOT EXECUTED | PASS for creation |
| Credit sale | UI control mismatch documented; route executed | PASS | PASS | PASS | PASS | N/A | PASS via reports | Correction route not executed | Cancel PASS | PARTIAL |
| Customer receipts | Static UI traced; route executed | PASS | PASS | PASS | PASS | PASS | PASS via reports | PASS | PASS under Super Admin | PASS |
| Expense | Static UI traced; route executed | PASS | PASS | PASS | PASS | PASS | PASS via reports | PASS | PASS | PASS |
| Supplier payable | Opening + purchase executed | PASS | PASS | PASS | PASS | N/A | PASS via reports | NOT EXECUTED | NOT EXECUTED | PARTIAL |
| Super-admin account opening | Static UI traced; route executed | FAIL (HTTP 500) | FAIL | NOT REACHED through API | NOT REACHED | NOT REACHED | NOT REACHED | NOT EXECUTED | NOT EXECUTED | FAIL — A-004 |
| Investor/manager participation | Static UI traced; routes executed | PASS | PASS | No GL journal by design | Participation capital PASS | N/A | NOT EXECUTED | Contribution/withdrawal PASS | NOT EXECUTED | PASS for participation; treasury settlement unavailable |
| Haji — Pakistan cash/bank/cheque/mixed | Static UI traced; routes executed | PASS | PASS | PASS | PASS | PASS by account reconciliation | NOT EXECUTED | NOT EXECUTED | PASS | PASS |
| Haji — Afghanistan cash; bank/cheque rejection | Static UI traced; routes executed | PASS | PASS | PASS for cash; none for rejects | PASS | PASS by account reconciliation | NOT EXECUTED | NOT EXECUTED | PASS for cash | PASS |
| Super-admin account transfer | Static UI traced; routes executed | PASS | PASS | PASS | PASS | PASS by account reconciliation | Company assets unchanged | Reversal used instead of edit | PASS via reversal | PASS |
| City bank → cash / bank → bank | Static UI traced; routes executed | PASS | PASS | PASS | PASS | PASS by account reconciliation | NOT EXECUTED | NOT EXECUTED | PASS | PASS |
| Liability receipt/payment | Static UI traced; routes executed | PASS | PASS | PASS | PASS — closing 15,000 | PASS — bank +15,000 | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | PASS for create/payment; edit/delete NOT VERIFIED |
| Cheque lifecycle | Static UI traced; routes executed | PASS | PASS | PASS | PASS | PASS by account reconciliation | NOT EXECUTED | NOT EXECUTED | PASS | PASS |

## Tests executed

- Accounting-focused suite: 90/90 passed.
- Repository smoke suite: 244/244 passed.
- Database-backed critical suite: 22/22 passed.
- Desktop Playwright smoke suite: 8/14 passed; 6 stale/prerequisite failures documented above.
- Deterministic route → DB → journal → report scenario: PASS for all executed amounts.
- Transient edit/delete/cancel balance restoration: PASS.
- Remaining variant harness: PASS for Haji cash/bank/cheque/mixed, Afghanistan cash restrictions, cheque-to-bank, cheque-to-cash, bank-to-cash, bank-to-bank, super-admin transfer reversal, and liability receipt/payment.

## Verdict

**DO NOT SHIP as “fully reconciled.”** The controlled scenario and the remaining Haji, cheque, liability, and treasury variants reconcile, including their tested reversals/deletions. Release blockers remain: the balance sheet omits current profit, a clean migration deployment fails, and super-admin account openings return HTTP 500. Investor/manager participation arithmetic passes, but real cash settlement is feature-disabled; liability edit/delete and the stale browser flows remain explicitly not verified.
