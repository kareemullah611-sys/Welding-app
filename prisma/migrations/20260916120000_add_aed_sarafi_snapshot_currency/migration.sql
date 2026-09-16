INSERT INTO "currencies" ("code", "name", "symbol")
VALUES ('AED', 'UAE Dirham', 'د.إ')
ON CONFLICT ("code") DO NOTHING;
