ALTER TABLE "opening_cutovers"
ADD COLUMN "previous_snapshot_hash" CHAR(64),
ADD COLUMN "final_snapshot_hash" CHAR(64);

CREATE UNIQUE INDEX "opening_cutovers_final_snapshot_hash_key"
ON "opening_cutovers"("final_snapshot_hash");
