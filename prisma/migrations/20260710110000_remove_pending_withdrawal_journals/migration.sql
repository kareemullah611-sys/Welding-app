-- Fix C7 data cleanup: pending withdrawals no longer affect treasury.
-- Previous code posted WDRAW-* journals at creation time. Remove those stale
-- journal rows for withdrawals that have not been approved yet.

DELETE FROM "journal_entries" je
USING "personal_withdrawals" pw
WHERE pw."approved_at" IS NULL
  AND je."transaction_id" IN (
    CONCAT('WDRAW-', pw."id"),
    CONCAT('REV-WDRAW-', pw."id")
  );
