# Sale and Payment Modal Loading

Verified locally on 2026-10-09 against an isolated database.

## Change

The create-form handlers previously awaited setup data and the latest-entry
summary sequentially. They now start both reads together with Promise.all.
Existing readiness checks, form initialization, submission payloads and
accounting routes are unchanged. No new mutation or offline queue path is added.
This removes a request waterfall; production timing savings are NOT VERIFIED.

## Evidence

- Before the change, both executable handler tests failed because only one
  independent loader had started. After the change, both pass and prove that
  readiness still waits for both reads.
- Playwright: 8/8 passed for sale/payment forms, Quetta/Kabul city admins,
  desktop/mobile Chromium. Each test holds one response and proves the other
  request starts before releasing it, then checks that form fields appear.
- TypeScript and targeted ESLint passed.
- Offline feature gate passed with NEXT_PUBLIC_OFFLINE_ENABLED=true.
- Browser checks open forms only; no sale or payment is submitted.
- No commit, push, production reset or deployment was performed for this fix.

## Trace

NV means NOT VERIFIED in this pass. Accounting paths were not changed.

| Flow | Form | API | DB | Journal | Ledger | Running Balance | Dashboard | Edit | Delete | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sale create-form loading, PK/AF | PASS | GET concurrency PASS | Read-backed options PASS; writes NV | NV | NV | NV | NV | NV | NV | Loading PASS |
| Payment create-form loading, PK/AF | PASS | GET concurrency PASS | Read-backed options PASS; writes NV | NV | NV | NV | NV | NV | NV | Loading PASS |

Cash/cheque/bank/online posting, shared expense/withdrawal/haji form variants,
superadmin workflows, offline replay/reconciliation, and historical-entry
effects were not re-exercised. The changed operations are reads, not mutations;
existing write idempotency and offline policy remain untouched.
