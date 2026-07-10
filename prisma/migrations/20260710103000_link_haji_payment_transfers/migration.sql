ALTER TABLE "haji_transfers"
ADD COLUMN IF NOT EXISTS "payment_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'haji_transfers_payment_id_fkey'
  ) THEN
    ALTER TABLE "haji_transfers"
    ADD CONSTRAINT "haji_transfers_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "haji_transfers_payment_id_key"
ON "haji_transfers"("payment_id");

DELETE FROM "haji_transfers"
WHERE "detail" LIKE 'Opening Haji balance%';

INSERT INTO "haji_transfers" (
  "city_id",
  "lot_id",
  "transfer_date",
  "amount",
  "currency_id",
  "detail",
  "reference_no",
  "transfer_type",
  "transferred_to",
  "notes",
  "source_type",
  "settlement_destination",
  "super_admin_bank_account_id",
  "payment_id",
  "created_by",
  "created_at",
  "updated_at"
)
SELECT
  p."city_id",
  p."lot_id",
  p."payment_date",
  p."amount",
  p."currency_id",
  CONCAT('Customer payment to Haji (PAY-', p."id", ')'),
  COALESCE(NULLIF(p."manual_voucher_no", ''), CONCAT('PAY-', p."id")),
  'direct'::"HajiTransferType",
  'Customer payment',
  p."notes",
  CASE
    WHEN p."payment_method" = 'cheque' THEN 'cheque'::"HajiSourceType"
    WHEN p."payment_method" IN ('bank_transfer', 'online') THEN 'bank_transfer'::"HajiSourceType"
    ELSE 'cash_office'::"HajiSourceType"
  END,
  'standard'::"HajiSettlementDestination",
  p."super_admin_bank_account_id",
  p."id",
  p."created_by",
  p."created_at",
  p."updated_at"
FROM "payments" p
WHERE p."destination" = 'haji'
  AND p."status" = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM "haji_transfers" h
    WHERE h."payment_id" = p."id"
  );

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system")
SELECT DISTINCT
  CONCAT('1001-CITY', p."city_id"),
  CONCAT('Cash - ', c."name"),
  'asset'::"AccountType",
  p."city_id",
  TRUE
FROM "payments" p
JOIN "cities" c ON c."id" = p."city_id"
WHERE p."destination" = 'haji'
  AND p."status" = 'active'
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "is_system")
SELECT DISTINCT
  CONCAT('1200-C', p."customer_id"),
  CONCAT('AR - ', cu."name"),
  'asset'::"AccountType",
  TRUE
FROM "payments" p
JOIN "customers" cu ON cu."id" = p."customer_id"
WHERE p."destination" = 'haji'
  AND p."status" = 'active'
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "is_system")
SELECT DISTINCT
  CONCAT('1050-SABANK', p."super_admin_bank_account_id"),
  CONCAT('Super Admin Bank - ', sab."bank_name", CASE WHEN sab."account_number" IS NULL OR sab."account_number" = '' THEN '' ELSE CONCAT(' ', sab."account_number") END),
  'asset'::"AccountType",
  TRUE
FROM "payments" p
JOIN "super_admin_bank_accounts" sab ON sab."id" = p."super_admin_bank_account_id"
WHERE p."destination" = 'haji'
  AND p."status" = 'active'
  AND p."super_admin_bank_account_id" IS NOT NULL
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "is_system")
SELECT '6003', 'Haji Account', 'equity'::"AccountType", TRUE
WHERE EXISTS (
  SELECT 1 FROM "payments" WHERE "destination" = 'haji' AND "status" = 'active' AND "super_admin_bank_account_id" IS NULL
)
ON CONFLICT ("code") DO NOTHING;

DELETE FROM "journal_entries"
WHERE "transaction_id" IN (
  SELECT CONCAT('PAY-', p."id")
  FROM "payments" p
  WHERE p."destination" = 'haji'
  AND p."status" = 'active'
)
OR "transaction_id" IN (
  SELECT CONCAT('HAJI-', h."id")
  FROM "haji_transfers" h
  WHERE h."payment_id" IS NOT NULL
);

INSERT INTO "journal_entries" (
  "transaction_id",
  "account_id",
  "debit",
  "credit",
  "currency_code",
  "exchange_rate",
  "description",
  "entity_type",
  "entity_id",
  "lot_id",
  "city_id",
  "entry_date",
  "created_by"
)
SELECT
  CONCAT('PAY-', p."id"),
  cash_account."id",
  p."amount",
  0,
  cur."code",
  NULL,
  CONCAT('Payment #', p."id"),
  'payment',
  p."id",
  p."lot_id",
  p."city_id",
  p."payment_date",
  p."created_by"
FROM "payments" p
JOIN "currencies" cur ON cur."id" = p."currency_id"
JOIN "accounts" cash_account ON cash_account."code" = CONCAT('1001-CITY', p."city_id")
WHERE p."destination" = 'haji'
  AND p."status" = 'active';

INSERT INTO "journal_entries" (
  "transaction_id",
  "account_id",
  "debit",
  "credit",
  "currency_code",
  "exchange_rate",
  "description",
  "entity_type",
  "entity_id",
  "lot_id",
  "city_id",
  "entry_date",
  "created_by"
)
SELECT
  CONCAT('PAY-', p."id"),
  customer_account."id",
  0,
  p."amount",
  cur."code",
  NULL,
  CONCAT('Payment #', p."id"),
  'payment',
  p."id",
  p."lot_id",
  p."city_id",
  p."payment_date",
  p."created_by"
FROM "payments" p
JOIN "currencies" cur ON cur."id" = p."currency_id"
JOIN "accounts" customer_account ON customer_account."code" = CONCAT('1200-C', p."customer_id")
WHERE p."destination" = 'haji'
  AND p."status" = 'active';

INSERT INTO "journal_entries" (
  "transaction_id",
  "account_id",
  "debit",
  "credit",
  "currency_code",
  "exchange_rate",
  "description",
  "entity_type",
  "entity_id",
  "lot_id",
  "city_id",
  "entry_date",
  "created_by"
)
SELECT
  CONCAT('HAJI-', h."id"),
  COALESCE(sa_account."id", haji_account."id"),
  h."amount",
  0,
  cur."code",
  NULL,
  'Haji transfer',
  'haji_transfer',
  h."id",
  h."lot_id",
  h."city_id",
  h."transfer_date",
  h."created_by"
FROM "haji_transfers" h
JOIN "currencies" cur ON cur."id" = h."currency_id"
LEFT JOIN "accounts" sa_account ON sa_account."code" = CONCAT('1050-SABANK', h."super_admin_bank_account_id")
LEFT JOIN "accounts" haji_account ON haji_account."code" = '6003'
WHERE h."payment_id" IS NOT NULL;

INSERT INTO "journal_entries" (
  "transaction_id",
  "account_id",
  "debit",
  "credit",
  "currency_code",
  "exchange_rate",
  "description",
  "entity_type",
  "entity_id",
  "lot_id",
  "city_id",
  "entry_date",
  "created_by"
)
SELECT
  CONCAT('HAJI-', h."id"),
  cash_account."id",
  0,
  h."amount",
  cur."code",
  NULL,
  'Haji transfer',
  'haji_transfer',
  h."id",
  h."lot_id",
  h."city_id",
  h."transfer_date",
  h."created_by"
FROM "haji_transfers" h
JOIN "currencies" cur ON cur."id" = h."currency_id"
JOIN "accounts" cash_account ON cash_account."code" = CONCAT('1001-CITY', h."city_id")
WHERE h."payment_id" IS NOT NULL;
