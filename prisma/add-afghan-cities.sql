-- ============================================================
-- Add Kandahar and Wesh Border to Afghanistan
-- Run: psql welding_app -f prisma/add-afghan-cities.sql
-- ============================================================

BEGIN;

-- 1. Get Afghanistan country ID into a variable
DO $$
DECLARE
  af_id        INTEGER;
  afn_id       INTEGER;
  usd_id       INTEGER;
  kandahar_id  INTEGER;
  wesh_id      INTEGER;
  pwd_hash     TEXT := '$2a$12$dr5tbdvKjdtdaZYkiVWDZeCDUgDzLZfuMrP63e6yL4PrPMARnMSEy'; -- "city123"
BEGIN

  SELECT id INTO af_id  FROM countries WHERE code = 'AF';
  SELECT id INTO afn_id FROM currencies WHERE code = 'AFN';
  SELECT id INTO usd_id FROM currencies WHERE code = 'USD';

  -- 2. Cities
  INSERT INTO cities (country_id, name, is_active, created_at)
    VALUES (af_id, 'Kandahar',    true, NOW())
    ON CONFLICT (country_id, name) DO NOTHING;

  INSERT INTO cities (country_id, name, is_active, created_at)
    VALUES (af_id, 'Wesh Border', true, NOW())
    ON CONFLICT (country_id, name) DO NOTHING;

  SELECT id INTO kandahar_id FROM cities WHERE country_id = af_id AND name = 'Kandahar';
  SELECT id INTO wesh_id     FROM cities WHERE country_id = af_id AND name = 'Wesh Border';

  -- 3. City currencies (AFN + USD for both)
  INSERT INTO city_currencies (city_id, currency_id)
    VALUES (kandahar_id, afn_id), (kandahar_id, usd_id),
           (wesh_id,     afn_id), (wesh_id,     usd_id)
    ON CONFLICT (city_id, currency_id) DO NOTHING;

  -- 4. Voucher sequences
  INSERT INTO voucher_sequences (city_id, current_number)
    VALUES (kandahar_id, 0), (wesh_id, 0)
    ON CONFLICT (city_id) DO NOTHING;

  -- 5. City admin users
  INSERT INTO users (username, password_hash, full_name, role, city_id, created_at, updated_at)
    VALUES ('kandahar_admin', pwd_hash, 'Kandahar Admin', 'city_admin', kandahar_id, NOW(), NOW())
    ON CONFLICT (username) DO NOTHING;

  INSERT INTO users (username, password_hash, full_name, role, city_id, created_at, updated_at)
    VALUES ('wesh_admin', pwd_hash, 'Wesh Border Admin', 'city_admin', wesh_id, NOW(), NOW())
    ON CONFLICT (username) DO NOTHING;

  -- 6. Default godowns
  INSERT INTO godowns (city_id, name, is_active, created_at, updated_at)
    VALUES (kandahar_id, 'Kandahar Main Godown', true, NOW(), NOW())
    ON CONFLICT (city_id, name) DO NOTHING;

  INSERT INTO godowns (city_id, name, is_active, created_at, updated_at)
    VALUES (wesh_id, 'Wesh Border Godown', true, NOW(), NOW())
    ON CONFLICT (city_id, name) DO NOTHING;

  RAISE NOTICE '✅ Kandahar (id=%) and Wesh Border (id=%) added successfully.', kandahar_id, wesh_id;
END $$;

COMMIT;
