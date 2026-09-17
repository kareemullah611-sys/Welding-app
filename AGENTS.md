# Karpathy Rules for Import Ledger

## RULE 1: THINK BEFORE CODING
Before writing ANY code, write:
- "My understanding: [what you think I want]"
- "Assumptions: [list each assumption]"
- "If wrong, tell me before I proceed"

## RULE 2: SURGICAL CHANGES (MOST IMPORTANT)
- ONLY change files directly related to the request
- NEVER reformat, rename, or "clean up" unrelated code
- NEVER refactor working code
- If you see other issues, list them but don't fix them
- **Do not change anything — code or UI — that the user did not ask for**
- Copy, labels, colors, layout, component swaps, and styling count as UI — treat them the same as code

### Unrequested changes are forbidden
If the user asks for X, deliver X only. Do not also:
- swap controls (e.g. native `<select>` → custom dropdown) unless asked
- change colors, spacing, borders, or typography unless asked
- "improve" keyboard nav, accessibility, or UX in files outside the request
- simplify, reorganize, or restyle adjacent UI while fixing something else

**Example (do not repeat):** Payment modal dropdown option colors changed when simplifying modal copy — user did not ask for that. Revert or avoid; stay on the requested task.

When tempted to touch something extra: **list it for the user; do not implement it** unless they confirm.

## RULE 3: GOAL-DRIVEN EXECUTION
Format every fix as:
1. Write test that captures the bug
2. Verify test fails
3. Find minimal code change
4. Change ONLY that code
5. Verify test passes
6. Report: what changed, how verified

## RULE 4: SIMPLICITY
- Minimum code that works
- No "just in case" features
- No defensive try/catch for impossible scenarios

## LEDGER-SPECIFIC
- Never assume tax rate
- Never assume currency conversion
- Verify every calculation with source data

## RULE 5: E2E VERIFICATION BEFORE "DONE"
For any change touching payments, haji transfers, customer/supplier ledger, bank accounts, running balance, or treasury:

1. **Builder must not mark work complete** until an E2E trace is documented (form → API → DB → ledger/display).
2. **Prefer a separate verifier pass** — new chat or invoke skill `e2e-verifier` (`.cursor/skills/e2e-verifier/SKILL.md`). Verifier is read-only unless asked to fix.
3. Check **every variant** (cash / cheque / bank / online, Pakistan vs Afghanistan, city vs super admin).
4. Grep submit handlers for `delete body.` when adding fields that must reach the API.
5. Attach or paste the verifier **Trace table** (PASS/FAIL per flow) before commit/PR.

Display-only fields (`detail`, `transferredTo`) are not proof of correct persistence — confirm FK/ID columns match ledger queries.

## RULE 6: FINANCE-CHANGE CONTRACT
For any accounting, payment, expense, sale, inventory, transfer, opening balance, dashboard balance, running balance, profit/report, or ledger change, first list every affected path before coding.

Do not mark work done until these are explicitly verified:
1. Form payload
2. API validation
3. DB rows created/updated/deleted
4. Journal entries
5. Customer/supplier/haji/liability ledger effect
6. Payments module running balance
7. Dashboard/treasury balance
8. Edit behavior
9. Delete/cancel behavior
10. Existing historical entries behavior

In this app, finance changes often have separate paths. Check all relevant paths:
- API create/edit/delete route
- Journal helpers
- `finance/combined` running balance
- Treasury/dashboard summaries
- Cash-ledger/bank-ledger views
- Customer ledger
- PDF/XLSX exports
- Edit modal prefill

Add regression tests for the exact bug and the related paired-entry case. If any path is not verified, say **NOT VERIFIED** clearly. Do not rely on display text as proof of persistence.

Every finance final report must include this trace table:

| Flow | Form | API | DB | Journal | Ledger | Running Balance | Dashboard | Edit | Delete | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## LOT PRODUCT COST CORRECTION RULE

- Lot purchase value and every landed cost must be attributable to child products, not only to the parent lot.
- Default allocation policy: customs duty by product purchase value; freight/transport by product weight; loading/unloading by cartons; product-specific costs only to the selected product; other costs require an explicit allocation basis.
- A late lot cost or post-sale purchase correction must affect product carrying cost, sold COGS/profit, opening-stock adjustment, and remaining inventory according to the corrected product quantities.
- Never rewrite or delete original purchase/COGS journals to apply a correction. Post an immutable, current-period delta with an audit reference to the source lot/purchase/cost.
- Normal sold quantity posts to COGS, opening-import sold quantity posts to Historical Stock Adjustment, and remaining quantity stays in Inventory.
- Block quantity reductions below sold/distributed/transferred quantities. Never guess missing weight, FX, or allocation basis.
- Do not silently rewrite a closed/finalized period; use the approved post-finalization historical-pool adjustment path.
