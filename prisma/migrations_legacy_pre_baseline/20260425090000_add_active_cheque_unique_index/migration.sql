-- Migration: Prevent duplicate active cheque numbers per city
-- This enforces a DB-level guard for concurrency safety.

CREATE UNIQUE INDEX IF NOT EXISTS "payments_active_cheque_city_unique"
  ON "payments" ("city_id", "cheque_number")
  WHERE "status" = 'active'
    AND "payment_method" = 'cheque'
    AND "cheque_number" IS NOT NULL;
