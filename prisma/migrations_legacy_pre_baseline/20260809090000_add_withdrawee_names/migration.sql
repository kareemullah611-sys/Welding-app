-- Standalone withdrawee names so they appear in search even before a withdrawal exists.
CREATE TABLE "withdrawee_names" (
  "id" SERIAL NOT NULL,
  "city_id" INTEGER NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "withdrawee_names_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "withdrawee_names_city_id_name_key"
  ON "withdrawee_names"("city_id", "name");
CREATE INDEX "withdrawee_names_city_id_idx"
  ON "withdrawee_names"("city_id");

ALTER TABLE "withdrawee_names"
  ADD CONSTRAINT "withdrawee_names_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawee_names"
  ADD CONSTRAINT "withdrawee_names_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
