ALTER TABLE "offline_sync_devices"
ADD COLUMN "approved_at" TIMESTAMP(3);

UPDATE "offline_sync_devices"
SET "approved_at" = "created_at"
WHERE "approved_at" IS NULL;

ALTER TABLE "offline_sync_devices"
ALTER COLUMN "approved_at" SET NOT NULL;
