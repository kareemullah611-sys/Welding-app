# Haji Cheque Selector Pagination

## Scope

Fix the first-page-only list of eligible payment cheques in the Payments modal,
standalone Haji transfer modal, and its post-save refresh. No transfer mutation,
posting policy, currency policy, or database schema changed.

All three readers now request bounded pages instead of relying on the ignored
`all=1` flag. Payments have an ID tie-breaker after payment date for stable page
boundaries. Failed/inconsistent pages return no partial list. The UI clears stale
options, shows an error, and does not overwrite a complete offline form cache
with a failed read. Existing offline cached-form behavior remains unchanged.

## Verification

- RED: regression tests failed before the helper/wiring existed.
- GREEN: 7 focused tests, covering 0/35/235 records, server page-size caps,
  duplicate page boundaries, failure, and restarting reads after failure.
- Library suite: 572 passed; new tests included in `test:lib`.
- Browser suite: 8 passed, desktop and mobile Chromium, both modal paths with
  35 and 235 database-backed cheques. Search, select/unselect, excluded statuses,
  failed-page error display, cache preservation, and successful retry checked.
- Test fixtures use equal payment dates to exercise deterministic pagination.
- No transfer was submitted. Payment row counts and journal counts remained
  unchanged during selector interaction.
- TypeScript passed in an isolated workspace. Targeted lint and the offline gate
  with `NEXT_PUBLIC_OFFLINE_ENABLED=true` passed.
- Local test fixture residue: 0 cheque-test customers, 0 cheque-test payments.
- Initial browser attempts encountered a form-initialization race in the test,
  concurrent Next.js build-cache conflicts, and interrupted-test residue. The
  final successful run used isolated build output and owned-fixture cleanup.

## Trace

NV means NOT VERIFIED in this change. PASS applies to cheque-list loading, not
financial posting certification.

| Flow | Form | API | DB | Journal | Ledger | Running Balance | Dashboard | Edit | Delete | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Payments Haji selector | List/search/select PASS; submit NV | Paginated GET PASS | 35/235 fixtures PASS | Count unchanged | NV | NV | NV | NV | NV | Selector PASS |
| Standalone Haji selector | List/select PASS; submit NV | Paginated GET PASS | 35/235 fixtures PASS | Count unchanged | NV | NV | NV | NV | NV | Selector PASS |
| Standalone post-save refresh | Shared reader wiring PASS | Helper tested | Live transfer NV | NV | NV | NV | NV | NV | NV | Partial verification |

## Boundaries

Customer opening cheques remain outside these selectors: the transfer API accepts
payment IDs, not opening-cheque IDs. Supporting them requires a separate audited
transfer/reversal lifecycle; IDs must not be mixed between the two tables.

The user's live 35-cheque breakdown was not queried. Existing city and status
eligibility filters remain intact. Full cash/bank/cheque/mixed-transfer posting,
superadmin/AF behavior, edit/reversal, offline queued writes and reconciliation
were not re-certified. This fix adds only reads, not a mutation or queue policy.
