-- Fresh-database baseline. Existing installations skip creation and continue to the compatibility migration.
DO $baseline$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    -- CreateEnum
    CREATE TYPE "UserRole" AS ENUM ('super_admin', 'city_admin');
    
    -- CreateEnum
    CREATE TYPE "LotStatus" AS ENUM ('ongoing', 'completed');
    
    -- CreateEnum
    CREATE TYPE "LotShipmentStatus" AS ENUM ('order_confirmed', 'production', 'at_tianjin_port', 'awaiting_departure', 'departed_tianjin', 'tianjin_to_karachi', 'arrived_karachi', 'customs_clearance', 'customs_cleared', 'karachi_to_lahore', 'arrived_warehouse', 'completed', 'delayed', 'on_hold', 'documents_pending', 'customs_hold', 'cancelled');
    
    -- CreateEnum
    CREATE TYPE "LotDocumentCategory" AS ENUM ('supplier_invoice', 'packing_list', 'bill_of_lading', 'gd_customs', 'freight_shipping', 'payment_proof', 'other');
    
    -- CreateEnum
    CREATE TYPE "SaleStatus" AS ENUM ('active', 'cancelled', 'marked_short');
    
    -- CreateEnum
    CREATE TYPE "PaymentStatus" AS ENUM ('active', 'cancelled');
    
    -- CreateEnum
    CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'cheque', 'bank_transfer', 'online');
    
    -- CreateEnum
    CREATE TYPE "PaymentDestination" AS ENUM ('haji', 'our_account');
    
    -- CreateEnum
    CREATE TYPE "AgentType" AS ENUM ('customs', 'transport', 'freight', 'other', 'clearing');
    
    -- CreateEnum
    CREATE TYPE "AgentPaymentMethod" AS ENUM ('cash', 'bank_transfer', 'online', 'cheque', 'intermediary', 'super_admin_cash');
    
    -- CreateEnum
    CREATE TYPE "CityTransferStatus" AS ENUM ('pending', 'approved', 'rejected');
    
    -- CreateEnum
    CREATE TYPE "HajiTransferType" AS ENUM ('direct', 'from_in_hand');
    
    -- CreateEnum
    CREATE TYPE "ChequeStatus" AS ENUM ('in_hand', 'deposited_to_bank', 'sent_to_haji', 'used_for_expense', 'used_for_liability', 'used_for_withdrawal', 'bounced');
    
    -- CreateEnum
    CREATE TYPE "HajiSourceType" AS ENUM ('cash_office', 'cheque', 'bank_transfer');
    
    -- CreateEnum
    CREATE TYPE "HajiSettlementDestination" AS ENUM ('standard', 'intermediary', 'super_admin_cash');
    
    -- CreateEnum
    CREATE TYPE "SuperAdminAccountKind" AS ENUM ('bank', 'cash');
    
    -- CreateEnum
    CREATE TYPE "IntermediarySourceType" AS ENUM ('city_cash', 'bank_account', 'super_admin_bank_account', 'super_admin_cash');
    
    -- CreateEnum
    CREATE TYPE "ExpensePaidFrom" AS ENUM ('cash_office', 'bank_account', 'cheque', 'customer');
    
    -- CreateEnum
    CREATE TYPE "WithdrawalSourceType" AS ENUM ('cash_office', 'cheque', 'bank_account', 'customer');
    
    -- CreateEnum
    CREATE TYPE "SupplierPaymentMethod" AS ENUM ('bank_transfer', 'tt', 'lc', 'cash', 'other');
    
    -- CreateEnum
    CREATE TYPE "LotCostType" AS ENUM ('purchase_price', 'freight', 'customs_duty', 'port_charges', 'transport', 'loading_unloading', 'insurance', 'customs_agent', 'clearing_agent', 'other');
    
    -- CreateEnum
    CREATE TYPE "LotCostAllocationBasis" AS ENUM ('purchase_value', 'weight', 'cartons', 'specific_product');
    
    -- CreateEnum
    CREATE TYPE "OpeningLiabilityType" AS ENUM ('supplier', 'shipping_line', 'agent', 'intermediary');
    
    -- CreateEnum
    CREATE TYPE "OpeningPartyBalanceSide" AS ENUM ('payable', 'receivable');
    
    -- CreateEnum
    CREATE TYPE "OpeningHajiBalanceSide" AS ENUM ('payable', 'receivable');
    
    -- CreateEnum
    CREATE TYPE "OpeningEquityType" AS ENUM ('manager_capital', 'retained_earnings', 'other');
    
    -- CreateEnum
    CREATE TYPE "OpeningCutoverStatus" AS ENUM ('draft', 'finalized', 'reversed');
    
    -- CreateEnum
    CREATE TYPE "OpeningCityPackageStatus" AS ENUM ('draft', 'submitted', 'returned', 'approved');
    
    -- CreateEnum
    CREATE TYPE "CityLiabilityEntryType" AS ENUM ('charge', 'payment');
    
    -- CreateEnum
    CREATE TYPE "CityLiabilityPaymentSource" AS ENUM ('cash_office', 'cheque', 'bank_account');
    
    -- CreateEnum
    CREATE TYPE "SuperAdminLiabilityPartyType" AS ENUM ('lender', 'creditor');
    
    -- CreateEnum
    CREATE TYPE "SuperAdminLiabilityEntryType" AS ENUM ('loan_received', 'liability_incurred', 'payment', 'reversal');
    
    -- CreateEnum
    CREATE TYPE "SuperAdminLiabilitySourceType" AS ENUM ('super_admin_bank', 'super_admin_cash', 'intermediary', 'city_bank', 'city_cash');
    
    -- CreateEnum
    CREATE TYPE "SuperAdminTransferType" AS ENUM ('same_currency', 'exchange');
    
    -- CreateEnum
    CREATE TYPE "EntityType" AS ENUM ('sale', 'payment', 'godown_transfer', 'expense', 'haji_transfer');
    
    -- CreateEnum
    CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete', 'cancel', 'restore', 'hard_delete');
    
    -- CreateEnum
    CREATE TYPE "ExchangeRateEntryMethod" AS ENUM ('manual', 'api');
    
    -- CreateEnum
    CREATE TYPE "ForeignCurrencyPositionKind" AS ENUM ('asset', 'liability');
    
    -- CreateEnum
    CREATE TYPE "ForeignCurrencyPositionType" AS ENUM ('customer_receivable', 'city_cash', 'city_bank', 'super_admin_cash', 'super_admin_bank', 'intermediary_balance', 'supplier_payable', 'shipping_payable', 'other_receivable', 'other_payable');
    
    -- CreateEnum
    CREATE TYPE "ForeignCurrencyLayerStatus" AS ENUM ('open', 'closed', 'reversed');
    
    -- CreateEnum
    CREATE TYPE "ForeignCurrencyMovementType" AS ENUM ('recognition', 'transfer', 'settlement', 'exchange', 'revaluation', 'reversal');
    
    -- CreateEnum
    CREATE TYPE "ProductUnitOfMeasure" AS ENUM ('MT', 'PCS');
    
    -- CreateEnum
    CREATE TYPE "AccountType" AS ENUM ('asset', 'liability', 'revenue', 'expense', 'equity', 'cogs');
    
    -- CreateEnum
    CREATE TYPE "FinancialYearStatus" AS ENUM ('open', 'closed');
    
    -- CreateEnum
    CREATE TYPE "InvestorProfitType" AS ENUM ('fixed_rate', 'profit_share');
    
    -- CreateEnum
    CREATE TYPE "InvestmentParticipantType" AS ENUM ('manager', 'investor');
    
    -- CreateEnum
    CREATE TYPE "InvestmentCapitalEventType" AS ENUM ('opening', 'capital_contribution', 'capital_withdrawal', 'profit_reinvestment', 'full_exit');
    
    -- CreateEnum
    CREATE TYPE "ProfitAttributionPeriodStatus" AS ENUM ('preview', 'finalized', 'reversed', 'voided');
    
    -- CreateEnum
    CREATE TYPE "InvestorAttributionLedgerCategory" AS ENUM ('investor_profit', 'investor_capital_loss', 'manager_own_capital', 'manager_profit_share', 'manager_residual');
    
    -- CreateEnum
    CREATE TYPE "InvestorAttributionLedgerEntryType" AS ENUM ('finalization', 'reversal');
    
    -- CreateEnum
    CREATE TYPE "InvestmentParticipantActionType" AS ENUM ('profit_withdrawal', 'capital_withdrawal', 'mixed_withdrawal', 'profit_reinvestment', 'full_exit', 'reversal');
    
    -- CreateEnum
    CREATE TYPE "InvestmentParticipantActionStatus" AS ENUM ('active', 'reversed');
    
    -- CreateEnum
    CREATE TYPE "InvestmentParticipantActionLedgerCategory" AS ENUM ('finalized_profit_withdrawal', 'capital_withdrawal', 'profit_reinvestment', 'full_exit_profit', 'full_exit_capital', 'reversal');
    
    -- CreateEnum
    CREATE TYPE "InvestmentParticipantSettlementStatus" AS ENUM ('unsettled', 'partially_settled', 'settled', 'reversed');
    
    -- CreateTable
    CREATE TABLE "countries" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(100) NOT NULL,
        "code" VARCHAR(10) NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "currencies" (
        "id" SERIAL NOT NULL,
        "code" VARCHAR(10) NOT NULL,
        "name" VARCHAR(100) NOT NULL,
        "symbol" VARCHAR(10) NOT NULL,
    
        CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "exchange_rates" (
        "id" SERIAL NOT NULL,
        "rate_date" DATE NOT NULL,
        "from_currency_id" INTEGER NOT NULL,
        "to_currency_id" INTEGER NOT NULL,
        "buy_rate" DECIMAL(18,6),
        "sell_rate" DECIMAL(18,6),
        "reference_rate" DECIMAL(18,6) NOT NULL,
        "source" VARCHAR(100) NOT NULL DEFAULT 'manual_open_market',
        "entry_method" "ExchangeRateEntryMethod" NOT NULL DEFAULT 'manual',
        "correction_of_id" INTEGER,
        "notes" TEXT,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "foreign_currency_carrying_layers" (
        "id" SERIAL NOT NULL,
        "position_kind" "ForeignCurrencyPositionKind" NOT NULL,
        "position_type" "ForeignCurrencyPositionType" NOT NULL,
        "owner_key" VARCHAR(160) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "source_type" VARCHAR(80) NOT NULL,
        "source_id" INTEGER NOT NULL,
        "source_line_key" VARCHAR(80) NOT NULL DEFAULT 'main',
        "recognition_date" DATE NOT NULL,
        "historical_pool_date" DATE NOT NULL,
        "original_foreign_amount" DECIMAL(18,4) NOT NULL,
        "remaining_foreign_amount" DECIMAL(18,4) NOT NULL,
        "original_carrying_amount_pkr" DECIMAL(18,2) NOT NULL,
        "remaining_carrying_amount_pkr" DECIMAL(18,2) NOT NULL,
        "recognition_rate_pkr" DECIMAL(18,8) NOT NULL,
        "rate_type" VARCHAR(40) NOT NULL,
        "rate_provider" VARCHAR(120) NOT NULL,
        "rate_reference" VARCHAR(240),
        "conversion_path_json" JSONB,
        "parent_layer_id" INTEGER,
        "status" "ForeignCurrencyLayerStatus" NOT NULL DEFAULT 'open',
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "foreign_currency_carrying_layers_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "foreign_currency_movements" (
        "id" SERIAL NOT NULL,
        "movement_type" "ForeignCurrencyMovementType" NOT NULL,
        "source_type" VARCHAR(80) NOT NULL,
        "source_id" INTEGER NOT NULL,
        "source_line_key" VARCHAR(80) NOT NULL DEFAULT 'main',
        "movement_date" DATE NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "source_layer_id" INTEGER,
        "target_layer_id" INTEGER,
        "foreign_amount" DECIMAL(18,4) NOT NULL,
        "carrying_amount_pkr" DECIMAL(18,2) NOT NULL,
        "settlement_amount_pkr" DECIMAL(18,2),
        "realized_fx_pkr" DECIMAL(18,2) NOT NULL DEFAULT 0,
        "historical_pool_date" DATE NOT NULL,
        "rate_pkr" DECIMAL(18,8),
        "rate_type" VARCHAR(40),
        "rate_provider" VARCHAR(120),
        "rate_reference" VARCHAR(240),
        "conversion_path_json" JSONB,
        "journal_transaction_id" VARCHAR(120),
        "reversal_of_id" INTEGER,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "foreign_currency_movements_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "sarafi_af_fx_snapshots" (
        "id" SERIAL NOT NULL,
        "snapshot_date" DATE NOT NULL,
        "scheduled_time" VARCHAR(20) NOT NULL DEFAULT '08:30',
        "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Kabul',
        "provider" VARCHAR(80) NOT NULL DEFAULT 'SARAFI_AF',
        "market" VARCHAR(120) NOT NULL DEFAULT 'sarai_shahzada',
        "provider_mode" VARCHAR(80) NOT NULL DEFAULT 'FOUNDATION_ONLY',
        "fetched_at" TIMESTAMP(3) NOT NULL,
        "source_timestamp" TIMESTAMP(3),
        "source_age_minutes" INTEGER,
        "status" VARCHAR(80) NOT NULL,
        "raw_reference" VARCHAR(240),
        "raw_payload_hash" VARCHAR(120),
        "validation_warnings_json" JSONB,
        "idempotency_key" VARCHAR(240) NOT NULL,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "sarafi_af_fx_snapshots_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "sarafi_af_fx_snapshot_quotes" (
        "id" SERIAL NOT NULL,
        "snapshot_id" INTEGER NOT NULL,
        "base_currency_id" INTEGER NOT NULL,
        "quote_currency_id" INTEGER NOT NULL,
        "raw_buy_rate" DECIMAL(18,8) NOT NULL,
        "raw_sell_rate" DECIMAL(18,8) NOT NULL,
        "raw_unit" VARCHAR(40) NOT NULL DEFAULT '1',
        "normalization_factor" DECIMAL(18,8) NOT NULL DEFAULT 1,
        "normalized_buy_rate" DECIMAL(18,8) NOT NULL,
        "normalized_sell_rate" DECIMAL(18,8) NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "sarafi_af_fx_snapshot_quotes_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "sarafi_af_fx_derived_rates" (
        "id" SERIAL NOT NULL,
        "snapshot_id" INTEGER NOT NULL,
        "from_currency_id" INTEGER NOT NULL,
        "to_currency_id" INTEGER NOT NULL,
        "buy_rate" DECIMAL(18,8) NOT NULL,
        "sell_rate" DECIMAL(18,8) NOT NULL,
        "conversion_path_json" JSONB NOT NULL,
        "source_rates_json" JSONB NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "sarafi_af_fx_derived_rates_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "sarafi_af_assisted_capture_drafts" (
        "id" SERIAL NOT NULL,
        "snapshot_date" DATE NOT NULL,
        "scheduled_time" VARCHAR(20) NOT NULL DEFAULT '08:30',
        "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Kabul',
        "provider" VARCHAR(80) NOT NULL DEFAULT 'SARAFI_AF',
        "market" VARCHAR(120) NOT NULL DEFAULT 'sarai_shahzada',
        "source_url" VARCHAR(500) NOT NULL,
        "fetched_at" TIMESTAMP(3) NOT NULL,
        "source_timestamp" TIMESTAMP(3) NOT NULL,
        "status" VARCHAR(80) NOT NULL DEFAULT 'PENDING_REVIEW',
        "raw_payload_hash" VARCHAR(64) NOT NULL,
        "raw_html_storage_key" VARCHAR(500),
        "screenshot_storage_key" VARCHAR(500),
        "evidence_expires_at" TIMESTAMP(3) NOT NULL,
        "evidence_deleted_at" TIMESTAMP(3),
        "quotes_json" JSONB NOT NULL,
        "validation_warnings_json" JSONB,
        "idempotency_key" VARCHAR(240) NOT NULL,
        "reviewed_by" INTEGER,
        "reviewed_at" TIMESTAMP(3),
        "review_notes" TEXT,
        "approved_snapshot_id" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "sarafi_af_assisted_capture_drafts_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "sbp_daily_fx_snapshots" (
        "id" SERIAL NOT NULL,
        "rate_date" DATE NOT NULL,
        "provider" VARCHAR(80) NOT NULL DEFAULT 'SBP',
        "market" VARCHAR(120) NOT NULL DEFAULT 'weighted_average_customer',
        "source_url" VARCHAR(500) NOT NULL,
        "fetched_at" TIMESTAMP(3) NOT NULL,
        "buy_rate" DECIMAL(18,6) NOT NULL,
        "sell_rate" DECIMAL(18,6) NOT NULL,
        "reference_rate" DECIMAL(18,6) NOT NULL,
        "status" VARCHAR(80) NOT NULL,
        "raw_payload_hash" VARCHAR(64) NOT NULL,
        "raw_html_storage_key" VARCHAR(500),
        "screenshot_storage_key" VARCHAR(500),
        "evidence_expires_at" TIMESTAMP(3) NOT NULL,
        "evidence_deleted_at" TIMESTAMP(3),
        "exchange_rate_id" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "sbp_daily_fx_snapshots_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "country_fallback_exchange_rates" (
        "id" SERIAL NOT NULL,
        "country_id" INTEGER NOT NULL,
        "from_currency_id" INTEGER NOT NULL,
        "to_currency_id" INTEGER NOT NULL,
        "rate" DECIMAL(18,6) NOT NULL,
        "effective_from" DATE NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "notes" TEXT,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "country_fallback_exchange_rates_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "cities" (
        "id" SERIAL NOT NULL,
        "country_id" INTEGER NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "city_godown_permissions" (
        "id" SERIAL NOT NULL,
        "from_city_id" INTEGER NOT NULL,
        "to_city_id" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "city_godown_permissions_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "city_currencies" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
    
        CONSTRAINT "city_currencies_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "users" (
        "id" SERIAL NOT NULL,
        "username" VARCHAR(100) NOT NULL,
        "password_hash" VARCHAR(255) NOT NULL,
        "full_name" VARCHAR(200) NOT NULL,
        "role" "UserRole" NOT NULL,
        "city_id" INTEGER,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "users_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "user_sessions" (
        "id" TEXT NOT NULL,
        "user_id" INTEGER NOT NULL,
        "token_hash" VARCHAR(255) NOT NULL,
        "device_info" VARCHAR(500),
        "ip_address" VARCHAR(50),
        "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expires_at" TIMESTAMP(3) NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "app_branding" (
        "id" INTEGER NOT NULL,
        "system_name" VARCHAR(120) NOT NULL DEFAULT 'MRF Hardware',
        "logo_url" TEXT,
        "updated_by" INTEGER,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "app_branding_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "products" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "unit_of_measure" "ProductUnitOfMeasure" NOT NULL DEFAULT 'MT',
        "default_weight_per_carton_kg" DECIMAL(10,3),
        "packets_per_carton" INTEGER,
        "pieces_per_carton" INTEGER,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "products_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "godowns" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "godowns_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "godown_transfers" (
        "id" SERIAL NOT NULL,
        "from_godown_id" INTEGER NOT NULL,
        "to_godown_id" INTEGER NOT NULL,
        "product_id" INTEGER NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "qty" DECIMAL(12,2) NOT NULL,
        "transfer_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "godown_transfers_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "customers" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "phone" VARCHAR(50),
        "address" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "portal_access_enabled" BOOLEAN NOT NULL DEFAULT false,
        "portal_username" VARCHAR(100),
        "portal_password_hash" VARCHAR(255),
        "portal_last_login_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_cashes" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "carrying_amount_pkr" DECIMAL(15,2),
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(120),
        "fx_rate_metadata" JSONB,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_cashes_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_haji_balances" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "balance_side" "OpeningHajiBalanceSide" NOT NULL DEFAULT 'payable',
        "carrying_amount_pkr" DECIMAL(15,2),
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(120),
        "fx_rate_metadata" JSONB,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_haji_balances_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_customer_balances" (
        "id" SERIAL NOT NULL,
        "customer_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "carrying_amount_pkr" DECIMAL(15,2),
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(120),
        "fx_rate_metadata" JSONB,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_customer_balances_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_stocks" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "godown_id" INTEGER NOT NULL,
        "product_id" INTEGER NOT NULL,
        "qty" DECIMAL(12,2) NOT NULL,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_stocks_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_bank_balances" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "bank_account_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "carrying_amount_pkr" DECIMAL(15,2),
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(120),
        "fx_rate_metadata" JSONB,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_bank_balances_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_cheques" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "customer_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "carrying_amount_pkr" DECIMAL(15,2),
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(120),
        "fx_rate_metadata" JSONB,
        "cheque_number" VARCHAR(50) NOT NULL,
        "cheque_bank" VARCHAR(100),
        "cheque_due_date" DATE,
        "cheque_status" "ChequeStatus" NOT NULL DEFAULT 'in_hand',
        "bank_deposit_id" INTEGER,
        "bounced_at" TIMESTAMP(3),
        "bounced_by" INTEGER,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_cheques_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_inventory_valuations" (
        "id" SERIAL NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "product_id" INTEGER NOT NULL,
        "quantity" DECIMAL(15,4) NOT NULL,
        "unit_cost_pkr" DECIMAL(18,6) NOT NULL,
        "total_value_pkr" DECIMAL(15,2) NOT NULL,
        "original_currency_id" INTEGER,
        "original_amount" DECIMAL(15,4),
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(120),
        "fx_rate_metadata" JSONB,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_inventory_valuations_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_super_admin_account_balances" (
        "id" SERIAL NOT NULL,
        "account_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "carrying_amount_pkr" DECIMAL(15,2) NOT NULL,
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(120),
        "fx_rate_metadata" JSONB,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_super_admin_account_balances_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_equity_allocations" (
        "id" SERIAL NOT NULL,
        "equity_type" "OpeningEquityType" NOT NULL,
        "label" VARCHAR(160) NOT NULL,
        "amount_pkr" DECIMAL(15,2) NOT NULL,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_equity_allocations_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
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
        "previous_snapshot_hash" CHAR(64),
        "final_snapshot_hash" CHAR(64),
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
    
    -- CreateTable
    CREATE TABLE "opening_city_packages" (
        "id" SERIAL NOT NULL,
        "cutover_id" INTEGER NOT NULL,
        "city_id" INTEGER NOT NULL,
        "status" "OpeningCityPackageStatus" NOT NULL DEFAULT 'draft',
        "return_reason" TEXT,
        "submitted_by" INTEGER,
        "submitted_at" TIMESTAMP(3),
        "returned_by" INTEGER,
        "returned_at" TIMESTAMP(3),
        "approved_by" INTEGER,
        "approved_at" TIMESTAMP(3),
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_city_packages_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_city_due_balances" (
        "id" SERIAL NOT NULL,
        "package_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "city_amount" DECIMAL(20,6),
        "city_carrying_pkr" DECIMAL(15,2),
        "central_amount" DECIMAL(20,6),
        "central_carrying_pkr" DECIMAL(15,2),
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(100),
        "fx_rate_metadata" JSONB,
        "city_recorded_by" INTEGER,
        "city_recorded_at" TIMESTAMP(3),
        "central_recorded_by" INTEGER,
        "central_recorded_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_city_due_balances_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_cutover_entries" (
        "id" SERIAL NOT NULL,
        "cutover_id" INTEGER NOT NULL,
        "entity_type" VARCHAR(80) NOT NULL,
        "entity_id" INTEGER NOT NULL,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "opening_cutover_entries_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
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
    
    -- CreateTable
    CREATE TABLE "lots" (
        "id" SERIAL NOT NULL,
        "country_id" INTEGER NOT NULL,
        "consignee_id" INTEGER,
        "destination_city_id" INTEGER,
        "lot_number" VARCHAR(50) NOT NULL,
        "lot_date" DATE NOT NULL,
        "notes" TEXT,
        "pkr_exchange_rate" DECIMAL(12,4),
        "pkr_exchange_rate_metadata" JSONB,
        "status" "LotStatus" NOT NULL DEFAULT 'ongoing',
        "shipment_status" "LotShipmentStatus" NOT NULL DEFAULT 'order_confirmed',
        "eta_date" DATE,
        "is_legacy_stock" BOOLEAN NOT NULL DEFAULT false,
        "created_by" INTEGER NOT NULL,
        "completed_by" INTEGER,
        "completed_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "consignees" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "country_id" INTEGER,
        "city_id" INTEGER,
        "phone" VARCHAR(100),
        "address" TEXT,
        "notes" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "consignees_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "lot_documents" (
        "id" SERIAL NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "category" "LotDocumentCategory" NOT NULL DEFAULT 'other',
        "original_file_name" VARCHAR(500) NOT NULL,
        "storage_key" VARCHAR(1000) NOT NULL,
        "file_url" VARCHAR(1000) NOT NULL,
        "mime_type" VARCHAR(200) NOT NULL,
        "extension" VARCHAR(20) NOT NULL,
        "file_size" INTEGER NOT NULL,
        "reference_no" VARCHAR(100),
        "document_date" DATE,
        "note" TEXT,
        "uploaded_by" INTEGER NOT NULL,
        "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "archived_at" TIMESTAMP(3),
        "archived_by" INTEGER,
    
        CONSTRAINT "lot_documents_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "lot_status_history" (
        "id" SERIAL NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "previous_status" "LotShipmentStatus",
        "new_status" "LotShipmentStatus" NOT NULL,
        "effective_at" TIMESTAMP(3) NOT NULL,
        "location" VARCHAR(200),
        "note" TEXT,
        "changed_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "lot_status_history_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "lot_products" (
        "id" SERIAL NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "product_id" INTEGER NOT NULL,
        "total_qty" DECIMAL(12,2) NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "lot_products_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "lot_city_distributions" (
        "id" SERIAL NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "city_id" INTEGER NOT NULL,
        "product_id" INTEGER NOT NULL,
        "allocated_qty" DECIMAL(12,2) NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "lot_city_distributions_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "lot_city_godown_allocations" (
        "id" SERIAL NOT NULL,
        "lot_city_distribution_id" INTEGER NOT NULL,
        "godown_id" INTEGER NOT NULL,
        "product_id" INTEGER NOT NULL,
        "qty" DECIMAL(12,2) NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "lot_city_godown_allocations_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "voucher_sequences" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "current_number" INTEGER NOT NULL DEFAULT 0,
    
        CONSTRAINT "voucher_sequences_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "sales" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "customer_id" INTEGER NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "godown_id" INTEGER NOT NULL,
        "voucher_no" VARCHAR(10) NOT NULL,
        "sale_date" DATE NOT NULL,
        "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "currency_id" INTEGER NOT NULL,
        "fx_snapshot_id" INTEGER,
        "fx_original_currency_code" VARCHAR(10),
        "fx_original_amount" DECIMAL(15,2),
        "fx_selected_rate" DECIMAL(18,6),
        "fx_selected_rate_type" VARCHAR(40),
        "fx_provider" VARCHAR(120),
        "fx_provider_reference" VARCHAR(240),
        "fx_pkr_equivalent" DECIMAL(15,2),
        "fx_conversion_path_json" JSONB,
        "notes" TEXT,
        "status" "SaleStatus" NOT NULL DEFAULT 'active',
        "is_opening_import" BOOLEAN NOT NULL DEFAULT false,
        "stock_short_flag" BOOLEAN NOT NULL DEFAULT false,
        "cancellation_reason" TEXT,
        "cancelled_at" TIMESTAMP(3),
        "cancelled_by" INTEGER,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "sale_items" (
        "id" SERIAL NOT NULL,
        "sale_id" INTEGER NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "product_id" INTEGER NOT NULL,
        "qty" DECIMAL(12,2) NOT NULL,
        "carton_qty" DECIMAL(12,2),
        "rate_per_carton" DECIMAL(12,2) NOT NULL,
        "rate_per_piece_local" DECIMAL(12,4),
        "rate_per_piece_usd" DECIMAL(12,4),
        "amount" DECIMAL(15,2) NOT NULL,
        "amount_usd" DECIMAL(15,2),
    
        CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "sale_discounts" (
        "id" SERIAL NOT NULL,
        "sale_id" INTEGER NOT NULL,
        "discount_amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "applied_to_lot_id" INTEGER NOT NULL,
        "notes" TEXT,
        "discount_date" DATE NOT NULL,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "sale_discounts_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "payments" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "customer_id" INTEGER NOT NULL,
        "lot_id" INTEGER,
        "payment_date" DATE NOT NULL,
        "detail" VARCHAR(500) NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "exchange_rate" DECIMAL(12,4),
        "usd_equivalent" DECIMAL(15,2),
        "manual_voucher_no" VARCHAR(50),
        "payment_method" "PaymentMethod" NOT NULL,
        "destination" "PaymentDestination" NOT NULL,
        "notes" TEXT,
        "status" "PaymentStatus" NOT NULL DEFAULT 'active',
        "cancellation_reason" TEXT,
        "cancelled_at" TIMESTAMP(3),
        "cancelled_by" INTEGER,
        "cheque_number" VARCHAR(50),
        "cheque_bank" VARCHAR(100),
        "cheque_due_date" DATE,
        "cheque_status" "ChequeStatus",
        "bank_deposit_id" INTEGER,
        "bank_account_id" INTEGER,
        "super_admin_bank_account_id" INTEGER,
        "sale_id" INTEGER,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "payment_lot_transfers" (
        "id" SERIAL NOT NULL,
        "payment_id" INTEGER NOT NULL,
        "from_lot_id" INTEGER NOT NULL,
        "to_lot_id" INTEGER NOT NULL,
        "transferred_by" INTEGER NOT NULL,
        "notes" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "payment_lot_transfers_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "expenses" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "expense_date" DATE NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "detail" VARCHAR(500) NOT NULL,
        "notes" TEXT,
        "paid_from" "ExpensePaidFrom" NOT NULL DEFAULT 'cash_office',
        "bank_account_id" INTEGER,
        "cheque_payment_id" INTEGER,
        "customer_payment_id" INTEGER,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        "deleted_at" TIMESTAMP(3),
    
        CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "personal_withdrawals" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "withdrawal_date" DATE NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "detail" VARCHAR(500) NOT NULL,
        "withdrawn_by" VARCHAR(100),
        "notes" TEXT,
        "source_type" "WithdrawalSourceType" NOT NULL DEFAULT 'cash_office',
        "cheque_payment_id" INTEGER,
        "bank_account_id" INTEGER,
        "customer_payment_id" INTEGER,
        "approved_by" INTEGER,
        "approved_at" TIMESTAMP(3),
        "haji_transfer_id" INTEGER,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "personal_withdrawals_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "withdrawee_names" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "name" VARCHAR(100) NOT NULL,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "withdrawee_names_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "haji_transfers" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "lot_id" INTEGER,
        "transfer_date" DATE NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "detail" VARCHAR(500) NOT NULL,
        "reference_no" VARCHAR(50),
        "transfer_type" "HajiTransferType" NOT NULL,
        "transferred_to" VARCHAR(100),
        "notes" TEXT,
        "source_type" "HajiSourceType" NOT NULL DEFAULT 'cash_office',
        "settlement_destination" "HajiSettlementDestination" NOT NULL DEFAULT 'standard',
        "intermediary_id" INTEGER,
        "super_admin_cash_account_id" INTEGER,
        "super_admin_bank_account_id" INTEGER,
        "bank_account_id" INTEGER,
        "cheque_payment_id" INTEGER,
        "payment_id" INTEGER,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "haji_transfers_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "lot_settlement_overflows" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "from_lot_id" INTEGER NOT NULL,
        "to_lot_id" INTEGER NOT NULL,
        "overflow_amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "lot_settlement_overflows_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "lot_settlement_unresolved_overflows" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "from_lot_id" INTEGER NOT NULL,
        "overflow_amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "resolved_at" TIMESTAMP(3),
        "resolved_by" INTEGER,
        "resolution_notes" TEXT,
    
        CONSTRAINT "lot_settlement_unresolved_overflows_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "bank_accounts" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "bank_name" VARCHAR(100) NOT NULL,
        "account_number" VARCHAR(255),
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "bank_deposits" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "bank_account_id" INTEGER,
        "transfer_type" VARCHAR(30) NOT NULL DEFAULT 'cheque_to_bank',
        "transfer_pair_id" VARCHAR(50),
        "deposit_date" DATE NOT NULL,
        "slip_number" VARCHAR(50),
        "cash_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "currency_id" INTEGER NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "bank_deposits_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "super_admin_bank_accounts" (
        "id" SERIAL NOT NULL,
        "bank_name" VARCHAR(100) NOT NULL,
        "account_number" VARCHAR(255),
        "currency_id" INTEGER NOT NULL,
        "account_kind" "SuperAdminAccountKind" NOT NULL DEFAULT 'bank',
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "super_admin_bank_accounts_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "super_admin_personal_expenses" (
        "id" SERIAL NOT NULL,
        "bank_account_id" INTEGER NOT NULL,
        "expense_date" DATE NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "detail" VARCHAR(500) NOT NULL,
        "notes" TEXT,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        "deleted_at" TIMESTAMP(3),
    
        CONSTRAINT "super_admin_personal_expenses_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
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
    
        CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "accounts" (
        "id" SERIAL NOT NULL,
        "code" VARCHAR(20) NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "account_type" "AccountType" NOT NULL,
        "parent_id" INTEGER,
        "city_id" INTEGER,
        "currency_code" VARCHAR(10),
        "is_system" BOOLEAN NOT NULL DEFAULT false,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "journal_entries" (
        "id" SERIAL NOT NULL,
        "transaction_id" VARCHAR(50) NOT NULL,
        "line_number" INTEGER NOT NULL,
        "account_id" INTEGER NOT NULL,
        "debit" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "credit" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "currency_code" VARCHAR(10) NOT NULL,
        "exchange_rate" DECIMAL(12,4),
        "description" VARCHAR(500) NOT NULL,
        "entity_type" VARCHAR(50),
        "entity_id" INTEGER,
        "lot_id" INTEGER,
        "city_id" INTEGER,
        "entry_date" DATE NOT NULL,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "agents" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "agent_type" "AgentType" NOT NULL,
        "city_id" INTEGER,
        "phone" VARCHAR(50),
        "notes" TEXT,
        "account_id" INTEGER,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "agent_payments" (
        "id" SERIAL NOT NULL,
        "agent_id" INTEGER NOT NULL,
        "city_id" INTEGER NOT NULL,
        "payment_date" DATE NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "currency_code" VARCHAR(10) NOT NULL,
        "payment_method" "AgentPaymentMethod" NOT NULL,
        "bank_account_id" INTEGER,
        "super_admin_bank_account_id" INTEGER,
        "intermediary_id" INTEGER,
        "super_admin_cash_account_id" INTEGER,
        "reference" VARCHAR(200),
        "notes" TEXT,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        "deleted_at" TIMESTAMP(3),
        "deleted_by" INTEGER,
    
        CONSTRAINT "agent_payments_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "city_transfers" (
        "id" SERIAL NOT NULL,
        "batch_id" VARCHAR(64),
        "from_city_id" INTEGER NOT NULL,
        "to_city_id" INTEGER NOT NULL,
        "from_godown_id" INTEGER NOT NULL,
        "to_godown_id" INTEGER,
        "product_id" INTEGER NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "qty" DECIMAL(12,2) NOT NULL,
        "status" "CityTransferStatus" NOT NULL DEFAULT 'pending',
        "notes" TEXT,
        "approval_notes" TEXT,
        "sent_by" INTEGER NOT NULL,
        "approved_by" INTEGER,
        "transfer_date" DATE NOT NULL,
        "approved_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "city_transfers_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "suppliers" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "country" VARCHAR(100),
        "contact" VARCHAR(200),
        "notes" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "lot_purchases" (
        "id" SERIAL NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "supplier_id" INTEGER NOT NULL,
        "product_id" INTEGER NOT NULL,
        "qty" DECIMAL(12,3) NOT NULL,
        "weight_per_carton_kg" DECIMAL(10,3),
        "unit_price_usd" DECIMAL(12,4) NOT NULL,
        "total_price_usd" DECIMAL(15,2) NOT NULL,
        "exchange_rate" DECIMAL(12,4),
        "carrying_rate_pkr" DECIMAL(12,6),
        "carrying_amount_pkr" DECIMAL(15,2),
        "recognition_date" DATE,
        "recognition_rate_metadata" JSONB,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "lot_purchases_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "lot_costs" (
        "id" SERIAL NOT NULL,
        "lot_id" INTEGER NOT NULL,
        "cost_type" "LotCostType" NOT NULL,
        "allocation_basis" "LotCostAllocationBasis" NOT NULL DEFAULT 'cartons',
        "allocated_product_id" INTEGER,
        "description" VARCHAR(500) NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "currency_code" VARCHAR(10) NOT NULL DEFAULT 'USD',
        "exchange_rate" DECIMAL(12,4),
        "cost_date" DATE,
        "supplier_id" INTEGER,
        "agent_id" INTEGER,
        "shipping_line_id" INTEGER,
        "bank_account_id" INTEGER,
        "super_admin_bank_account_id" INTEGER,
        "intermediary_id" INTEGER,
        "paid_from_cash" BOOLEAN NOT NULL DEFAULT false,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "lot_costs_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "supplier_payments" (
        "id" SERIAL NOT NULL,
        "supplier_id" INTEGER NOT NULL,
        "lot_id" INTEGER,
        "bank_account_id" INTEGER,
        "super_admin_bank_account_id" INTEGER,
        "super_admin_cash_account_id" INTEGER,
        "intermediary_id" INTEGER,
        "payment_date" DATE NOT NULL,
        "amount_usd" DECIMAL(15,2) NOT NULL,
        "exchange_rate" DECIMAL(12,4),
        "amount_local" DECIMAL(15,2),
        "carrying_rate_pkr" DECIMAL(12,6),
        "carrying_amount_pkr" DECIMAL(15,2),
        "realized_fx_pkr" DECIMAL(15,2),
        "fx_pool_date" DATE,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "payment_method" "SupplierPaymentMethod" NOT NULL,
        "reference" VARCHAR(200),
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        "deleted_at" TIMESTAMP(3),
        "deleted_by" INTEGER,
    
        CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "shipping_lines" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "contact" VARCHAR(200),
        "notes" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "shipping_lines_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "shipping_line_payments" (
        "id" SERIAL NOT NULL,
        "shipping_line_id" INTEGER NOT NULL,
        "lot_id" INTEGER,
        "bank_account_id" INTEGER,
        "super_admin_bank_account_id" INTEGER,
        "payment_date" DATE NOT NULL,
        "amount_usd" DECIMAL(15,2) NOT NULL,
        "exchange_rate" DECIMAL(12,4),
        "amount_pkr" DECIMAL(15,2),
        "carrying_rate_pkr" DECIMAL(12,6),
        "carrying_amount_pkr" DECIMAL(15,2),
        "realized_fx_pkr" DECIMAL(15,2),
        "fx_pool_date" DATE,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "reference" VARCHAR(200),
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        "deleted_at" TIMESTAMP(3),
        "deleted_by" INTEGER,
        "intermediary_id" INTEGER,
        "super_admin_cash_account_id" INTEGER,
    
        CONSTRAINT "shipping_line_payments_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "attachments" (
        "id" SERIAL NOT NULL,
        "entity_type" "EntityType" NOT NULL,
        "entity_id" INTEGER NOT NULL,
        "file_name" VARCHAR(500) NOT NULL,
        "file_path" VARCHAR(1000) NOT NULL,
        "file_type" VARCHAR(20) NOT NULL,
        "file_size" INTEGER NOT NULL,
        "uploaded_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "sale_entity_id" INTEGER,
        "payment_entity_id" INTEGER,
        "godown_transfer_entity_id" INTEGER,
        "expense_entity_id" INTEGER,
        "haji_transfer_entity_id" INTEGER,
    
        CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "audit_logs" (
        "id" SERIAL NOT NULL,
        "user_id" INTEGER NOT NULL,
        "city_id" INTEGER,
        "entity_type" VARCHAR(100) NOT NULL,
        "entity_id" INTEGER NOT NULL,
        "action" "AuditAction" NOT NULL,
        "old_values" JSONB,
        "new_values" JSONB,
        "ip_address" VARCHAR(50),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "sync_requests" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "module" VARCHAR(80) NOT NULL,
        "request_id" VARCHAR(120) NOT NULL,
        "device_id" VARCHAR(120),
        "entity_type" VARCHAR(80),
        "entity_id" INTEGER,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "sync_requests_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "inventory_thresholds" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "product_id" INTEGER NOT NULL,
        "min_qty" DECIMAL(12,2) NOT NULL,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "inventory_thresholds_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investors" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "relationship" VARCHAR(100),
        "phone" VARCHAR(50),
        "notes" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "investors_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investor_accounts" (
        "id" SERIAL NOT NULL,
        "investor_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "profit_type" "InvestorProfitType" NOT NULL DEFAULT 'fixed_rate',
        "fixed_rate_percent" DECIMAL(6,3),
        "profit_share_percent" DECIMAL(6,3),
        "start_date" DATE NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "investor_accounts_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investor_deposits" (
        "id" SERIAL NOT NULL,
        "account_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "deposit_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investor_deposits_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investor_withdrawals" (
        "id" SERIAL NOT NULL,
        "account_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "withdrawal_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investor_withdrawals_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investment_participants" (
        "id" SERIAL NOT NULL,
        "investor_id" INTEGER,
        "name" VARCHAR(200) NOT NULL,
        "type" "InvestmentParticipantType" NOT NULL DEFAULT 'investor',
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "exited_at" DATE,
        "notes" TEXT,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "investment_participants_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investment_capital_events" (
        "id" SERIAL NOT NULL,
        "participant_id" INTEGER NOT NULL,
        "event_type" "InvestmentCapitalEventType" NOT NULL,
        "amount_pkr" DECIMAL(15,2) NOT NULL,
        "effective_date" DATE NOT NULL,
        "investor_profit_share_percent" DECIMAL(9,6),
        "manager_profit_share_percent" DECIMAL(9,6),
        "source_type" VARCHAR(80),
        "source_id" INTEGER,
        "reason" TEXT,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investment_capital_events_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investment_profit_share_events" (
        "id" SERIAL NOT NULL,
        "participant_id" INTEGER NOT NULL,
        "effective_date" DATE NOT NULL,
        "investor_profit_share_percent" DECIMAL(9,6) NOT NULL,
        "manager_profit_share_percent" DECIMAL(9,6) NOT NULL,
        "reference" VARCHAR(120),
        "remarks" TEXT,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investment_profit_share_events_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "profit_attribution_periods" (
        "id" SERIAL NOT NULL,
        "period_start" DATE NOT NULL,
        "period_end" DATE NOT NULL,
        "status" "ProfitAttributionPeriodStatus" NOT NULL DEFAULT 'preview',
        "business_profit_pkr" DECIMAL(15,2) NOT NULL,
        "total_attributed_pkr" DECIMAL(15,2) NOT NULL,
        "reconciliation_difference_pkr" DECIMAL(15,2) NOT NULL,
        "reconciliation_status" VARCHAR(30) NOT NULL,
        "finalization_disabled_reasons" JSONB,
        "source_report_reference" VARCHAR(200),
        "snapshot_json" JSONB,
        "posting_simulation_json" JSONB,
        "finalized_by" INTEGER,
        "finalized_at" TIMESTAMP(3),
        "reversed_by" INTEGER,
        "reversed_at" TIMESTAMP(3),
        "reversal_reason" TEXT,
        "reversal_of_period_id" INTEGER,
        "reconciliation_reference" VARCHAR(240),
        "idempotency_key" VARCHAR(240),
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "profit_attribution_periods_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "profit_attribution_lines" (
        "id" SERIAL NOT NULL,
        "period_id" INTEGER NOT NULL,
        "participant_id" INTEGER NOT NULL,
        "segment_start" DATE NOT NULL,
        "segment_end" DATE NOT NULL,
        "capital_pkr" DECIMAL(15,2) NOT NULL,
        "capital_percent" DECIMAL(9,6) NOT NULL,
        "pool_profit_pkr" DECIMAL(15,2) NOT NULL,
        "attributable_pkr" DECIMAL(15,2) NOT NULL,
        "investor_profit_share_percent" DECIMAL(9,6) NOT NULL,
        "manager_profit_share_percent" DECIMAL(9,6) NOT NULL,
        "investor_entitlement_pkr" DECIMAL(15,2) NOT NULL,
        "manager_own_capital_profit_pkr" DECIMAL(15,2) NOT NULL,
        "manager_share_pkr" DECIMAL(15,2) NOT NULL,
        "allocated_loss_pkr" DECIMAL(15,2) NOT NULL,
        "total_attributed_pkr" DECIMAL(15,2) NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "profit_attribution_lines_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investor_residual_attributions" (
        "id" SERIAL NOT NULL,
        "period_id" INTEGER NOT NULL,
        "original_participant_id" INTEGER NOT NULL,
        "manager_participant_id" INTEGER NOT NULL,
        "source_type" VARCHAR(80) NOT NULL,
        "source_id" INTEGER,
        "original_capital_percent" DECIMAL(9,6) NOT NULL,
        "original_attributable_pkr" DECIMAL(15,2) NOT NULL,
        "manager_assumption_pkr" DECIMAL(15,2) NOT NULL,
        "posting_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investor_residual_attributions_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investor_attribution_ledger_entries" (
        "id" SERIAL NOT NULL,
        "period_id" INTEGER NOT NULL,
        "participant_id" INTEGER NOT NULL,
        "category" "InvestorAttributionLedgerCategory" NOT NULL,
        "entry_type" "InvestorAttributionLedgerEntryType" NOT NULL,
        "amount_pkr" DECIMAL(15,2) NOT NULL,
        "debit_account" VARCHAR(160) NOT NULL,
        "credit_account" VARCHAR(160) NOT NULL,
        "source_pool" VARCHAR(500),
        "source_attribution_line" VARCHAR(200),
        "posting_type" VARCHAR(120) NOT NULL,
        "reconciliation_reference" VARCHAR(240) NOT NULL,
        "reversal_of_entry_id" INTEGER,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investor_attribution_ledger_entries_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investment_participant_actions" (
        "id" SERIAL NOT NULL,
        "participant_id" INTEGER NOT NULL,
        "action_type" "InvestmentParticipantActionType" NOT NULL,
        "status" "InvestmentParticipantActionStatus" NOT NULL DEFAULT 'active',
        "profit_amount_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "capital_amount_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "total_amount_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "settled_amount_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "remaining_settlement_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "settlement_status" "InvestmentParticipantSettlementStatus" NOT NULL DEFAULT 'unsettled',
        "effective_date" DATE NOT NULL,
        "old_capital_pkr" DECIMAL(15,2) NOT NULL,
        "new_capital_pkr" DECIMAL(15,2) NOT NULL,
        "old_available_profit_pkr" DECIMAL(15,2) NOT NULL,
        "new_available_profit_pkr" DECIMAL(15,2) NOT NULL,
        "finalized_profit_sources_json" JSONB,
        "confirmation_reference" VARCHAR(240) NOT NULL,
        "idempotency_key" VARCHAR(240) NOT NULL,
        "remarks" TEXT,
        "reversal_of_action_id" INTEGER,
        "reversal_reason" TEXT,
        "capital_event_id" INTEGER,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investment_participant_actions_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investment_participant_action_ledger_entries" (
        "id" SERIAL NOT NULL,
        "action_id" INTEGER NOT NULL,
        "participant_id" INTEGER NOT NULL,
        "category" "InvestmentParticipantActionLedgerCategory" NOT NULL,
        "amount_pkr" DECIMAL(15,2) NOT NULL,
        "debit_account" VARCHAR(160) NOT NULL,
        "credit_account" VARCHAR(160) NOT NULL,
        "source_finalization_ids" JSONB,
        "reconciliation_reference" VARCHAR(240) NOT NULL,
        "reversal_of_entry_id" INTEGER,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investment_participant_action_ledger_entries_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investment_participant_settlements" (
        "id" SERIAL NOT NULL,
        "action_id" INTEGER NOT NULL,
        "participant_id" INTEGER NOT NULL,
        "status" "InvestmentParticipantSettlementStatus" NOT NULL DEFAULT 'unsettled',
        "currency_id" INTEGER NOT NULL,
        "settlement_amount" DECIMAL(15,2) NOT NULL,
        "pkr_equivalent" DECIMAL(15,2) NOT NULL,
        "profit_component_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "capital_component_pkr" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "exchange_rate" DECIMAL(15,6),
        "fx_snapshot_id" INTEGER,
        "rate_source" VARCHAR(120),
        "rate_date" DATE,
        "selected_rate_type" VARCHAR(40),
        "provider_reference" VARCHAR(240),
        "conversion_path_json" JSONB,
        "payment_date" DATE NOT NULL,
        "payment_reference" VARCHAR(240) NOT NULL,
        "payment_method" VARCHAR(80) NOT NULL,
        "bank_cash_account" VARCHAR(200),
        "idempotency_key" VARCHAR(240) NOT NULL,
        "reversal_of_settlement_id" INTEGER,
        "reversal_reason" TEXT,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investment_participant_settlements_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "investment_participant_settlement_payments" (
        "id" SERIAL NOT NULL,
        "settlement_id" INTEGER NOT NULL,
        "action_id" INTEGER NOT NULL,
        "participant_id" INTEGER NOT NULL,
        "status" "InvestmentParticipantSettlementStatus" NOT NULL DEFAULT 'settled',
        "super_admin_bank_account_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "payment_amount" DECIMAL(15,2) NOT NULL,
        "pkr_equivalent" DECIMAL(15,2) NOT NULL,
        "exchange_rate" DECIMAL(15,6),
        "rate_source" VARCHAR(120),
        "rate_date" DATE,
        "selected_rate_type" VARCHAR(40),
        "provider_reference" VARCHAR(240),
        "conversion_path_json" JSONB,
        "payment_date" DATE NOT NULL,
        "payment_reference" VARCHAR(240) NOT NULL,
        "payment_method" VARCHAR(80) NOT NULL,
        "remarks" TEXT,
        "idempotency_key" VARCHAR(240) NOT NULL,
        "journal_transaction_id" VARCHAR(80),
        "reversal_of_payment_id" INTEGER,
        "reversal_reason" TEXT,
        "created_by" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "investment_participant_settlement_payments_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "intermediaries" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "notes" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "intermediaries_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "intermediary_deposits" (
        "id" SERIAL NOT NULL,
        "intermediary_id" INTEGER NOT NULL,
        "deposit_date" DATE NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "source_type" "IntermediarySourceType" NOT NULL,
        "city_id" INTEGER,
        "bank_account_id" INTEGER,
        "super_admin_bank_account_id" INTEGER,
        "super_admin_cash_account_id" INTEGER,
        "notes" TEXT,
        "journal_version" INTEGER NOT NULL DEFAULT 1,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        "deleted_at" TIMESTAMP(3),
        "deleted_by" INTEGER,
    
        CONSTRAINT "intermediary_deposits_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "haji_cash_receipts" (
        "id" SERIAL NOT NULL,
        "super_admin_cash_account_id" INTEGER NOT NULL,
        "intermediary_id" INTEGER NOT NULL,
        "receipt_date" DATE NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "notes" TEXT,
        "reversed_at" TIMESTAMP(3),
        "reversed_by" INTEGER,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "haji_cash_receipts_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "intermediary_exchanges" (
        "id" SERIAL NOT NULL,
        "intermediary_id" INTEGER NOT NULL,
        "exchange_date" DATE NOT NULL,
        "base_currency_id" INTEGER,
        "quote_currency_id" INTEGER,
        "from_currency_id" INTEGER NOT NULL,
        "from_amount" DECIMAL(15,2) NOT NULL,
        "to_currency_id" INTEGER NOT NULL,
        "to_amount" DECIMAL(15,2) NOT NULL,
        "exchange_rate" DECIMAL(18,6) NOT NULL,
        "notes" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "deleted_at" TIMESTAMP(3),
        "deleted_by" INTEGER,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "intermediary_exchanges_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "intermediary_usd_cost_layers" (
        "id" SERIAL NOT NULL,
        "intermediary_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "source_type" VARCHAR(50) NOT NULL,
        "source_id" INTEGER NOT NULL,
        "acquired_date" DATE NOT NULL,
        "original_amount_usd" DECIMAL(15,2) NOT NULL,
        "remaining_amount_usd" DECIMAL(15,2) NOT NULL,
        "original_cost_pkr" DECIMAL(15,2) NOT NULL,
        "remaining_cost_pkr" DECIMAL(15,2) NOT NULL,
        "rate_pkr" DECIMAL(18,6) NOT NULL,
        "is_fallback_rate" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "intermediary_usd_cost_layers_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "intermediary_usd_cost_usages" (
        "id" SERIAL NOT NULL,
        "layer_id" INTEGER,
        "intermediary_id" INTEGER NOT NULL,
        "supplier_payment_id" INTEGER,
        "shipping_line_payment_id" INTEGER,
        "amount_usd" DECIMAL(15,2) NOT NULL,
        "cost_pkr" DECIMAL(15,2) NOT NULL,
        "rate_pkr" DECIMAL(18,6) NOT NULL,
        "is_fallback_rate" BOOLEAN NOT NULL DEFAULT false,
        "notes" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "intermediary_usd_cost_usages_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_liabilities" (
        "id" SERIAL NOT NULL,
        "liability_type" "OpeningLiabilityType" NOT NULL,
        "supplier_id" INTEGER,
        "shipping_line_id" INTEGER,
        "agent_id" INTEGER,
        "intermediary_id" INTEGER,
        "currency_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "balance_side" "OpeningPartyBalanceSide" NOT NULL DEFAULT 'payable',
        "carrying_amount_pkr" DECIMAL(15,2),
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(120),
        "fx_rate_metadata" JSONB,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_liabilities_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "super_admin_liability_accounts" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "party_type" "SuperAdminLiabilityPartyType" NOT NULL,
        "phone" VARCHAR(50),
        "address" TEXT,
        "notes" TEXT,
        "control_account_id" INTEGER NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "super_admin_liability_accounts_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "super_admin_liability_entries" (
        "id" SERIAL NOT NULL,
        "account_id" INTEGER NOT NULL,
        "entry_type" "SuperAdminLiabilityEntryType" NOT NULL,
        "entry_date" DATE NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "liability_effect" DECIMAL(15,2) NOT NULL,
        "exchange_rate_to_pkr" DECIMAL(18,8) NOT NULL,
        "pkr_amount" DECIMAL(15,2) NOT NULL,
        "pkr_liability_effect" DECIMAL(15,2) NOT NULL,
        "carrying_rate_pkr" DECIMAL(18,8),
        "carrying_amount_pkr" DECIMAL(15,2),
        "realized_fx_pkr" DECIMAL(15,2),
        "rate_source" VARCHAR(120) NOT NULL,
        "source_type" "SuperAdminLiabilitySourceType",
        "super_admin_bank_account_id" INTEGER,
        "super_admin_cash_account_id" INTEGER,
        "intermediary_id" INTEGER,
        "bank_account_id" INTEGER,
        "city_id" INTEGER,
        "counter_account_id" INTEGER,
        "reversed_entry_id" INTEGER,
        "reference" VARCHAR(200),
        "remarks" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "reversed_by" INTEGER,
        "reversed_at" TIMESTAMP(3),
    
        CONSTRAINT "super_admin_liability_entries_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "super_admin_account_transfers" (
        "id" SERIAL NOT NULL,
        "transfer_date" DATE NOT NULL,
        "transfer_type" "SuperAdminTransferType" NOT NULL,
        "source_account_id" INTEGER NOT NULL,
        "destination_account_id" INTEGER NOT NULL,
        "from_currency_id" INTEGER NOT NULL,
        "to_currency_id" INTEGER NOT NULL,
        "from_amount" DECIMAL(15,2) NOT NULL,
        "to_amount" DECIMAL(15,2) NOT NULL,
        "exchange_rate" DECIMAL(18,8),
        "rate_source" VARCHAR(120),
        "reference" VARCHAR(200),
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "reversed_at" TIMESTAMP(3),
        "reversed_by" INTEGER,
    
        CONSTRAINT "super_admin_account_transfers_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "city_liability_accounts" (
        "id" SERIAL NOT NULL,
        "city_id" INTEGER NOT NULL,
        "name" VARCHAR(200) NOT NULL,
        "phone" VARCHAR(50),
        "notes" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "city_liability_accounts_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "city_liability_entries" (
        "id" SERIAL NOT NULL,
        "account_id" INTEGER NOT NULL,
        "city_id" INTEGER NOT NULL,
        "lot_id" INTEGER,
        "currency_id" INTEGER NOT NULL,
        "entry_date" DATE NOT NULL,
        "entry_type" "CityLiabilityEntryType" NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "detail" VARCHAR(500) NOT NULL,
        "note" TEXT,
        "payment_source" "CityLiabilityPaymentSource",
        "bank_account_id" INTEGER,
        "cheque_payment_id" INTEGER,
        "reference_no" VARCHAR(50),
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "city_liability_entries_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "opening_city_liabilities" (
        "id" SERIAL NOT NULL,
        "account_id" INTEGER NOT NULL,
        "city_id" INTEGER NOT NULL,
        "currency_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "carrying_amount_pkr" DECIMAL(15,2),
        "fx_rate_to_pkr" DECIMAL(18,8),
        "fx_rate_date" DATE,
        "fx_rate_source" VARCHAR(120),
        "fx_rate_metadata" JSONB,
        "opening_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
    
        CONSTRAINT "opening_city_liabilities_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateTable
    CREATE TABLE "profit_allocations" (
        "id" SERIAL NOT NULL,
        "account_id" INTEGER NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "period_start" DATE NOT NULL,
        "period_end" DATE NOT NULL,
        "allocation_date" DATE NOT NULL,
        "notes" TEXT,
        "created_by" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
        CONSTRAINT "profit_allocations_pkey" PRIMARY KEY ("id")
    );
    
    -- CreateIndex
    CREATE UNIQUE INDEX "countries_name_key" ON "countries"("name");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "countries_code_key" ON "countries"("code");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");
    
    -- CreateIndex
    CREATE INDEX "exchange_rates_currency_date_idx" ON "exchange_rates"("from_currency_id", "to_currency_id", "rate_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "exchange_rates_date_currency_source_key" ON "exchange_rates"("rate_date", "from_currency_id", "to_currency_id", "source");
    
    -- CreateIndex
    CREATE INDEX "foreign_currency_layers_owner_balance_idx" ON "foreign_currency_carrying_layers"("owner_key", "currency_id", "status", "recognition_date");
    
    -- CreateIndex
    CREATE INDEX "foreign_currency_layers_pool_date_idx" ON "foreign_currency_carrying_layers"("historical_pool_date");
    
    -- CreateIndex
    CREATE INDEX "foreign_currency_layers_parent_idx" ON "foreign_currency_carrying_layers"("parent_layer_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "foreign_currency_layers_source_key" ON "foreign_currency_carrying_layers"("source_type", "source_id", "source_line_key");
    
    -- CreateIndex
    CREATE INDEX "foreign_currency_movements_source_layer_idx" ON "foreign_currency_movements"("source_layer_id");
    
    -- CreateIndex
    CREATE INDEX "foreign_currency_movements_target_layer_idx" ON "foreign_currency_movements"("target_layer_id");
    
    -- CreateIndex
    CREATE INDEX "foreign_currency_movements_pool_date_idx" ON "foreign_currency_movements"("historical_pool_date");
    
    -- CreateIndex
    CREATE INDEX "foreign_currency_movements_journal_idx" ON "foreign_currency_movements"("journal_transaction_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "foreign_currency_movements_source_key" ON "foreign_currency_movements"("source_type", "source_id", "source_line_key", "movement_type");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sarafi_af_fx_snapshots_idempotency_key_key" ON "sarafi_af_fx_snapshots"("idempotency_key");
    
    -- CreateIndex
    CREATE INDEX "sarafi_af_fx_snapshots_date_status_idx" ON "sarafi_af_fx_snapshots"("snapshot_date", "status");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sarafi_af_fx_snapshots_daily_key" ON "sarafi_af_fx_snapshots"("snapshot_date", "provider", "market", "scheduled_time");
    
    -- CreateIndex
    CREATE INDEX "sarafi_af_fx_snapshot_quotes_currency_idx" ON "sarafi_af_fx_snapshot_quotes"("base_currency_id", "quote_currency_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sarafi_af_fx_snapshot_quotes_pair_key" ON "sarafi_af_fx_snapshot_quotes"("snapshot_id", "base_currency_id", "quote_currency_id");
    
    -- CreateIndex
    CREATE INDEX "sarafi_af_fx_derived_rates_currency_idx" ON "sarafi_af_fx_derived_rates"("from_currency_id", "to_currency_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sarafi_af_fx_derived_rates_pair_key" ON "sarafi_af_fx_derived_rates"("snapshot_id", "from_currency_id", "to_currency_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sarafi_af_assisted_capture_drafts_idempotency_key_key" ON "sarafi_af_assisted_capture_drafts"("idempotency_key");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sarafi_af_assisted_capture_drafts_approved_snapshot_id_key" ON "sarafi_af_assisted_capture_drafts"("approved_snapshot_id");
    
    -- CreateIndex
    CREATE INDEX "sarafi_af_capture_drafts_date_status_idx" ON "sarafi_af_assisted_capture_drafts"("snapshot_date", "status");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sbp_daily_fx_snapshots_exchange_rate_id_key" ON "sbp_daily_fx_snapshots"("exchange_rate_id");
    
    -- CreateIndex
    CREATE INDEX "sbp_daily_fx_snapshots_date_status_idx" ON "sbp_daily_fx_snapshots"("rate_date", "status");
    
    -- CreateIndex
    CREATE INDEX "sbp_daily_fx_snapshots_evidence_expiry_idx" ON "sbp_daily_fx_snapshots"("evidence_expires_at", "evidence_deleted_at");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sbp_daily_fx_snapshots_date_provider_market_key" ON "sbp_daily_fx_snapshots"("rate_date", "provider", "market");
    
    -- CreateIndex
    CREATE INDEX "country_fallback_rates_active_idx" ON "country_fallback_exchange_rates"("country_id", "from_currency_id", "to_currency_id", "is_active");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "country_fallback_rates_country_currency_date_key" ON "country_fallback_exchange_rates"("country_id", "from_currency_id", "to_currency_id", "effective_from");
    
    -- CreateIndex
    CREATE INDEX "cities_country_id_idx" ON "cities"("country_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "cities_country_id_name_key" ON "cities"("country_id", "name");
    
    -- CreateIndex
    CREATE INDEX "city_godown_permissions_from_city_id_idx" ON "city_godown_permissions"("from_city_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "city_godown_permissions_from_city_id_to_city_id_key" ON "city_godown_permissions"("from_city_id", "to_city_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "city_currencies_city_id_currency_id_key" ON "city_currencies"("city_id", "currency_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
    
    -- CreateIndex
    CREATE INDEX "users_city_id_idx" ON "users"("city_id");
    
    -- CreateIndex
    CREATE INDEX "users_role_idx" ON "users"("role");
    
    -- CreateIndex
    CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");
    
    -- CreateIndex
    CREATE INDEX "user_sessions_token_hash_idx" ON "user_sessions"("token_hash");
    
    -- CreateIndex
    CREATE INDEX "user_sessions_is_active_idx" ON "user_sessions"("is_active");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "products_name_key" ON "products"("name");
    
    -- CreateIndex
    CREATE INDEX "godowns_city_id_idx" ON "godowns"("city_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "godowns_city_id_name_key" ON "godowns"("city_id", "name");
    
    -- CreateIndex
    CREATE INDEX "godown_transfers_from_godown_id_idx" ON "godown_transfers"("from_godown_id");
    
    -- CreateIndex
    CREATE INDEX "godown_transfers_to_godown_id_idx" ON "godown_transfers"("to_godown_id");
    
    -- CreateIndex
    CREATE INDEX "godown_transfers_lot_id_idx" ON "godown_transfers"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "customers_city_id_idx" ON "customers"("city_id");
    
    -- CreateIndex
    CREATE INDEX "customers_name_idx" ON "customers"("name");
    
    -- CreateIndex
    CREATE INDEX "customers_portal_access_enabled_idx" ON "customers"("portal_access_enabled");
    
    -- CreateIndex
    CREATE INDEX "opening_cashes_city_id_idx" ON "opening_cashes"("city_id");
    
    -- CreateIndex
    CREATE INDEX "opening_cashes_opening_date_idx" ON "opening_cashes"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_cashes_city_id_currency_id_key" ON "opening_cashes"("city_id", "currency_id");
    
    -- CreateIndex
    CREATE INDEX "opening_haji_balances_city_id_idx" ON "opening_haji_balances"("city_id");
    
    -- CreateIndex
    CREATE INDEX "opening_haji_balances_opening_date_idx" ON "opening_haji_balances"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_haji_balances_city_id_currency_id_key" ON "opening_haji_balances"("city_id", "currency_id");
    
    -- CreateIndex
    CREATE INDEX "opening_customer_balances_customer_id_idx" ON "opening_customer_balances"("customer_id");
    
    -- CreateIndex
    CREATE INDEX "opening_customer_balances_opening_date_idx" ON "opening_customer_balances"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_customer_balances_customer_id_currency_id_key" ON "opening_customer_balances"("customer_id", "currency_id");
    
    -- CreateIndex
    CREATE INDEX "opening_stocks_city_id_idx" ON "opening_stocks"("city_id");
    
    -- CreateIndex
    CREATE INDEX "opening_stocks_opening_date_idx" ON "opening_stocks"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_stocks_godown_id_product_id_key" ON "opening_stocks"("godown_id", "product_id");
    
    -- CreateIndex
    CREATE INDEX "opening_bank_balances_city_id_idx" ON "opening_bank_balances"("city_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_bank_balances_bank_account_id_currency_id_key" ON "opening_bank_balances"("bank_account_id", "currency_id");
    
    -- CreateIndex
    CREATE INDEX "opening_cheques_city_id_idx" ON "opening_cheques"("city_id");
    
    -- CreateIndex
    CREATE INDEX "opening_cheques_customer_id_idx" ON "opening_cheques"("customer_id");
    
    -- CreateIndex
    CREATE INDEX "opening_cheques_bank_deposit_id_idx" ON "opening_cheques"("bank_deposit_id");
    
    -- CreateIndex
    CREATE INDEX "opening_inventory_valuations_opening_date_idx" ON "opening_inventory_valuations"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_inventory_valuations_lot_id_product_id_key" ON "opening_inventory_valuations"("lot_id", "product_id");
    
    -- CreateIndex
    CREATE INDEX "opening_super_admin_account_balances_opening_date_idx" ON "opening_super_admin_account_balances"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_super_admin_account_balances_account_id_key" ON "opening_super_admin_account_balances"("account_id");
    
    -- CreateIndex
    CREATE INDEX "opening_equity_allocations_opening_date_idx" ON "opening_equity_allocations"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_equity_allocations_equity_type_label_key" ON "opening_equity_allocations"("equity_type", "label");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_cutovers_revision_key" ON "opening_cutovers"("revision");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_cutovers_final_snapshot_hash_key" ON "opening_cutovers"("final_snapshot_hash");
    
    -- CreateIndex
    CREATE INDEX "opening_cutovers_status_idx" ON "opening_cutovers"("status");
    
    -- CreateIndex
    CREATE INDEX "opening_cutovers_cutover_date_idx" ON "opening_cutovers"("cutover_date");
    
    -- CreateIndex
    CREATE INDEX "opening_cutovers_supersedes_cutover_id_idx" ON "opening_cutovers"("supersedes_cutover_id");
    
    -- CreateIndex
    CREATE INDEX "opening_city_packages_status_idx" ON "opening_city_packages"("status");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_city_packages_cutover_id_city_id_key" ON "opening_city_packages"("cutover_id", "city_id");
    
    -- CreateIndex
    CREATE INDEX "opening_city_due_balances_currency_id_idx" ON "opening_city_due_balances"("currency_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_city_due_balances_package_id_currency_id_key" ON "opening_city_due_balances"("package_id", "currency_id");
    
    -- CreateIndex
    CREATE INDEX "opening_cutover_entries_cutover_id_idx" ON "opening_cutover_entries"("cutover_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_cutover_entries_entity_type_entity_id_key" ON "opening_cutover_entries"("entity_type", "entity_id");
    
    -- CreateIndex
    CREATE INDEX "opening_participant_balances_participant_id_idx" ON "opening_participant_balances"("participant_id");
    
    -- CreateIndex
    CREATE INDEX "opening_participant_balances_opening_date_idx" ON "opening_participant_balances"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_participant_balances_cutover_id_participant_id_key" ON "opening_participant_balances"("cutover_id", "participant_id");
    
    -- CreateIndex
    CREATE INDEX "lots_country_id_idx" ON "lots"("country_id");
    
    -- CreateIndex
    CREATE INDEX "lots_consignee_id_idx" ON "lots"("consignee_id");
    
    -- CreateIndex
    CREATE INDEX "lots_destination_city_id_idx" ON "lots"("destination_city_id");
    
    -- CreateIndex
    CREATE INDEX "lots_shipment_status_idx" ON "lots"("shipment_status");
    
    -- CreateIndex
    CREATE INDEX "lots_status_idx" ON "lots"("status");
    
    -- CreateIndex
    CREATE INDEX "lots_lot_date_idx" ON "lots"("lot_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "lots_country_id_lot_number_key" ON "lots"("country_id", "lot_number");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "consignees_name_key" ON "consignees"("name");
    
    -- CreateIndex
    CREATE INDEX "consignees_country_id_idx" ON "consignees"("country_id");
    
    -- CreateIndex
    CREATE INDEX "consignees_city_id_idx" ON "consignees"("city_id");
    
    -- CreateIndex
    CREATE INDEX "consignees_is_active_idx" ON "consignees"("is_active");
    
    -- CreateIndex
    CREATE INDEX "lot_documents_lot_id_archived_at_idx" ON "lot_documents"("lot_id", "archived_at");
    
    -- CreateIndex
    CREATE INDEX "lot_documents_category_idx" ON "lot_documents"("category");
    
    -- CreateIndex
    CREATE INDEX "lot_documents_uploaded_at_idx" ON "lot_documents"("uploaded_at");
    
    -- CreateIndex
    CREATE INDEX "lot_status_history_lot_id_effective_at_idx" ON "lot_status_history"("lot_id", "effective_at");
    
    -- CreateIndex
    CREATE INDEX "lot_status_history_new_status_idx" ON "lot_status_history"("new_status");
    
    -- CreateIndex
    CREATE INDEX "lot_products_lot_id_idx" ON "lot_products"("lot_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "lot_products_lot_id_product_id_key" ON "lot_products"("lot_id", "product_id");
    
    -- CreateIndex
    CREATE INDEX "lot_city_distributions_lot_id_idx" ON "lot_city_distributions"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "lot_city_distributions_city_id_idx" ON "lot_city_distributions"("city_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "lot_city_distributions_lot_id_city_id_product_id_key" ON "lot_city_distributions"("lot_id", "city_id", "product_id");
    
    -- CreateIndex
    CREATE INDEX "lot_city_godown_allocations_lot_city_distribution_id_idx" ON "lot_city_godown_allocations"("lot_city_distribution_id");
    
    -- CreateIndex
    CREATE INDEX "lot_city_godown_allocations_godown_id_idx" ON "lot_city_godown_allocations"("godown_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "lot_city_godown_allocations_lot_city_distribution_id_godown_key" ON "lot_city_godown_allocations"("lot_city_distribution_id", "godown_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "voucher_sequences_city_id_key" ON "voucher_sequences"("city_id");
    
    -- CreateIndex
    CREATE INDEX "sales_city_id_idx" ON "sales"("city_id");
    
    -- CreateIndex
    CREATE INDEX "sales_customer_id_idx" ON "sales"("customer_id");
    
    -- CreateIndex
    CREATE INDEX "sales_lot_id_idx" ON "sales"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "sales_godown_id_idx" ON "sales"("godown_id");
    
    -- CreateIndex
    CREATE INDEX "sales_sale_date_idx" ON "sales"("sale_date");
    
    -- CreateIndex
    CREATE INDEX "sales_status_idx" ON "sales"("status");
    
    -- CreateIndex
    CREATE INDEX "sales_city_id_voucher_no_idx" ON "sales"("city_id", "voucher_no");
    
    -- CreateIndex
    CREATE INDEX "sales_city_id_sale_date_idx" ON "sales"("city_id", "sale_date");
    
    -- CreateIndex
    CREATE INDEX "sales_city_id_status_sale_date_idx" ON "sales"("city_id", "status", "sale_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sales_city_id_voucher_no_key" ON "sales"("city_id", "voucher_no");
    
    -- CreateIndex
    CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");
    
    -- CreateIndex
    CREATE INDEX "sale_items_lot_id_idx" ON "sale_items"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");
    
    -- CreateIndex
    CREATE INDEX "sale_discounts_sale_id_idx" ON "sale_discounts"("sale_id");
    
    -- CreateIndex
    CREATE INDEX "sale_discounts_applied_to_lot_id_idx" ON "sale_discounts"("applied_to_lot_id");
    
    -- CreateIndex
    CREATE INDEX "payments_city_id_idx" ON "payments"("city_id");
    
    -- CreateIndex
    CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");
    
    -- CreateIndex
    CREATE INDEX "payments_lot_id_idx" ON "payments"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "payments_payment_date_idx" ON "payments"("payment_date");
    
    -- CreateIndex
    CREATE INDEX "payments_status_idx" ON "payments"("status");
    
    -- CreateIndex
    CREATE INDEX "payments_payment_method_idx" ON "payments"("payment_method");
    
    -- CreateIndex
    CREATE INDEX "payments_bank_account_id_idx" ON "payments"("bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "payments_super_admin_bank_account_id_idx" ON "payments"("super_admin_bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "payments_sale_id_idx" ON "payments"("sale_id");
    
    -- CreateIndex
    CREATE INDEX "payments_city_id_payment_date_idx" ON "payments"("city_id", "payment_date");
    
    -- CreateIndex
    CREATE INDEX "payments_city_id_status_payment_date_idx" ON "payments"("city_id", "status", "payment_date");
    
    -- CreateIndex
    CREATE INDEX "payments_city_id_destination_payment_date_idx" ON "payments"("city_id", "destination", "payment_date");
    
    -- CreateIndex
    CREATE INDEX "payments_city_id_manual_voucher_no_idx" ON "payments"("city_id", "manual_voucher_no");
    
    -- CreateIndex
    CREATE INDEX "payment_lot_transfers_payment_id_idx" ON "payment_lot_transfers"("payment_id");
    
    -- CreateIndex
    CREATE INDEX "payment_lot_transfers_from_lot_id_idx" ON "payment_lot_transfers"("from_lot_id");
    
    -- CreateIndex
    CREATE INDEX "payment_lot_transfers_to_lot_id_idx" ON "payment_lot_transfers"("to_lot_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "expenses_customer_payment_id_key" ON "expenses"("customer_payment_id");
    
    -- CreateIndex
    CREATE INDEX "expenses_city_id_idx" ON "expenses"("city_id");
    
    -- CreateIndex
    CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");
    
    -- CreateIndex
    CREATE INDEX "expenses_deleted_at_idx" ON "expenses"("deleted_at");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "personal_withdrawals_customer_payment_id_key" ON "personal_withdrawals"("customer_payment_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "personal_withdrawals_haji_transfer_id_key" ON "personal_withdrawals"("haji_transfer_id");
    
    -- CreateIndex
    CREATE INDEX "personal_withdrawals_city_id_idx" ON "personal_withdrawals"("city_id");
    
    -- CreateIndex
    CREATE INDEX "personal_withdrawals_bank_account_id_idx" ON "personal_withdrawals"("bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "personal_withdrawals_withdrawal_date_idx" ON "personal_withdrawals"("withdrawal_date");
    
    -- CreateIndex
    CREATE INDEX "personal_withdrawals_approved_by_idx" ON "personal_withdrawals"("approved_by");
    
    -- CreateIndex
    CREATE INDEX "withdrawee_names_city_id_idx" ON "withdrawee_names"("city_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "withdrawee_names_city_id_name_key" ON "withdrawee_names"("city_id", "name");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "haji_transfers_cheque_payment_id_key" ON "haji_transfers"("cheque_payment_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "haji_transfers_payment_id_key" ON "haji_transfers"("payment_id");
    
    -- CreateIndex
    CREATE INDEX "haji_transfers_city_id_idx" ON "haji_transfers"("city_id");
    
    -- CreateIndex
    CREATE INDEX "haji_transfers_lot_id_idx" ON "haji_transfers"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "haji_transfers_transfer_date_idx" ON "haji_transfers"("transfer_date");
    
    -- CreateIndex
    CREATE INDEX "haji_transfers_transferred_to_idx" ON "haji_transfers"("transferred_to");
    
    -- CreateIndex
    CREATE INDEX "haji_transfers_intermediary_id_idx" ON "haji_transfers"("intermediary_id");
    
    -- CreateIndex
    CREATE INDEX "haji_transfers_super_admin_cash_account_id_idx" ON "haji_transfers"("super_admin_cash_account_id");
    
    -- CreateIndex
    CREATE INDEX "haji_transfers_super_admin_bank_account_id_idx" ON "haji_transfers"("super_admin_bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "lot_settlement_overflows_city_id_idx" ON "lot_settlement_overflows"("city_id");
    
    -- CreateIndex
    CREATE INDEX "lot_settlement_overflows_from_lot_id_idx" ON "lot_settlement_overflows"("from_lot_id");
    
    -- CreateIndex
    CREATE INDEX "lot_settlement_overflows_to_lot_id_idx" ON "lot_settlement_overflows"("to_lot_id");
    
    -- CreateIndex
    CREATE INDEX "lot_settlement_unresolved_overflows_city_id_idx" ON "lot_settlement_unresolved_overflows"("city_id");
    
    -- CreateIndex
    CREATE INDEX "lot_settlement_unresolved_overflows_from_lot_id_idx" ON "lot_settlement_unresolved_overflows"("from_lot_id");
    
    -- CreateIndex
    CREATE INDEX "lot_settlement_unresolved_overflows_resolved_at_idx" ON "lot_settlement_unresolved_overflows"("resolved_at");
    
    -- CreateIndex
    CREATE INDEX "bank_accounts_city_id_idx" ON "bank_accounts"("city_id");
    
    -- CreateIndex
    CREATE INDEX "bank_deposits_city_id_idx" ON "bank_deposits"("city_id");
    
    -- CreateIndex
    CREATE INDEX "bank_deposits_bank_account_id_idx" ON "bank_deposits"("bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "bank_deposits_deposit_date_idx" ON "bank_deposits"("deposit_date");
    
    -- CreateIndex
    CREATE INDEX "bank_deposits_transfer_pair_id_idx" ON "bank_deposits"("transfer_pair_id");
    
    -- CreateIndex
    CREATE INDEX "super_admin_bank_accounts_currency_id_idx" ON "super_admin_bank_accounts"("currency_id");
    
    -- CreateIndex
    CREATE INDEX "super_admin_bank_accounts_created_by_idx" ON "super_admin_bank_accounts"("created_by");
    
    -- CreateIndex
    CREATE INDEX "super_admin_personal_expenses_bank_account_id_idx" ON "super_admin_personal_expenses"("bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "super_admin_personal_expenses_expense_date_idx" ON "super_admin_personal_expenses"("expense_date");
    
    -- CreateIndex
    CREATE INDEX "super_admin_personal_expenses_deleted_at_idx" ON "super_admin_personal_expenses"("deleted_at");
    
    -- CreateIndex
    CREATE INDEX "financial_years_status_idx" ON "financial_years"("status");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "financial_years_start_date_end_date_key" ON "financial_years"("start_date", "end_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");
    
    -- CreateIndex
    CREATE INDEX "accounts_account_type_idx" ON "accounts"("account_type");
    
    -- CreateIndex
    CREATE INDEX "accounts_city_id_idx" ON "accounts"("city_id");
    
    -- CreateIndex
    CREATE INDEX "journal_entries_transaction_id_idx" ON "journal_entries"("transaction_id");
    
    -- CreateIndex
    CREATE INDEX "journal_entries_account_id_idx" ON "journal_entries"("account_id");
    
    -- CreateIndex
    CREATE INDEX "journal_entries_entity_type_entity_id_idx" ON "journal_entries"("entity_type", "entity_id");
    
    -- CreateIndex
    CREATE INDEX "journal_entries_lot_id_idx" ON "journal_entries"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "journal_entries_city_id_idx" ON "journal_entries"("city_id");
    
    -- CreateIndex
    CREATE INDEX "journal_entries_entry_date_idx" ON "journal_entries"("entry_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "journal_entries_transaction_line_key" ON "journal_entries"("transaction_id", "line_number");
    
    -- CreateIndex
    CREATE INDEX "agents_agent_type_idx" ON "agents"("agent_type");
    
    -- CreateIndex
    CREATE INDEX "agents_city_id_idx" ON "agents"("city_id");
    
    -- CreateIndex
    CREATE INDEX "agent_payments_agent_id_idx" ON "agent_payments"("agent_id");
    
    -- CreateIndex
    CREATE INDEX "agent_payments_city_id_idx" ON "agent_payments"("city_id");
    
    -- CreateIndex
    CREATE INDEX "agent_payments_payment_date_idx" ON "agent_payments"("payment_date");
    
    -- CreateIndex
    CREATE INDEX "agent_payments_bank_account_id_idx" ON "agent_payments"("bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "agent_payments_super_admin_bank_account_id_idx" ON "agent_payments"("super_admin_bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "agent_payments_intermediary_id_idx" ON "agent_payments"("intermediary_id");
    
    -- CreateIndex
    CREATE INDEX "agent_payments_super_admin_cash_account_id_idx" ON "agent_payments"("super_admin_cash_account_id");
    
    -- CreateIndex
    CREATE INDEX "agent_payments_deleted_at_idx" ON "agent_payments"("deleted_at");
    
    -- CreateIndex
    CREATE INDEX "city_transfers_from_city_id_idx" ON "city_transfers"("from_city_id");
    
    -- CreateIndex
    CREATE INDEX "city_transfers_to_city_id_idx" ON "city_transfers"("to_city_id");
    
    -- CreateIndex
    CREATE INDEX "city_transfers_status_idx" ON "city_transfers"("status");
    
    -- CreateIndex
    CREATE INDEX "city_transfers_batch_id_idx" ON "city_transfers"("batch_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");
    
    -- CreateIndex
    CREATE INDEX "lot_purchases_lot_id_idx" ON "lot_purchases"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "lot_purchases_supplier_id_idx" ON "lot_purchases"("supplier_id");
    
    -- CreateIndex
    CREATE INDEX "lot_costs_lot_id_idx" ON "lot_costs"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "lot_costs_cost_type_idx" ON "lot_costs"("cost_type");
    
    -- CreateIndex
    CREATE INDEX "lot_costs_supplier_id_idx" ON "lot_costs"("supplier_id");
    
    -- CreateIndex
    CREATE INDEX "lot_costs_agent_id_idx" ON "lot_costs"("agent_id");
    
    -- CreateIndex
    CREATE INDEX "lot_costs_bank_account_id_idx" ON "lot_costs"("bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "lot_costs_super_admin_bank_account_id_idx" ON "lot_costs"("super_admin_bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "lot_costs_intermediary_id_idx" ON "lot_costs"("intermediary_id");
    
    -- CreateIndex
    CREATE INDEX "lot_costs_allocated_product_id_idx" ON "lot_costs"("allocated_product_id");
    
    -- CreateIndex
    CREATE INDEX "supplier_payments_supplier_id_idx" ON "supplier_payments"("supplier_id");
    
    -- CreateIndex
    CREATE INDEX "supplier_payments_lot_id_idx" ON "supplier_payments"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "supplier_payments_bank_account_id_idx" ON "supplier_payments"("bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "supplier_payments_super_admin_bank_account_id_idx" ON "supplier_payments"("super_admin_bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "supplier_payments_super_admin_cash_account_id_idx" ON "supplier_payments"("super_admin_cash_account_id");
    
    -- CreateIndex
    CREATE INDEX "supplier_payments_intermediary_id_idx" ON "supplier_payments"("intermediary_id");
    
    -- CreateIndex
    CREATE INDEX "supplier_payments_payment_date_idx" ON "supplier_payments"("payment_date");
    
    -- CreateIndex
    CREATE INDEX "supplier_payments_deleted_at_idx" ON "supplier_payments"("deleted_at");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "shipping_lines_name_key" ON "shipping_lines"("name");
    
    -- CreateIndex
    CREATE INDEX "shipping_line_payments_shipping_line_id_idx" ON "shipping_line_payments"("shipping_line_id");
    
    -- CreateIndex
    CREATE INDEX "shipping_line_payments_lot_id_idx" ON "shipping_line_payments"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "shipping_line_payments_bank_account_id_idx" ON "shipping_line_payments"("bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "shipping_line_payments_super_admin_bank_account_id_idx" ON "shipping_line_payments"("super_admin_bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "shipping_line_payments_intermediary_id_idx" ON "shipping_line_payments"("intermediary_id");
    
    -- CreateIndex
    CREATE INDEX "shipping_line_payments_super_admin_cash_account_id_idx" ON "shipping_line_payments"("super_admin_cash_account_id");
    
    -- CreateIndex
    CREATE INDEX "shipping_line_payments_deleted_at_idx" ON "shipping_line_payments"("deleted_at");
    
    -- CreateIndex
    CREATE INDEX "attachments_entity_type_entity_id_idx" ON "attachments"("entity_type", "entity_id");
    
    -- CreateIndex
    CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");
    
    -- CreateIndex
    CREATE INDEX "audit_logs_city_id_idx" ON "audit_logs"("city_id");
    
    -- CreateIndex
    CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
    
    -- CreateIndex
    CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
    
    -- CreateIndex
    CREATE INDEX "sync_requests_city_id_idx" ON "sync_requests"("city_id");
    
    -- CreateIndex
    CREATE INDEX "sync_requests_created_at_idx" ON "sync_requests"("created_at");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "sync_requests_city_id_module_request_id_key" ON "sync_requests"("city_id", "module", "request_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "inventory_thresholds_city_id_product_id_key" ON "inventory_thresholds"("city_id", "product_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participants_investor_id_idx" ON "investment_participants"("investor_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participants_type_idx" ON "investment_participants"("type");
    
    -- CreateIndex
    CREATE INDEX "investment_participants_is_active_idx" ON "investment_participants"("is_active");
    
    -- CreateIndex
    CREATE INDEX "investment_capital_events_participant_date_idx" ON "investment_capital_events"("participant_id", "effective_date");
    
    -- CreateIndex
    CREATE INDEX "investment_capital_events_effective_date_idx" ON "investment_capital_events"("effective_date");
    
    -- CreateIndex
    CREATE INDEX "investment_profit_share_events_participant_date_idx" ON "investment_profit_share_events"("participant_id", "effective_date");
    
    -- CreateIndex
    CREATE INDEX "investment_profit_share_events_effective_date_idx" ON "investment_profit_share_events"("effective_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "profit_attribution_periods_idempotency_key_key" ON "profit_attribution_periods"("idempotency_key");
    
    -- CreateIndex
    CREATE INDEX "profit_attribution_periods_period_idx" ON "profit_attribution_periods"("period_start", "period_end");
    
    -- CreateIndex
    CREATE INDEX "profit_attribution_periods_status_idx" ON "profit_attribution_periods"("status");
    
    -- CreateIndex
    CREATE INDEX "profit_attribution_periods_reversal_of_idx" ON "profit_attribution_periods"("reversal_of_period_id");
    
    -- CreateIndex
    CREATE INDEX "profit_attribution_lines_period_idx" ON "profit_attribution_lines"("period_id");
    
    -- CreateIndex
    CREATE INDEX "profit_attribution_lines_participant_idx" ON "profit_attribution_lines"("participant_id");
    
    -- CreateIndex
    CREATE INDEX "investor_residual_attributions_period_idx" ON "investor_residual_attributions"("period_id");
    
    -- CreateIndex
    CREATE INDEX "investor_residual_attributions_original_idx" ON "investor_residual_attributions"("original_participant_id");
    
    -- CreateIndex
    CREATE INDEX "investor_attr_ledger_period_idx" ON "investor_attribution_ledger_entries"("period_id");
    
    -- CreateIndex
    CREATE INDEX "investor_attr_ledger_participant_idx" ON "investor_attribution_ledger_entries"("participant_id");
    
    -- CreateIndex
    CREATE INDEX "investor_attr_ledger_category_idx" ON "investor_attribution_ledger_entries"("category");
    
    -- CreateIndex
    CREATE INDEX "investor_attr_ledger_reversal_idx" ON "investor_attribution_ledger_entries"("reversal_of_entry_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "investor_attr_ledger_period_ref_type_key" ON "investor_attribution_ledger_entries"("period_id", "reconciliation_reference", "entry_type");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "investment_participant_actions_idempotency_key_key" ON "investment_participant_actions"("idempotency_key");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "investment_participant_actions_capital_event_id_key" ON "investment_participant_actions"("capital_event_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_actions_participant_date_idx" ON "investment_participant_actions"("participant_id", "effective_date");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_actions_type_idx" ON "investment_participant_actions"("action_type");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_actions_status_idx" ON "investment_participant_actions"("status");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_actions_settlement_status_idx" ON "investment_participant_actions"("settlement_status");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_actions_reversal_of_idx" ON "investment_participant_actions"("reversal_of_action_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_action_ledger_participant_idx" ON "investment_participant_action_ledger_entries"("participant_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_action_ledger_category_idx" ON "investment_participant_action_ledger_entries"("category");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_action_ledger_reversal_idx" ON "investment_participant_action_ledger_entries"("reversal_of_entry_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "investment_participant_action_ledger_action_ref_key" ON "investment_participant_action_ledger_entries"("action_id", "reconciliation_reference");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "investment_participant_settlements_idempotency_key_key" ON "investment_participant_settlements"("idempotency_key");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlements_action_idx" ON "investment_participant_settlements"("action_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlements_participant_idx" ON "investment_participant_settlements"("participant_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlements_status_idx" ON "investment_participant_settlements"("status");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlements_payment_date_idx" ON "investment_participant_settlements"("payment_date");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlements_reversal_idx" ON "investment_participant_settlements"("reversal_of_settlement_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "investment_participant_settlement_payments_idempotency_key_key" ON "investment_participant_settlement_payments"("idempotency_key");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlement_payments_settlement_idx" ON "investment_participant_settlement_payments"("settlement_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlement_payments_action_idx" ON "investment_participant_settlement_payments"("action_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlement_payments_participant_idx" ON "investment_participant_settlement_payments"("participant_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlement_payments_account_idx" ON "investment_participant_settlement_payments"("super_admin_bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlement_payments_status_idx" ON "investment_participant_settlement_payments"("status");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlement_payments_payment_date_idx" ON "investment_participant_settlement_payments"("payment_date");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlement_payments_journal_txn_idx" ON "investment_participant_settlement_payments"("journal_transaction_id");
    
    -- CreateIndex
    CREATE INDEX "investment_participant_settlement_payments_reversal_idx" ON "investment_participant_settlement_payments"("reversal_of_payment_id");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "intermediaries_name_key" ON "intermediaries"("name");
    
    -- CreateIndex
    CREATE INDEX "intermediary_deposits_intermediary_id_idx" ON "intermediary_deposits"("intermediary_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_deposits_deposit_date_idx" ON "intermediary_deposits"("deposit_date");
    
    -- CreateIndex
    CREATE INDEX "intermediary_deposits_super_admin_bank_account_id_idx" ON "intermediary_deposits"("super_admin_bank_account_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_deposits_super_admin_cash_account_id_idx" ON "intermediary_deposits"("super_admin_cash_account_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_deposits_deleted_at_idx" ON "intermediary_deposits"("deleted_at");
    
    -- CreateIndex
    CREATE INDEX "haji_cash_receipts_super_admin_cash_account_id_idx" ON "haji_cash_receipts"("super_admin_cash_account_id");
    
    -- CreateIndex
    CREATE INDEX "haji_cash_receipts_intermediary_id_idx" ON "haji_cash_receipts"("intermediary_id");
    
    -- CreateIndex
    CREATE INDEX "haji_cash_receipts_receipt_date_idx" ON "haji_cash_receipts"("receipt_date");
    
    -- CreateIndex
    CREATE INDEX "haji_cash_receipts_reversed_at_idx" ON "haji_cash_receipts"("reversed_at");
    
    -- CreateIndex
    CREATE INDEX "intermediary_exchanges_intermediary_id_is_active_idx" ON "intermediary_exchanges"("intermediary_id", "is_active");
    
    -- CreateIndex
    CREATE INDEX "intermediary_exchanges_exchange_date_idx" ON "intermediary_exchanges"("exchange_date");
    
    -- CreateIndex
    CREATE INDEX "intermediary_exchanges_base_currency_id_idx" ON "intermediary_exchanges"("base_currency_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_exchanges_quote_currency_id_idx" ON "intermediary_exchanges"("quote_currency_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_exchanges_from_currency_id_idx" ON "intermediary_exchanges"("from_currency_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_exchanges_to_currency_id_idx" ON "intermediary_exchanges"("to_currency_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_usd_layers_balance_idx" ON "intermediary_usd_cost_layers"("intermediary_id", "remaining_amount_usd");
    
    -- CreateIndex
    CREATE INDEX "intermediary_usd_layers_date_idx" ON "intermediary_usd_cost_layers"("acquired_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "intermediary_usd_layers_source_key" ON "intermediary_usd_cost_layers"("source_type", "source_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_usd_usages_layer_idx" ON "intermediary_usd_cost_usages"("layer_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_usd_usages_intermediary_idx" ON "intermediary_usd_cost_usages"("intermediary_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_usd_usages_supplier_idx" ON "intermediary_usd_cost_usages"("supplier_payment_id");
    
    -- CreateIndex
    CREATE INDEX "intermediary_usd_usages_shipping_idx" ON "intermediary_usd_cost_usages"("shipping_line_payment_id");
    
    -- CreateIndex
    CREATE INDEX "opening_liabilities_supplier_currency_idx" ON "opening_liabilities"("supplier_id", "currency_id");
    
    -- CreateIndex
    CREATE INDEX "opening_liabilities_shipping_line_currency_idx" ON "opening_liabilities"("shipping_line_id", "currency_id");
    
    -- CreateIndex
    CREATE INDEX "opening_liabilities_agent_currency_idx" ON "opening_liabilities"("agent_id", "currency_id");
    
    -- CreateIndex
    CREATE INDEX "opening_liabilities_intermediary_currency_idx" ON "opening_liabilities"("intermediary_id", "currency_id");
    
    -- CreateIndex
    CREATE INDEX "opening_liabilities_liability_type_idx" ON "opening_liabilities"("liability_type");
    
    -- CreateIndex
    CREATE INDEX "opening_liabilities_opening_date_idx" ON "opening_liabilities"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "super_admin_liability_accounts_control_account_id_key" ON "super_admin_liability_accounts"("control_account_id");
    
    -- CreateIndex
    CREATE INDEX "super_admin_liability_accounts_party_type_is_active_idx" ON "super_admin_liability_accounts"("party_type", "is_active");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "super_admin_liability_accounts_name_party_type_key" ON "super_admin_liability_accounts"("name", "party_type");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "super_admin_liability_entries_reversed_entry_id_key" ON "super_admin_liability_entries"("reversed_entry_id");
    
    -- CreateIndex
    CREATE INDEX "super_admin_liability_entries_account_id_currency_id_entry__idx" ON "super_admin_liability_entries"("account_id", "currency_id", "entry_date");
    
    -- CreateIndex
    CREATE INDEX "super_admin_liability_entries_entry_type_idx" ON "super_admin_liability_entries"("entry_type");
    
    -- CreateIndex
    CREATE INDEX "super_admin_liability_entries_source_type_idx" ON "super_admin_liability_entries"("source_type");
    
    -- CreateIndex
    CREATE INDEX "super_admin_account_transfers_transfer_date_idx" ON "super_admin_account_transfers"("transfer_date");
    
    -- CreateIndex
    CREATE INDEX "super_admin_account_transfers_source_account_id_idx" ON "super_admin_account_transfers"("source_account_id");
    
    -- CreateIndex
    CREATE INDEX "super_admin_account_transfers_destination_account_id_idx" ON "super_admin_account_transfers"("destination_account_id");
    
    -- CreateIndex
    CREATE INDEX "city_liability_accounts_city_id_idx" ON "city_liability_accounts"("city_id");
    
    -- CreateIndex
    CREATE INDEX "city_liability_accounts_is_active_idx" ON "city_liability_accounts"("is_active");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "city_liability_accounts_city_id_name_key" ON "city_liability_accounts"("city_id", "name");
    
    -- CreateIndex
    CREATE INDEX "city_liability_entries_account_id_idx" ON "city_liability_entries"("account_id");
    
    -- CreateIndex
    CREATE INDEX "city_liability_entries_city_id_idx" ON "city_liability_entries"("city_id");
    
    -- CreateIndex
    CREATE INDEX "city_liability_entries_lot_id_idx" ON "city_liability_entries"("lot_id");
    
    -- CreateIndex
    CREATE INDEX "city_liability_entries_entry_date_idx" ON "city_liability_entries"("entry_date");
    
    -- CreateIndex
    CREATE INDEX "city_liability_entries_entry_type_idx" ON "city_liability_entries"("entry_type");
    
    -- CreateIndex
    CREATE INDEX "opening_city_liabilities_city_id_idx" ON "opening_city_liabilities"("city_id");
    
    -- CreateIndex
    CREATE INDEX "opening_city_liabilities_opening_date_idx" ON "opening_city_liabilities"("opening_date");
    
    -- CreateIndex
    CREATE UNIQUE INDEX "opening_city_liabilities_account_id_currency_id_key" ON "opening_city_liabilities"("account_id", "currency_id");
    
    -- AddForeignKey
    ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_from_currency_id_fkey" FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_to_currency_id_fkey" FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_correction_of_id_fkey" FOREIGN KEY ("correction_of_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "foreign_currency_carrying_layers" ADD CONSTRAINT "foreign_currency_carrying_layers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "foreign_currency_carrying_layers" ADD CONSTRAINT "foreign_currency_carrying_layers_parent_layer_id_fkey" FOREIGN KEY ("parent_layer_id") REFERENCES "foreign_currency_carrying_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "foreign_currency_movements" ADD CONSTRAINT "foreign_currency_movements_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "foreign_currency_movements" ADD CONSTRAINT "foreign_currency_movements_source_layer_id_fkey" FOREIGN KEY ("source_layer_id") REFERENCES "foreign_currency_carrying_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "foreign_currency_movements" ADD CONSTRAINT "foreign_currency_movements_target_layer_id_fkey" FOREIGN KEY ("target_layer_id") REFERENCES "foreign_currency_carrying_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "foreign_currency_movements" ADD CONSTRAINT "foreign_currency_movements_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "foreign_currency_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sarafi_af_fx_snapshot_quotes" ADD CONSTRAINT "sarafi_af_fx_snapshot_quotes_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "sarafi_af_fx_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sarafi_af_fx_snapshot_quotes" ADD CONSTRAINT "sarafi_af_fx_snapshot_quotes_base_currency_id_fkey" FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sarafi_af_fx_snapshot_quotes" ADD CONSTRAINT "sarafi_af_fx_snapshot_quotes_quote_currency_id_fkey" FOREIGN KEY ("quote_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sarafi_af_fx_derived_rates" ADD CONSTRAINT "sarafi_af_fx_derived_rates_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "sarafi_af_fx_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sarafi_af_fx_derived_rates" ADD CONSTRAINT "sarafi_af_fx_derived_rates_from_currency_id_fkey" FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sarafi_af_fx_derived_rates" ADD CONSTRAINT "sarafi_af_fx_derived_rates_to_currency_id_fkey" FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sbp_daily_fx_snapshots" ADD CONSTRAINT "sbp_daily_fx_snapshots_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "country_fallback_exchange_rates" ADD CONSTRAINT "country_fallback_exchange_rates_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "country_fallback_exchange_rates" ADD CONSTRAINT "country_fallback_exchange_rates_from_currency_id_fkey" FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "country_fallback_exchange_rates" ADD CONSTRAINT "country_fallback_exchange_rates_to_currency_id_fkey" FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "country_fallback_exchange_rates" ADD CONSTRAINT "country_fallback_exchange_rates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_godown_permissions" ADD CONSTRAINT "city_godown_permissions_from_city_id_fkey" FOREIGN KEY ("from_city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_godown_permissions" ADD CONSTRAINT "city_godown_permissions_to_city_id_fkey" FOREIGN KEY ("to_city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_currencies" ADD CONSTRAINT "city_currencies_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_currencies" ADD CONSTRAINT "city_currencies_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "users" ADD CONSTRAINT "users_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "godowns" ADD CONSTRAINT "godowns_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "godown_transfers" ADD CONSTRAINT "godown_transfers_from_godown_id_fkey" FOREIGN KEY ("from_godown_id") REFERENCES "godowns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "godown_transfers" ADD CONSTRAINT "godown_transfers_to_godown_id_fkey" FOREIGN KEY ("to_godown_id") REFERENCES "godowns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "godown_transfers" ADD CONSTRAINT "godown_transfers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "godown_transfers" ADD CONSTRAINT "godown_transfers_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "godown_transfers" ADD CONSTRAINT "godown_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "customers" ADD CONSTRAINT "customers_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_cashes" ADD CONSTRAINT "opening_cashes_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_cashes" ADD CONSTRAINT "opening_cashes_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_cashes" ADD CONSTRAINT "opening_cashes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_haji_balances" ADD CONSTRAINT "opening_haji_balances_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_haji_balances" ADD CONSTRAINT "opening_haji_balances_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_haji_balances" ADD CONSTRAINT "opening_haji_balances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_customer_balances" ADD CONSTRAINT "opening_customer_balances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_customer_balances" ADD CONSTRAINT "opening_customer_balances_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_customer_balances" ADD CONSTRAINT "opening_customer_balances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_stocks" ADD CONSTRAINT "opening_stocks_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_stocks" ADD CONSTRAINT "opening_stocks_godown_id_fkey" FOREIGN KEY ("godown_id") REFERENCES "godowns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_stocks" ADD CONSTRAINT "opening_stocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_stocks" ADD CONSTRAINT "opening_stocks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_bank_balances" ADD CONSTRAINT "opening_bank_balances_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_bank_balances" ADD CONSTRAINT "opening_bank_balances_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_bank_balances" ADD CONSTRAINT "opening_bank_balances_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_bank_balances" ADD CONSTRAINT "opening_bank_balances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_cheques" ADD CONSTRAINT "opening_cheques_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_cheques" ADD CONSTRAINT "opening_cheques_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_cheques" ADD CONSTRAINT "opening_cheques_bank_deposit_id_fkey" FOREIGN KEY ("bank_deposit_id") REFERENCES "bank_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_cheques" ADD CONSTRAINT "opening_cheques_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_cheques" ADD CONSTRAINT "opening_cheques_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_inventory_valuations" ADD CONSTRAINT "opening_inventory_valuations_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_inventory_valuations" ADD CONSTRAINT "opening_inventory_valuations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_inventory_valuations" ADD CONSTRAINT "opening_inventory_valuations_original_currency_id_fkey" FOREIGN KEY ("original_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_inventory_valuations" ADD CONSTRAINT "opening_inventory_valuations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_super_admin_account_balances" ADD CONSTRAINT "opening_super_admin_account_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_super_admin_account_balances" ADD CONSTRAINT "opening_super_admin_account_balances_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_super_admin_account_balances" ADD CONSTRAINT "opening_super_admin_account_balances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_equity_allocations" ADD CONSTRAINT "opening_equity_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_city_packages" ADD CONSTRAINT "opening_city_packages_cutover_id_fkey" FOREIGN KEY ("cutover_id") REFERENCES "opening_cutovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_city_packages" ADD CONSTRAINT "opening_city_packages_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_city_due_balances" ADD CONSTRAINT "opening_city_due_balances_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "opening_city_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_city_due_balances" ADD CONSTRAINT "opening_city_due_balances_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_cutover_entries" ADD CONSTRAINT "opening_cutover_entries_cutover_id_fkey" FOREIGN KEY ("cutover_id") REFERENCES "opening_cutovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_participant_balances" ADD CONSTRAINT "opening_participant_balances_cutover_id_fkey" FOREIGN KEY ("cutover_id") REFERENCES "opening_cutovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_participant_balances" ADD CONSTRAINT "opening_participant_balances_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lots" ADD CONSTRAINT "lots_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lots" ADD CONSTRAINT "lots_consignee_id_fkey" FOREIGN KEY ("consignee_id") REFERENCES "consignees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lots" ADD CONSTRAINT "lots_destination_city_id_fkey" FOREIGN KEY ("destination_city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lots" ADD CONSTRAINT "lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lots" ADD CONSTRAINT "lots_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "consignees" ADD CONSTRAINT "consignees_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "consignees" ADD CONSTRAINT "consignees_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "consignees" ADD CONSTRAINT "consignees_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_documents" ADD CONSTRAINT "lot_documents_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_documents" ADD CONSTRAINT "lot_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_documents" ADD CONSTRAINT "lot_documents_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_status_history" ADD CONSTRAINT "lot_status_history_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_status_history" ADD CONSTRAINT "lot_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_products" ADD CONSTRAINT "lot_products_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_products" ADD CONSTRAINT "lot_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_city_distributions" ADD CONSTRAINT "lot_city_distributions_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_city_distributions" ADD CONSTRAINT "lot_city_distributions_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_city_distributions" ADD CONSTRAINT "lot_city_distributions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_city_godown_allocations" ADD CONSTRAINT "lot_city_godown_allocations_lot_city_distribution_id_fkey" FOREIGN KEY ("lot_city_distribution_id") REFERENCES "lot_city_distributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_city_godown_allocations" ADD CONSTRAINT "lot_city_godown_allocations_godown_id_fkey" FOREIGN KEY ("godown_id") REFERENCES "godowns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_city_godown_allocations" ADD CONSTRAINT "lot_city_godown_allocations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "voucher_sequences" ADD CONSTRAINT "voucher_sequences_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sales" ADD CONSTRAINT "sales_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sales" ADD CONSTRAINT "sales_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sales" ADD CONSTRAINT "sales_godown_id_fkey" FOREIGN KEY ("godown_id") REFERENCES "godowns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sales" ADD CONSTRAINT "sales_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sales" ADD CONSTRAINT "sales_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_applied_to_lot_id_fkey" FOREIGN KEY ("applied_to_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sale_discounts" ADD CONSTRAINT "sale_discounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_deposit_id_fkey" FOREIGN KEY ("bank_deposit_id") REFERENCES "bank_deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payment_lot_transfers" ADD CONSTRAINT "payment_lot_transfers_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payment_lot_transfers" ADD CONSTRAINT "payment_lot_transfers_from_lot_id_fkey" FOREIGN KEY ("from_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payment_lot_transfers" ADD CONSTRAINT "payment_lot_transfers_to_lot_id_fkey" FOREIGN KEY ("to_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "payment_lot_transfers" ADD CONSTRAINT "payment_lot_transfers_transferred_by_fkey" FOREIGN KEY ("transferred_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "expenses" ADD CONSTRAINT "expenses_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "expenses" ADD CONSTRAINT "expenses_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cheque_payment_id_fkey" FOREIGN KEY ("cheque_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "expenses" ADD CONSTRAINT "expenses_customer_payment_id_fkey" FOREIGN KEY ("customer_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "personal_withdrawals" ADD CONSTRAINT "personal_withdrawals_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "personal_withdrawals" ADD CONSTRAINT "personal_withdrawals_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "personal_withdrawals" ADD CONSTRAINT "personal_withdrawals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "personal_withdrawals" ADD CONSTRAINT "personal_withdrawals_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "personal_withdrawals" ADD CONSTRAINT "personal_withdrawals_haji_transfer_id_fkey" FOREIGN KEY ("haji_transfer_id") REFERENCES "haji_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "personal_withdrawals" ADD CONSTRAINT "personal_withdrawals_cheque_payment_id_fkey" FOREIGN KEY ("cheque_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "personal_withdrawals" ADD CONSTRAINT "personal_withdrawals_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "personal_withdrawals" ADD CONSTRAINT "personal_withdrawals_customer_payment_id_fkey" FOREIGN KEY ("customer_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "withdrawee_names" ADD CONSTRAINT "withdrawee_names_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "withdrawee_names" ADD CONSTRAINT "withdrawee_names_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_cheque_payment_id_fkey" FOREIGN KEY ("cheque_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_super_admin_cash_account_id_fkey" FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_settlement_overflows" ADD CONSTRAINT "lot_settlement_overflows_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_settlement_overflows" ADD CONSTRAINT "lot_settlement_overflows_from_lot_id_fkey" FOREIGN KEY ("from_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_settlement_overflows" ADD CONSTRAINT "lot_settlement_overflows_to_lot_id_fkey" FOREIGN KEY ("to_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_settlement_overflows" ADD CONSTRAINT "lot_settlement_overflows_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_settlement_overflows" ADD CONSTRAINT "lot_settlement_overflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_settlement_unresolved_overflows" ADD CONSTRAINT "lot_settlement_unresolved_overflows_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_settlement_unresolved_overflows" ADD CONSTRAINT "lot_settlement_unresolved_overflows_from_lot_id_fkey" FOREIGN KEY ("from_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_settlement_unresolved_overflows" ADD CONSTRAINT "lot_settlement_unresolved_overflows_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_settlement_unresolved_overflows" ADD CONSTRAINT "lot_settlement_unresolved_overflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_bank_accounts" ADD CONSTRAINT "super_admin_bank_accounts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_bank_accounts" ADD CONSTRAINT "super_admin_bank_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_personal_expenses" ADD CONSTRAINT "super_admin_personal_expenses_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_personal_expenses" ADD CONSTRAINT "super_admin_personal_expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "accounts" ADD CONSTRAINT "accounts_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "agents" ADD CONSTRAINT "agents_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "agents" ADD CONSTRAINT "agents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_super_admin_cash_account_id_fkey" FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_transfers" ADD CONSTRAINT "city_transfers_from_city_id_fkey" FOREIGN KEY ("from_city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_transfers" ADD CONSTRAINT "city_transfers_to_city_id_fkey" FOREIGN KEY ("to_city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_transfers" ADD CONSTRAINT "city_transfers_from_godown_id_fkey" FOREIGN KEY ("from_godown_id") REFERENCES "godowns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_transfers" ADD CONSTRAINT "city_transfers_to_godown_id_fkey" FOREIGN KEY ("to_godown_id") REFERENCES "godowns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_transfers" ADD CONSTRAINT "city_transfers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_transfers" ADD CONSTRAINT "city_transfers_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_transfers" ADD CONSTRAINT "city_transfers_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_transfers" ADD CONSTRAINT "city_transfers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_purchases" ADD CONSTRAINT "lot_purchases_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_purchases" ADD CONSTRAINT "lot_purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_purchases" ADD CONSTRAINT "lot_purchases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_purchases" ADD CONSTRAINT "lot_purchases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_shipping_line_id_fkey" FOREIGN KEY ("shipping_line_id") REFERENCES "shipping_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_allocated_product_id_fkey" FOREIGN KEY ("allocated_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_super_admin_cash_account_id_fkey" FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "shipping_line_payments" ADD CONSTRAINT "shipping_line_payments_shipping_line_id_fkey" FOREIGN KEY ("shipping_line_id") REFERENCES "shipping_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "shipping_line_payments" ADD CONSTRAINT "shipping_line_payments_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "shipping_line_payments" ADD CONSTRAINT "shipping_line_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "shipping_line_payments" ADD CONSTRAINT "shipping_line_payments_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "shipping_line_payments" ADD CONSTRAINT "shipping_line_payments_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "shipping_line_payments" ADD CONSTRAINT "shipping_line_payments_super_admin_cash_account_id_fkey" FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "shipping_line_payments" ADD CONSTRAINT "shipping_line_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_sale_entity_id_fkey" FOREIGN KEY ("sale_entity_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_payment_entity_id_fkey" FOREIGN KEY ("payment_entity_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_godown_transfer_entity_id_fkey" FOREIGN KEY ("godown_transfer_entity_id") REFERENCES "godown_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_expense_entity_id_fkey" FOREIGN KEY ("expense_entity_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_haji_transfer_entity_id_fkey" FOREIGN KEY ("haji_transfer_entity_id") REFERENCES "haji_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "sync_requests" ADD CONSTRAINT "sync_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "inventory_thresholds" ADD CONSTRAINT "inventory_thresholds_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "inventory_thresholds" ADD CONSTRAINT "inventory_thresholds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "inventory_thresholds" ADD CONSTRAINT "inventory_thresholds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investors" ADD CONSTRAINT "investors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_accounts" ADD CONSTRAINT "investor_accounts_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_accounts" ADD CONSTRAINT "investor_accounts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_accounts" ADD CONSTRAINT "investor_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_deposits" ADD CONSTRAINT "investor_deposits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "investor_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_deposits" ADD CONSTRAINT "investor_deposits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_withdrawals" ADD CONSTRAINT "investor_withdrawals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "investor_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_withdrawals" ADD CONSTRAINT "investor_withdrawals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participants" ADD CONSTRAINT "investment_participants_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_capital_events" ADD CONSTRAINT "investment_capital_events_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_profit_share_events" ADD CONSTRAINT "investment_profit_share_events_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "profit_attribution_periods" ADD CONSTRAINT "profit_attribution_periods_reversal_of_period_id_fkey" FOREIGN KEY ("reversal_of_period_id") REFERENCES "profit_attribution_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "profit_attribution_lines" ADD CONSTRAINT "profit_attribution_lines_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "profit_attribution_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "profit_attribution_lines" ADD CONSTRAINT "profit_attribution_lines_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_residual_attributions" ADD CONSTRAINT "investor_residual_attributions_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "profit_attribution_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_residual_attributions" ADD CONSTRAINT "investor_residual_attributions_original_participant_id_fkey" FOREIGN KEY ("original_participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_residual_attributions" ADD CONSTRAINT "investor_residual_attributions_manager_participant_id_fkey" FOREIGN KEY ("manager_participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_attribution_ledger_entries" ADD CONSTRAINT "investor_attribution_ledger_entries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "profit_attribution_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_attribution_ledger_entries" ADD CONSTRAINT "investor_attribution_ledger_entries_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investor_attribution_ledger_entries" ADD CONSTRAINT "investor_attribution_ledger_entries_reversal_of_entry_id_fkey" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "investor_attribution_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_actions" ADD CONSTRAINT "investment_participant_actions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_actions" ADD CONSTRAINT "investment_participant_actions_capital_event_id_fkey" FOREIGN KEY ("capital_event_id") REFERENCES "investment_capital_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_actions" ADD CONSTRAINT "investment_participant_actions_reversal_of_action_id_fkey" FOREIGN KEY ("reversal_of_action_id") REFERENCES "investment_participant_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_action_ledger_entries" ADD CONSTRAINT "investment_participant_action_ledger_entries_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "investment_participant_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_action_ledger_entries" ADD CONSTRAINT "investment_participant_action_ledger_entries_participant_i_fkey" FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_action_ledger_entries" ADD CONSTRAINT "investment_participant_action_ledger_entries_reversal_of_e_fkey" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "investment_participant_action_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlements" ADD CONSTRAINT "investment_participant_settlements_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "investment_participant_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlements" ADD CONSTRAINT "investment_participant_settlements_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlements" ADD CONSTRAINT "investment_participant_settlements_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlements" ADD CONSTRAINT "investment_participant_settlements_reversal_of_settlement__fkey" FOREIGN KEY ("reversal_of_settlement_id") REFERENCES "investment_participant_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlement_payments" ADD CONSTRAINT "investment_participant_settlement_payments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "investment_participant_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlement_payments" ADD CONSTRAINT "investment_participant_settlement_payments_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "investment_participant_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlement_payments" ADD CONSTRAINT "investment_participant_settlement_payments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "investment_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlement_payments" ADD CONSTRAINT "investment_participant_settlement_payments_super_admin_ban_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlement_payments" ADD CONSTRAINT "investment_participant_settlement_payments_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "investment_participant_settlement_payments" ADD CONSTRAINT "investment_participant_settlement_payments_reversal_of_pay_fkey" FOREIGN KEY ("reversal_of_payment_id") REFERENCES "investment_participant_settlement_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_deposits" ADD CONSTRAINT "intermediary_deposits_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_deposits" ADD CONSTRAINT "intermediary_deposits_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_deposits" ADD CONSTRAINT "intermediary_deposits_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_deposits" ADD CONSTRAINT "intermediary_deposits_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_deposits" ADD CONSTRAINT "intermediary_deposits_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_deposits" ADD CONSTRAINT "intermediary_deposits_super_admin_cash_account_id_fkey" FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_deposits" ADD CONSTRAINT "intermediary_deposits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_cash_receipts" ADD CONSTRAINT "haji_cash_receipts_super_admin_cash_account_id_fkey" FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_cash_receipts" ADD CONSTRAINT "haji_cash_receipts_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_cash_receipts" ADD CONSTRAINT "haji_cash_receipts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "haji_cash_receipts" ADD CONSTRAINT "haji_cash_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_exchanges" ADD CONSTRAINT "intermediary_exchanges_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_exchanges" ADD CONSTRAINT "intermediary_exchanges_base_currency_id_fkey" FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_exchanges" ADD CONSTRAINT "intermediary_exchanges_quote_currency_id_fkey" FOREIGN KEY ("quote_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_exchanges" ADD CONSTRAINT "intermediary_exchanges_from_currency_id_fkey" FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_exchanges" ADD CONSTRAINT "intermediary_exchanges_to_currency_id_fkey" FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_exchanges" ADD CONSTRAINT "intermediary_exchanges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_exchanges" ADD CONSTRAINT "intermediary_exchanges_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_usd_cost_layers" ADD CONSTRAINT "intermediary_usd_cost_layers_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_usd_cost_layers" ADD CONSTRAINT "intermediary_usd_cost_layers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_usd_cost_usages" ADD CONSTRAINT "intermediary_usd_cost_usages_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "intermediary_usd_cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_usd_cost_usages" ADD CONSTRAINT "intermediary_usd_cost_usages_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_usd_cost_usages" ADD CONSTRAINT "intermediary_usd_cost_usages_supplier_payment_id_fkey" FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "intermediary_usd_cost_usages" ADD CONSTRAINT "intermediary_usd_cost_usages_shipping_line_payment_id_fkey" FOREIGN KEY ("shipping_line_payment_id") REFERENCES "shipping_line_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_liabilities" ADD CONSTRAINT "opening_liabilities_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_liabilities" ADD CONSTRAINT "opening_liabilities_shipping_line_id_fkey" FOREIGN KEY ("shipping_line_id") REFERENCES "shipping_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_liabilities" ADD CONSTRAINT "opening_liabilities_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_liabilities" ADD CONSTRAINT "opening_liabilities_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_liabilities" ADD CONSTRAINT "opening_liabilities_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_liabilities" ADD CONSTRAINT "opening_liabilities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_accounts" ADD CONSTRAINT "super_admin_liability_accounts_control_account_id_fkey" FOREIGN KEY ("control_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_accounts" ADD CONSTRAINT "super_admin_liability_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "super_admin_liability_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_super_admin_bank_account_id_fkey" FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_super_admin_cash_account_id_fkey" FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_intermediary_id_fkey" FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_counter_account_id_fkey" FOREIGN KEY ("counter_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_reversed_entry_id_fkey" FOREIGN KEY ("reversed_entry_id") REFERENCES "super_admin_liability_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_liability_entries" ADD CONSTRAINT "super_admin_liability_entries_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_from_currency_id_fkey" FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_to_currency_id_fkey" FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "super_admin_account_transfers" ADD CONSTRAINT "super_admin_account_transfers_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_liability_accounts" ADD CONSTRAINT "city_liability_accounts_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_liability_accounts" ADD CONSTRAINT "city_liability_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_liability_entries" ADD CONSTRAINT "city_liability_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "city_liability_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_liability_entries" ADD CONSTRAINT "city_liability_entries_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_liability_entries" ADD CONSTRAINT "city_liability_entries_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_liability_entries" ADD CONSTRAINT "city_liability_entries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_liability_entries" ADD CONSTRAINT "city_liability_entries_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_liability_entries" ADD CONSTRAINT "city_liability_entries_cheque_payment_id_fkey" FOREIGN KEY ("cheque_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "city_liability_entries" ADD CONSTRAINT "city_liability_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_city_liabilities" ADD CONSTRAINT "opening_city_liabilities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "city_liability_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_city_liabilities" ADD CONSTRAINT "opening_city_liabilities_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_city_liabilities" ADD CONSTRAINT "opening_city_liabilities_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "opening_city_liabilities" ADD CONSTRAINT "opening_city_liabilities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "investor_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    
    -- AddForeignKey
    ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$baseline$;
