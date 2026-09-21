# Foreign-Currency Accounting Policy

This policy is an accounting invariant for every supported non-PKR currency. Current canonical currencies are USD, AFN, CNY and AED. `RMB` is an input alias for `CNY`; it is never a separate accounting currency.

It applies equally to transactions entered by Superadmin and City Admin. Authorization scope may differ, but accounting treatment does not.

## Recognition and carrying layers

- Every foreign-currency monetary asset or liability must retain its original foreign amount and an immutable PKR carrying basis.
- The carrying record must preserve the recognition date, historical-pool date, rate, rate type, provider, reference and conversion path.
- Never use today's rate for an older transaction, silently use zero, or guess a missing rate.
- Missing historical rate or carrying basis blocks settlement and investor finalization.
- A transaction path that has not yet been wired to carrying layers must reject non-PKR writes with `FOREIGN_CARRYING_LAYER_REQUIRED`; it must never fall back to raw foreign units in PKR accounting.

## Movements and settlement

- A same-currency transfer moves the source carrying layer proportionally. It never creates FX gain or loss.
- A currency exchange or settlement compares the source historical PKR carrying amount with the documented transaction-date PKR value.
- For an asset, `realized FX = settlement PKR - carrying PKR`.
- For a liability, `realized FX = carrying PKR - settlement PKR`.
- FX gain/loss is recognized once only, separately from revenue, COGS and operating expenses.
- Editing or cancelling a posted movement uses reversal and re-entry; historical rows are not destructively rewritten.

## Historical ownership

- FX gain/loss belongs to the historical participation pool of the original asset or liability, including when realized in a later financial year.
- A new investor cannot receive an old-pool adjustment.
- If an investor from the original pool has exited, that investor's residual gain or loss is transferred symmetrically to the manager.
- Customer collection status never determines profit ownership. Recognized Financial Report profit/loss is attributed regardless of collection.

## Currency-source policy

- Afghanistan uses the approved Sarai Shahzada/Sarafi snapshot or an actual documented rate according to the configured priority.
- Pakistan lot fallback policy remains governed by the centralized Pakistan market-rate adjustment policy.
- Actual documented settlement rates are settlement evidence and do not rewrite initial recognition.

## Required reconciliation chain

`Source transaction → carrying layer → movement/settlement → FX journal → authoritative PKR Financial Report → historical pool → investor/manager attribution`

Every layer must reconcile to zero before finalization.
