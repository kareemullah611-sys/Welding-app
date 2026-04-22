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
