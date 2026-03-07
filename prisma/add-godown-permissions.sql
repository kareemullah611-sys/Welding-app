-- ============================================================
-- Create city_godown_permissions table and seed Wesh Border access
-- Run: psql welding_app -f prisma/add-godown-permissions.sql
-- ============================================================

BEGIN;

-- 1. Create permissions table
CREATE TABLE IF NOT EXISTS city_godown_permissions (
  id            SERIAL PRIMARY KEY,
  from_city_id  INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  to_city_id    INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_city_godown_perm UNIQUE(from_city_id, to_city_id)
);

-- 2. Grant Wesh Border access to all other Afghan city godowns
INSERT INTO city_godown_permissions (from_city_id, to_city_id)
SELECT
  (SELECT id FROM cities WHERE name = 'Wesh Border') AS from_city_id,
  c.id AS to_city_id
FROM cities c
WHERE c.name IN ('Kabul', 'Herat', 'Kandahar')
  AND c.country_id = (SELECT id FROM countries WHERE code = 'AF')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM city_godown_permissions
  WHERE from_city_id = (SELECT id FROM cities WHERE name = 'Wesh Border');
  RAISE NOTICE '✅ Wesh Border now has cross-city access to % city godown(s).', cnt;
END $$;

COMMIT;
