CREATE TABLE "opening_cutover_entries" (
    "id" SERIAL NOT NULL,
    "cutover_id" INTEGER NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "opening_cutover_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "opening_cutover_entry_entity_key"
ON "opening_cutover_entries"("entity_type", "entity_id");

CREATE INDEX "opening_cutover_entries_cutover_id_idx"
ON "opening_cutover_entries"("cutover_id");

ALTER TABLE "opening_cutover_entries"
ADD CONSTRAINT "opening_cutover_entries_cutover_id_fkey"
FOREIGN KEY ("cutover_id") REFERENCES "opening_cutovers"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
