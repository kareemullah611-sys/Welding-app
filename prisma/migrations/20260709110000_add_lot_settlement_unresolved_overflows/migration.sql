-- Fix C3: Persist "unresolvable" lot-settlement overflows.

CREATE TABLE IF NOT EXISTS "lot_settlement_unresolved_overflows" (
  "id" SERIAL NOT NULL,
  "city_id" INTEGER NOT NULL,
  "from_lot_id" INTEGER NOT NULL,
  "overflow_amount" DECIMAL(15,2) NOT NULL,
  "currency_id" INTEGER NOT NULL,
  "notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "resolved_by" INTEGER,
  "resolution_notes" TEXT,
  CONSTRAINT "lot_settlement_unresolved_overflows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lot_settlement_unresolved_overflows_city_id_idx" ON "lot_settlement_unresolved_overflows" ("city_id");
CREATE INDEX IF NOT EXISTS "lot_settlement_unresolved_overflows_from_lot_id_idx" ON "lot_settlement_unresolved_overflows" ("from_lot_id");
CREATE INDEX IF NOT EXISTS "lot_settlement_unresolved_overflows_resolved_at_idx" ON "lot_settlement_unresolved_overflows" ("resolved_at");

ALTER TABLE "lot_settlement_unresolved_overflows" ADD CONSTRAINT "lot_settlement_unresolved_overflows_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_settlement_unresolved_overflows" ADD CONSTRAINT "lot_settlement_unresolved_overflows_from_lot_id_fkey" FOREIGN KEY ("from_lot_id") REFERENCES "lots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_settlement_unresolved_overflows" ADD CONSTRAINT "lot_settlement_unresolved_overflows_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_settlement_unresolved_overflows" ADD CONSTRAINT "lot_settlement_unresolved_overflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
