-- Migration: add exchange_rate and usd_equivalent columns to payments table
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS usd_equivalent DECIMAL(15,2);
