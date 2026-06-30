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
