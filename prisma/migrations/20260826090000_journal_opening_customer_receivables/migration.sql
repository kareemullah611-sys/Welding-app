-- Backfill opening customer balances into the AR control ledger.
-- Versioned OPENAR transaction IDs preserve subsequent opening edits and reversals.
INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
SELECT
  '1200-C' || c."id",
  'AR - ' || c."name",
  'asset'::"AccountType",
  NULL,
  TRUE,
  TRUE,
  NOW()
FROM "customers" c
WHERE EXISTS (
  SELECT 1 FROM "opening_customer_balances" o WHERE o."customer_id" = c."id"
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
VALUES ('3900', 'Opening Balances', 'equity'::"AccountType", NULL, TRUE, TRUE, NOW())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "journal_entries" (
  "transaction_id", "account_id", "debit", "credit", "currency_code",
  "description", "entity_type", "entity_id", "city_id", "entry_date", "created_by", "created_at"
)
SELECT
  'OPENAR-' || o."id" || '-V1',
  ar."id",
  CASE WHEN o."amount" > 0 THEN o."amount" ELSE 0 END,
  CASE WHEN o."amount" < 0 THEN ABS(o."amount") ELSE 0 END,
  cur."code",
  CASE WHEN o."amount" < 0 THEN 'Opening customer advance #' ELSE 'Opening customer balance #' END || o."id",
  'opening_customer_balance',
  o."id",
  c."city_id",
  o."opening_date",
  o."created_by",
  NOW()
FROM "opening_customer_balances" o
JOIN "customers" c ON c."id" = o."customer_id"
JOIN "currencies" cur ON cur."id" = o."currency_id"
JOIN "accounts" ar ON ar."code" = '1200-C' || c."id"
WHERE o."amount" <> 0
  AND NOT EXISTS (
    SELECT 1 FROM "journal_entries" je
    WHERE je."entity_type" = 'opening_customer_balance' AND je."entity_id" = o."id"
  );

-- Backfill every other monetary opening into its balance-sheet control account.
-- Opening stock is quantity-only and is intentionally excluded until a valuation is supplied.
INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
SELECT '1001-CITY' || c."id", 'Cash - ' || c."name", 'asset'::"AccountType", c."id", TRUE, TRUE, NOW()
FROM "cities" c WHERE EXISTS (SELECT 1 FROM "opening_cashes" o WHERE o."city_id" = c."id")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
SELECT '1002-CHEQUE' || c."id", 'Cheques in Hand - ' || c."name", 'asset'::"AccountType", c."id", TRUE, TRUE, NOW()
FROM "cities" c WHERE EXISTS (SELECT 1 FROM "opening_cheques" o WHERE o."city_id" = c."id")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
SELECT '1050-BANK' || b."id", 'Bank - ' || b."bank_name" || COALESCE(' ' || b."account_number", ''), 'asset'::"AccountType", NULL, TRUE, TRUE, NOW()
FROM "bank_accounts" b WHERE EXISTS (SELECT 1 FROM "opening_bank_balances" o WHERE o."bank_account_id" = b."id")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
VALUES ('6003', 'Haji Account', 'equity'::"AccountType", NULL, TRUE, TRUE, NOW())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
SELECT '2100-S' || s."id", 'Payable - ' || s."name", 'liability'::"AccountType", NULL, TRUE, TRUE, NOW()
FROM "suppliers" s WHERE EXISTS (SELECT 1 FROM "opening_liabilities" o WHERE o."supplier_id" = s."id")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
SELECT '2200-A' || a."id", 'Payable - ' || a."name", 'liability'::"AccountType", NULL, TRUE, TRUE, NOW()
FROM "agents" a WHERE EXISTS (SELECT 1 FROM "opening_liabilities" o WHERE o."agent_id" = a."id")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
SELECT '2300-SL' || s."id", 'Payable - ' || s."name", 'liability'::"AccountType", NULL, TRUE, TRUE, NOW()
FROM "shipping_lines" s WHERE EXISTS (SELECT 1 FROM "opening_liabilities" o WHERE o."shipping_line_id" = s."id")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
SELECT '1060-H' || i."id", 'Intermediary - ' || i."name", 'asset'::"AccountType", NULL, TRUE, TRUE, NOW()
FROM "intermediaries" i WHERE EXISTS (SELECT 1 FROM "opening_liabilities" o WHERE o."intermediary_id" = i."id")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "accounts" ("code", "name", "account_type", "city_id", "is_system", "is_active", "created_at")
SELECT '2400-CL' || a."id", 'City Payable - ' || a."name", 'liability'::"AccountType", a."city_id", TRUE, TRUE, NOW()
FROM "city_liability_accounts" a WHERE EXISTS (SELECT 1 FROM "opening_city_liabilities" o WHERE o."account_id" = a."id")
ON CONFLICT ("code") DO NOTHING;

DROP TABLE IF EXISTS "_opening_balance_pending";
DROP TABLE IF EXISTS "_opening_balance_backfill";

CREATE TEMP TABLE "_opening_balance_backfill" AS
SELECT
  'OPENCASH-' || o."id" AS "transaction_prefix",
  'opening_cash' AS "entity_type",
  o."id" AS "entity_id",
  o."city_id" AS "city_id",
  cur."code" AS "currency_code",
  o."amount" AS "amount",
  o."opening_date" AS "entry_date",
  o."created_by" AS "created_by",
  '1001-CITY' || o."city_id" AS "account_code",
  TRUE AS "debit_side"
FROM "opening_cashes" o JOIN "currencies" cur ON cur."id" = o."currency_id"
UNION ALL
SELECT 'OPENBANK-' || o."id", 'opening_bank_balance', o."id", o."city_id", cur."code", o."amount", o."opening_date", o."created_by", '1050-BANK' || o."bank_account_id", TRUE
FROM "opening_bank_balances" o JOIN "currencies" cur ON cur."id" = o."currency_id"
UNION ALL
SELECT 'OPENCHEQUE-' || o."id", 'opening_cheque', o."id", o."city_id", cur."code", o."amount", o."opening_date", o."created_by", '1002-CHEQUE' || o."city_id", TRUE
FROM "opening_cheques" o JOIN "currencies" cur ON cur."id" = o."currency_id"
UNION ALL
SELECT 'OPENHAJI-' || o."id", 'opening_haji_balance', o."id", o."city_id", cur."code", o."amount", o."opening_date", o."created_by", '6003', TRUE
FROM "opening_haji_balances" o JOIN "currencies" cur ON cur."id" = o."currency_id"
UNION ALL
SELECT 'OPENLIAB-' || o."id", 'opening_liability', o."id", NULL, cur."code", o."amount", o."opening_date", o."created_by",
  CASE o."liability_type"::text
    WHEN 'supplier' THEN '2100-S' || o."supplier_id"
    WHEN 'shipping_line' THEN '2300-SL' || o."shipping_line_id"
    WHEN 'agent' THEN '2200-A' || o."agent_id"
    ELSE '1060-H' || o."intermediary_id"
  END,
  CASE o."liability_type"::text WHEN 'intermediary' THEN TRUE ELSE FALSE END
FROM "opening_liabilities" o JOIN "currencies" cur ON cur."id" = o."currency_id"
UNION ALL
SELECT 'OPENCITYLIAB-' || o."id", 'opening_city_liability', o."id", o."city_id", cur."code", o."amount", o."opening_date", o."created_by", '2400-CL' || o."account_id", FALSE
FROM "opening_city_liabilities" o JOIN "currencies" cur ON cur."id" = o."currency_id";

CREATE TEMP TABLE "_opening_balance_pending" AS
SELECT b.*
FROM "_opening_balance_backfill" b
WHERE b."amount" <> 0
  AND NOT EXISTS (
    SELECT 1 FROM "journal_entries" je
    WHERE je."entity_type" = b."entity_type" AND je."entity_id" = b."entity_id"
  );

INSERT INTO "journal_entries" (
  "transaction_id", "account_id", "debit", "credit", "currency_code",
  "description", "entity_type", "entity_id", "city_id", "entry_date", "created_by", "created_at"
)
SELECT
  b."transaction_prefix" || '-V1',
  a."id",
  CASE WHEN (b."amount" > 0) = b."debit_side" THEN ABS(b."amount") ELSE 0 END,
  CASE WHEN (b."amount" > 0) = b."debit_side" THEN 0 ELSE ABS(b."amount") END,
  b."currency_code",
  'Opening balance #' || b."entity_id",
  b."entity_type",
  b."entity_id",
  b."city_id",
  b."entry_date",
  b."created_by",
  NOW()
FROM "_opening_balance_pending" b
JOIN "accounts" a ON a."code" = b."account_code";

INSERT INTO "journal_entries" (
  "transaction_id", "account_id", "debit", "credit", "currency_code",
  "description", "entity_type", "entity_id", "city_id", "entry_date", "created_by", "created_at"
)
SELECT
  b."transaction_prefix" || '-V1',
  equity."id",
  CASE WHEN (b."amount" > 0) = b."debit_side" THEN 0 ELSE ABS(b."amount") END,
  CASE WHEN (b."amount" > 0) = b."debit_side" THEN ABS(b."amount") ELSE 0 END,
  b."currency_code",
  'Opening balance #' || b."entity_id",
  b."entity_type",
  b."entity_id",
  b."city_id",
  b."entry_date",
  b."created_by",
  NOW()
FROM "_opening_balance_pending" b
JOIN "accounts" equity ON equity."code" = '3900';

INSERT INTO "journal_entries" (
  "transaction_id", "account_id", "debit", "credit", "currency_code",
  "description", "entity_type", "entity_id", "city_id", "entry_date", "created_by", "created_at"
)
SELECT
  'OPENAR-' || o."id" || '-V1',
  equity."id",
  CASE WHEN o."amount" < 0 THEN ABS(o."amount") ELSE 0 END,
  CASE WHEN o."amount" > 0 THEN o."amount" ELSE 0 END,
  cur."code",
  CASE WHEN o."amount" < 0 THEN 'Opening customer advance #' ELSE 'Opening customer balance #' END || o."id",
  'opening_customer_balance',
  o."id",
  c."city_id",
  o."opening_date",
  o."created_by",
  NOW()
FROM "opening_customer_balances" o
JOIN "customers" c ON c."id" = o."customer_id"
JOIN "currencies" cur ON cur."id" = o."currency_id"
JOIN "accounts" equity ON equity."code" = '3900'
WHERE o."amount" <> 0
  AND EXISTS (
    SELECT 1 FROM "journal_entries" je
    WHERE je."transaction_id" = 'OPENAR-' || o."id" || '-V1'
      AND je."account_id" = (SELECT ar."id" FROM "accounts" ar WHERE ar."code" = '1200-C' || c."id")
  )
  AND NOT EXISTS (
    SELECT 1 FROM "journal_entries" je
    WHERE je."transaction_id" = 'OPENAR-' || o."id" || '-V1'
      AND je."account_id" = equity."id"
  );

DROP TABLE "_opening_balance_pending";
DROP TABLE "_opening_balance_backfill";
