CREATE TABLE "offline_sync_devices" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "device_id" VARCHAR(200) NOT NULL,
    "platform" VARCHAR(50) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offline_sync_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "offline_sync_devices_token_hash_key" ON "offline_sync_devices"("token_hash");
CREATE UNIQUE INDEX "unique_offline_sync_user_device" ON "offline_sync_devices"("user_id", "device_id");
CREATE INDEX "offline_sync_devices_user_id_idx" ON "offline_sync_devices"("user_id");
CREATE INDEX "offline_sync_devices_expires_at_idx" ON "offline_sync_devices"("expires_at");

ALTER TABLE "offline_sync_devices"
ADD CONSTRAINT "offline_sync_devices_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
