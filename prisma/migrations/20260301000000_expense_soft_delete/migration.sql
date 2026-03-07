-- Migration: Add soft-delete support to expenses
-- Run this migration with: npx prisma migrate deploy
-- Or apply manually via your database console.

ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "expenses_deleted_at_idx"
  ON "expenses" ("deleted_at");
