-- Additive one-time opening cutover control. Existing opening and accounting rows are preserved.
CREATE TYPE "OpeningCutoverStatus" AS ENUM ('draft', 'finalized', 'reversed');

CREATE TABLE "opening_cutovers" (
    "id" SERIAL NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "OpeningCutoverStatus" NOT NULL DEFAULT 'draft',
    "cutover_date" DATE NOT NULL,
    "fiscal_year_start" DATE NOT NULL,
    "fiscal_year_end" DATE NOT NULL,
    "backup_reference" VARCHAR(240) NOT NULL,
    "backup_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "backup_verified_by" INTEGER,
    "backup_verified_at" TIMESTAMP(3),
    "reconciliation_difference_pkr" DECIMAL(15,2),
    "readiness_snapshot_json" JSONB,
    "final_snapshot_json" JSONB,
    "finalized_by" INTEGER,
    "finalized_at" TIMESTAMP(3),
    "reversed_by" INTEGER,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "supersedes_cutover_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opening_cutovers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opening_participant_balances" (
    "id" SERIAL NOT NULL,
    "cutover_id" INTEGER NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "capital_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "current_year_profit_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "ongoing_lot_realized_profit_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "opening_date" DATE NOT NULL,
    "notes" TEXT,
    "journal_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opening_participant_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "opening_cutovers_revision_key" ON "opening_cutovers"("revision");
CREATE INDEX "opening_cutovers_status_idx" ON "opening_cutovers"("status");
CREATE INDEX "opening_cutovers_cutover_date_idx" ON "opening_cutovers"("cutover_date");
CREATE INDEX "opening_cutovers_supersedes_cutover_id_idx" ON "opening_cutovers"("supersedes_cutover_id");
CREATE UNIQUE INDEX "opening_participant_cutover_participant_key" ON "opening_participant_balances"("cutover_id", "participant_id");
CREATE INDEX "opening_participant_balances_participant_id_idx" ON "opening_participant_balances"("participant_id");
CREATE INDEX "opening_participant_balances_opening_date_idx" ON "opening_participant_balances"("opening_date");

ALTER TABLE "opening_participant_balances"
  ADD CONSTRAINT "opening_participant_balances_cutover_id_fkey"
  FOREIGN KEY ("cutover_id") REFERENCES "opening_cutovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_participant_balances"
  ADD CONSTRAINT "opening_participant_balances_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
