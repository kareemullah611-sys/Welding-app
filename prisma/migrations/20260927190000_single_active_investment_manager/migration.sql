CREATE UNIQUE INDEX IF NOT EXISTS "investment_participants_single_active_manager_key"
ON "investment_participants" ("type")
WHERE "type" = 'manager' AND "is_active" = true;
