# Client-Readiness Accounting E2E — 2026-09-26

## Safety boundary

- Databases used: `welding_app_client_readiness_e2e_20260923` and `welding_app_opening_rehearsal_20260926` on local PostgreSQL only.
- Production was not read, written, migrated, seeded, or reconfigured.
- Investor finalization, investor settlement, investor FX settlement, and automatic Sarafi capture stayed disabled.

## Exact reconciliation evidence

- Authoritative PKR revenue: `1,260,825.40`
- Authoritative PKR COGS: `1,027,120.00`
- Gross profit: `233,705.40`
- Realized FX gain: `4,016.45`
- Net profit: `237,721.85`
- Lotwise bridged net profit: `237,721.85`
- Investor-attribution input: `237,721.85`
- Total attributed: `237,721.85`
- Report/lot/attribution difference: `0.00`
- Global journal debits: `19,656,132.15`
- Global journal credits: `19,656,132.15`
- Global journal difference: `0.00`

Manager capital was PKR 15,000,000 and investor capital PKR 10,000,000. The investor's profit split was 50/50:

- Manager own-capital result: `142,633.11`
- Investor capital's gross attributable result: `95,088.74`
- Investor entitlement: `47,544.37`
- Manager share from investor profit: `47,544.37`

## Verified flows

- Dynamic Pakistan/Afghanistan cities, users, godowns, products, supplier, customers, manager and investor.
- USD Pakistan lot recognition at PKR carrying basis; AFN sale recognition through immutable Sarai Shahzada evidence.
- Lot distribution validation, godown assignments, distribution replacement/removal, city-transfer rejection and approval.
- Sale creation and correction of quantity/rate/product/lot, immutable purchase correction journals, late lot-cost create/edit/delete allocation.
- Customer payment create/edit/cancel, online-to-city-bank edit removing linked Haji transfer, paired customer-paid expense create/edit/delete.
- Expense create/edit/delete and withdrawal create/edit/delete without duplicate deduction.
- AFN collection at two dates, exact realized FX gain once, balanced FX journal, immutable AFN sale/payment currency.
- Supplier, shipping, agent, intermediary, superadmin transfer and lot-cost idempotency through the DB-backed critical suite.
- Authenticated browser login and rendering of dashboard, openings, profit report and investors.
- Clean-database opening cash + manager opening capital, readiness difference zero, atomic finalization, snapshot creation and post-finalization lock.

## Defects found and corrected

1. Removing a lot distribution with stale godown assignments caused a FK 500. Replacement now serializes, removes only unused assignments and blocks distributions with movements.
2. Foreign payment currency edits could return 500 or bypass carrying reconstruction. Cross-currency edits now return `FOREIGN_CARRYING_LAYER_REQUIRED` before mutation; reversal/re-entry is required.
3. Foreign sale corrections accepted a conflicting currency field and could return 500. Recognition currency is now immutable and conflicting corrections return HTTP 409.
4. Lotwise profit treated realized FX gain as sale revenue and then bridged FX again. FX is now excluded from lot revenue and bridged once; all lot reconciliation differences are zero.
5. Investor FX readiness ignored immutable sale/payment source evidence and falsely required fallback rows. It now accepts stored rate/reference and carrying-movement evidence while preserving strict missing-rate blocking.

## Remaining blockers

- **Migration bootstrap blocker:** `prisma migrate deploy` against a genuinely empty database fails in the first historical migration because it expects an existing `expenses` table. The current schema can be rehearsed with `prisma db push`, but disaster-recovery migration replay is not production-safe until the migration baseline is repaired.
- **Inter-godown reversal gap:** the current godown-transfer API supports creation but exposes no audited reversal endpoint. Creation stock locking is covered; reversal is not available to verify.
- **Explicit superadmin liability lifecycle:** unit/route safeguards exist, but this run did not complete a dedicated create → partial payments → reversal browser trace for every liability type.
- Production feature flags must remain disabled until migration replay is repaired and those two operational gaps receive a dedicated acceptance run.

## Finance trace table

| Flow | Form | API | DB | Journal | Ledger | Running Balance | Dashboard | Edit | Delete | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PKR sale | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS via controlled cancellation coverage | PASS |
| AFN sale | PASS | PASS | PASS | PASS | PASS | N/A | N/A | PASS, currency immutable | PASS via reversal rules | PASS |
| Customer payment | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Expense | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Withdrawal/Haji | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Lot cost/purchase correction | PASS | PASS | PASS | PASS | PASS | N/A | PASS in inventory/P&L | PASS | PASS via immutable delta | PASS |
| City transfer | PASS | PASS | PASS | N/A stock movement | PASS | N/A | PASS | N/A | PASS reject/approve | PASS |
| Inter-godown transfer | PASS | PASS create | PASS create | N/A stock movement | PASS create | N/A | PASS create | N/A | NOT AVAILABLE | BLOCKED |
| Supplier/shipping/agent/intermediary | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Covered by route tests | Reversal covered where implemented | PASS |
| Superadmin liability | PASS shell | PASS safeguards | NOT FULL E2E | NOT FULL E2E | NOT FULL E2E | N/A | NOT FULL E2E | NOT FULL E2E | NOT FULL E2E | BLOCKED |
| Opening cutover | PASS browser | PASS | PASS | PASS | PASS | N/A | N/A | Locked after finalization | Audited reversal rules tested separately | PASS |
| Financial report → investor attribution | PASS | PASS | PASS | PASS | PASS | N/A | PASS | N/A | N/A | PASS, difference 0 |

## Automated gates

- Smoke suite: `257/257` passed.
- Production-blocker suite: `22/22` passed.
- Critical DB suite: `23/23` passed.
- New focused regressions: passed.
- TypeScript: passed.
- Production build: passed with pre-existing non-fatal lint warnings.

## Readiness decision

`BLOCKED`

The accounting chain itself reconciles exactly in the controlled scenarios, but client production acceptance remains blocked by empty-database migration replay and the unimplemented audited inter-godown reversal, plus the incomplete dedicated superadmin-liability lifecycle rehearsal.
