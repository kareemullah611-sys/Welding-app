DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentType') THEN
    CREATE TYPE "AgentType" AS ENUM ('customs', 'transport', 'freight', 'other', 'clearing');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentPaymentMethod') THEN
    CREATE TYPE "AgentPaymentMethod" AS ENUM ('cash', 'bank_transfer', 'online', 'cheque', 'intermediary', 'super_admin_cash');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CityTransferStatus') THEN
    CREATE TYPE "CityTransferStatus" AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

UPDATE "agents"
SET "agent_type" = 'other'
WHERE "agent_type" IS NULL
  OR "agent_type" NOT IN ('customs', 'transport', 'freight', 'other', 'clearing');

UPDATE "agent_payments"
SET "payment_method" = CASE
  WHEN "payment_method" IS NULL THEN 'cash'
  WHEN "payment_method" IN ('cash', 'bank_transfer', 'online', 'cheque', 'intermediary', 'super_admin_cash') THEN "payment_method"
  ELSE 'cash'
END;

UPDATE "city_transfers"
SET "status" = CASE
  WHEN "status" IS NULL THEN 'pending'
  WHEN "status" IN ('pending', 'approved', 'rejected') THEN "status"
  ELSE 'pending'
END;

ALTER TABLE "agents"
  ALTER COLUMN "agent_type" TYPE "AgentType"
  USING "agent_type"::"AgentType";

ALTER TABLE "agent_payments"
  ALTER COLUMN "payment_method" TYPE "AgentPaymentMethod"
  USING "payment_method"::"AgentPaymentMethod";

ALTER TABLE "city_transfers"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "CityTransferStatus"
  USING "status"::"CityTransferStatus",
  ALTER COLUMN "status" SET DEFAULT 'pending';

CREATE SCHEMA IF NOT EXISTS app_security;

CREATE OR REPLACE FUNCTION app_security.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_role', true), '')
$$;

CREATE OR REPLACE FUNCTION app_security.current_city_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_city_id', true), '')::INTEGER
$$;

CREATE OR REPLACE FUNCTION app_security.can_access_city(row_city_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    app_security.current_user_role() = 'super_admin'
    OR (
      app_security.current_user_role() = 'city_admin'
      AND row_city_id = app_security.current_city_id()
    )
$$;

COMMENT ON FUNCTION app_security.current_user_role()
IS 'Returns the request-scoped app role from app.current_user_role for future RLS policies.';

COMMENT ON FUNCTION app_security.current_city_id()
IS 'Returns the request-scoped city id from app.current_city_id for future RLS policies.';

COMMENT ON FUNCTION app_security.can_access_city(INTEGER)
IS 'Future RLS helper: permits super_admin globally and city_admin only for its current city.';

DO $$
DECLARE
  policy_table TEXT;
BEGIN
  FOREACH policy_table IN ARRAY ARRAY[
    'city_currencies',
    'customers',
    'godowns',
    'opening_cashes',
    'opening_haji_balances',
    'opening_stocks',
    'opening_bank_balances',
    'opening_cheques',
    'lot_city_distributions',
    'voucher_sequences',
    'sales',
    'payments',
    'expenses',
    'personal_withdrawals',
    'haji_transfers',
    'lot_settlement_overflows',
    'bank_accounts',
    'bank_deposits',
    'agent_payments',
    'audit_logs',
    'sync_requests',
    'inventory_thresholds'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = policy_table
        AND policyname = 'city_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY city_isolation ON %I FOR ALL USING (app_security.can_access_city(city_id)) WITH CHECK (app_security.can_access_city(city_id))',
        policy_table
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  policy_table TEXT;
BEGIN
  FOREACH policy_table IN ARRAY ARRAY[
    'accounts',
    'journal_entries',
    'agents',
    'intermediary_deposits'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = policy_table
        AND policyname = 'nullable_city_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY nullable_city_isolation ON %I FOR ALL USING (city_id IS NULL OR app_security.can_access_city(city_id)) WITH CHECK (city_id IS NULL OR app_security.can_access_city(city_id))',
        policy_table
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'city_transfers'
      AND policyname = 'city_transfer_isolation'
  ) THEN
    CREATE POLICY city_transfer_isolation ON "city_transfers"
      FOR ALL
      USING (
        app_security.can_access_city(from_city_id)
        OR app_security.can_access_city(to_city_id)
      )
      WITH CHECK (
        app_security.can_access_city(from_city_id)
        OR app_security.can_access_city(to_city_id)
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_security.enable_city_rls()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_security
AS $$
DECLARE
  policy_table TEXT;
BEGIN
  FOREACH policy_table IN ARRAY ARRAY[
    'city_currencies',
    'customers',
    'godowns',
    'opening_cashes',
    'opening_haji_balances',
    'opening_stocks',
    'opening_bank_balances',
    'opening_cheques',
    'lot_city_distributions',
    'voucher_sequences',
    'sales',
    'payments',
    'expenses',
    'personal_withdrawals',
    'haji_transfers',
    'lot_settlement_overflows',
    'bank_accounts',
    'bank_deposits',
    'agent_payments',
    'audit_logs',
    'sync_requests',
    'inventory_thresholds',
    'accounts',
    'journal_entries',
    'agents',
    'intermediary_deposits',
    'city_transfers',
    'city_godown_permissions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', policy_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', policy_table);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION app_security.disable_city_rls()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_security
AS $$
DECLARE
  policy_table TEXT;
BEGIN
  FOREACH policy_table IN ARRAY ARRAY[
    'city_currencies',
    'customers',
    'godowns',
    'opening_cashes',
    'opening_haji_balances',
    'opening_stocks',
    'opening_bank_balances',
    'opening_cheques',
    'lot_city_distributions',
    'voucher_sequences',
    'sales',
    'payments',
    'expenses',
    'personal_withdrawals',
    'haji_transfers',
    'lot_settlement_overflows',
    'bank_accounts',
    'bank_deposits',
    'agent_payments',
    'audit_logs',
    'sync_requests',
    'inventory_thresholds',
    'accounts',
    'journal_entries',
    'agents',
    'intermediary_deposits',
    'city_transfers',
    'city_godown_permissions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', policy_table);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', policy_table);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION app_security.enable_city_rls()
IS 'Explicit activation step after ENABLE_PRISMA_RLS_CONTEXT=true is verified end-to-end; enables and forces city RLS on covered tables.';

COMMENT ON FUNCTION app_security.disable_city_rls()
IS 'Emergency rollback for city RLS activation; removes FORCE and disables RLS on covered tables.';

CREATE OR REPLACE FUNCTION app_security.city_rls_status()
RETURNS TABLE (
  table_name TEXT,
  rls_enabled BOOLEAN,
  rls_forced BOOLEAN,
  policy_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH covered_tables(table_name) AS (
    VALUES
      ('city_currencies'),
      ('customers'),
      ('godowns'),
      ('opening_cashes'),
      ('opening_haji_balances'),
      ('opening_stocks'),
      ('opening_bank_balances'),
      ('opening_cheques'),
      ('lot_city_distributions'),
      ('voucher_sequences'),
      ('sales'),
      ('payments'),
      ('expenses'),
      ('personal_withdrawals'),
      ('haji_transfers'),
      ('lot_settlement_overflows'),
      ('bank_accounts'),
      ('bank_deposits'),
      ('agent_payments'),
      ('audit_logs'),
      ('sync_requests'),
      ('inventory_thresholds'),
      ('accounts'),
      ('journal_entries'),
      ('agents'),
      ('intermediary_deposits'),
      ('city_transfers'),
      ('city_godown_permissions')
  )
  SELECT
    covered_tables.table_name,
    pg_class.relrowsecurity AS rls_enabled,
    pg_class.relforcerowsecurity AS rls_forced,
    COUNT(pg_policies.policyname) AS policy_count
  FROM covered_tables
  JOIN pg_class ON pg_class.relname = covered_tables.table_name
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    AND pg_namespace.nspname = 'public'
  LEFT JOIN pg_policies ON pg_policies.schemaname = 'public'
    AND pg_policies.tablename = covered_tables.table_name
  GROUP BY covered_tables.table_name, pg_class.relrowsecurity, pg_class.relforcerowsecurity
  ORDER BY covered_tables.table_name
$$;

COMMENT ON FUNCTION app_security.city_rls_status()
IS 'Read-only checklist for covered city RLS tables: enabled flag, forced flag, and policy count.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'city_godown_permissions'
      AND policyname = 'city_godown_permission_isolation'
  ) THEN
    CREATE POLICY city_godown_permission_isolation ON "city_godown_permissions"
      FOR ALL
      USING (
        app_security.can_access_city(from_city_id)
        OR app_security.can_access_city(to_city_id)
      )
      WITH CHECK (
        app_security.can_access_city(from_city_id)
        OR app_security.can_access_city(to_city_id)
      );
  END IF;
END $$;
