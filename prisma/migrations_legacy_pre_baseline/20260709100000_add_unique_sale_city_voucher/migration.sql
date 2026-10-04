-- Fix C1+H6: Enforce uniqueness of (city_id, voucher_no) on sales.
-- If duplicate rows exist, this migration will fail. Run first:
--   SELECT city_id, voucher_no, COUNT(*) FROM sales GROUP BY city_id, voucher_no HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "unique_sale_city_voucher" ON "sales" ("city_id", "voucher_no");
