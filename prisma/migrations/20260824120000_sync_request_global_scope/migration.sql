ALTER TABLE "sync_requests"
  DROP CONSTRAINT IF EXISTS "sync_requests_city_id_fkey";

ALTER TABLE "sync_requests"
  ADD CONSTRAINT "sync_requests_city_scope_check"
  CHECK ("city_id" >= 0) NOT VALID;

COMMENT ON COLUMN "sync_requests"."city_id" IS
  'Idempotency scope: 0 for global superadmin operations, otherwise the city ID.';
