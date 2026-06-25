-- Rename Afghanistan cities: Kabul → Saif Uddin, Herat → Abdul Khaliq
UPDATE cities c
SET name = 'Saif Uddin'
FROM countries co
WHERE c.country_id = co.id
  AND co.code = 'AF'
  AND c.name = 'Kabul';

UPDATE cities c
SET name = 'Abdul Khaliq'
FROM countries co
WHERE c.country_id = co.id
  AND co.code = 'AF'
  AND c.name = 'Herat';

UPDATE godowns g
SET name = 'Saif Uddin Main Godown'
FROM cities c
JOIN countries co ON co.id = c.country_id
WHERE g.city_id = c.id
  AND co.code = 'AF'
  AND c.name = 'Saif Uddin'
  AND g.name = 'Kabul Main Godown';

UPDATE godowns g
SET name = 'Abdul Khaliq Warehouse'
FROM cities c
JOIN countries co ON co.id = c.country_id
WHERE g.city_id = c.id
  AND co.code = 'AF'
  AND c.name = 'Abdul Khaliq'
  AND g.name = 'Herat Warehouse';

UPDATE users u
SET full_name = 'Saif Uddin Admin'
WHERE u.username = 'kabul_admin';

UPDATE users u
SET full_name = 'Abdul Khaliq Admin'
WHERE u.username = 'herat_admin';
