CREATE TYPE "FinancialYearStatus" AS ENUM ('open', 'closed');

CREATE TABLE "financial_years" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "status" "FinancialYearStatus" NOT NULL DEFAULT 'open',
  "close_reason" TEXT,
  "closed_by" INTEGER,
  "closed_at" TIMESTAMP(3),
  "reopen_reason" TEXT,
  "reopened_by" INTEGER,
  "reopened_at" TIMESTAMP(3),
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "financial_years_valid_date_range" CHECK ("end_date" >= "start_date")
);

CREATE UNIQUE INDEX "financial_years_start_date_end_date_key" ON "financial_years"("start_date", "end_date");
CREATE INDEX "financial_years_status_idx" ON "financial_years"("status");
