DO $$ BEGIN
  CREATE TYPE "LotShipmentStatus" AS ENUM (
    'order_confirmed',
    'production',
    'at_tianjin_port',
    'awaiting_departure',
    'departed_tianjin',
    'tianjin_to_karachi',
    'arrived_karachi',
    'customs_clearance',
    'customs_cleared',
    'karachi_to_lahore',
    'arrived_warehouse',
    'completed',
    'delayed',
    'on_hold',
    'documents_pending',
    'customs_hold',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "LotDocumentCategory" AS ENUM (
    'supplier_invoice',
    'packing_list',
    'bill_of_lading',
    'gd_customs',
    'freight_shipping',
    'payment_proof',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "consignees" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(200) NOT NULL,
  "country_id" INTEGER,
  "city_id" INTEGER,
  "phone" VARCHAR(100),
  "address" TEXT,
  "notes" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "consignees_name_key" ON "consignees"("name");
CREATE INDEX IF NOT EXISTS "consignees_country_id_idx" ON "consignees"("country_id");
CREATE INDEX IF NOT EXISTS "consignees_city_id_idx" ON "consignees"("city_id");
CREATE INDEX IF NOT EXISTS "consignees_is_active_idx" ON "consignees"("is_active");

ALTER TABLE "consignees" ADD CONSTRAINT "consignees_country_id_fkey"
  FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "consignees" ADD CONSTRAINT "consignees_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "consignees" ADD CONSTRAINT "consignees_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "consignee_id" INTEGER;
ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "destination_city_id" INTEGER;
ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "shipment_status" "LotShipmentStatus" NOT NULL DEFAULT 'order_confirmed';
ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "eta_date" DATE;

CREATE INDEX IF NOT EXISTS "lots_consignee_id_idx" ON "lots"("consignee_id");
CREATE INDEX IF NOT EXISTS "lots_destination_city_id_idx" ON "lots"("destination_city_id");
CREATE INDEX IF NOT EXISTS "lots_shipment_status_idx" ON "lots"("shipment_status");

ALTER TABLE "lots" ADD CONSTRAINT "lots_consignee_id_fkey"
  FOREIGN KEY ("consignee_id") REFERENCES "consignees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lots" ADD CONSTRAINT "lots_destination_city_id_fkey"
  FOREIGN KEY ("destination_city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "lot_documents" (
  "id" SERIAL PRIMARY KEY,
  "lot_id" INTEGER NOT NULL,
  "category" "LotDocumentCategory" NOT NULL DEFAULT 'other',
  "original_file_name" VARCHAR(500) NOT NULL,
  "storage_key" VARCHAR(1000) NOT NULL,
  "file_url" VARCHAR(1000) NOT NULL,
  "mime_type" VARCHAR(200) NOT NULL,
  "extension" VARCHAR(20) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "reference_no" VARCHAR(100),
  "document_date" DATE,
  "note" TEXT,
  "uploaded_by" INTEGER NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMP(3),
  "archived_by" INTEGER
);

CREATE INDEX IF NOT EXISTS "lot_documents_lot_id_archived_at_idx" ON "lot_documents"("lot_id", "archived_at");
CREATE INDEX IF NOT EXISTS "lot_documents_category_idx" ON "lot_documents"("category");
CREATE INDEX IF NOT EXISTS "lot_documents_uploaded_at_idx" ON "lot_documents"("uploaded_at");

ALTER TABLE "lot_documents" ADD CONSTRAINT "lot_documents_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_documents" ADD CONSTRAINT "lot_documents_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_documents" ADD CONSTRAINT "lot_documents_archived_by_fkey"
  FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "lot_status_history" (
  "id" SERIAL PRIMARY KEY,
  "lot_id" INTEGER NOT NULL,
  "previous_status" "LotShipmentStatus",
  "new_status" "LotShipmentStatus" NOT NULL,
  "effective_at" TIMESTAMP(3) NOT NULL,
  "location" VARCHAR(200),
  "note" TEXT,
  "changed_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "lot_status_history_lot_id_effective_at_idx" ON "lot_status_history"("lot_id", "effective_at");
CREATE INDEX IF NOT EXISTS "lot_status_history_new_status_idx" ON "lot_status_history"("new_status");

ALTER TABLE "lot_status_history" ADD CONSTRAINT "lot_status_history_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_status_history" ADD CONSTRAINT "lot_status_history_changed_by_fkey"
  FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
