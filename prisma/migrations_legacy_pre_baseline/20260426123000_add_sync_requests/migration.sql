CREATE TABLE "sync_requests" (
  "id" SERIAL NOT NULL,
  "city_id" INTEGER NOT NULL,
  "module" VARCHAR(80) NOT NULL,
  "request_id" VARCHAR(120) NOT NULL,
  "device_id" VARCHAR(120),
  "entity_type" VARCHAR(80),
  "entity_id" INTEGER,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unique_sync_request_per_city_module"
ON "sync_requests"("city_id", "module", "request_id");

CREATE INDEX "sync_requests_city_id_idx" ON "sync_requests"("city_id");
CREATE INDEX "sync_requests_created_at_idx" ON "sync_requests"("created_at");
