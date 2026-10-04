CREATE TABLE IF NOT EXISTS "app_branding" (
  "id" INTEGER NOT NULL,
  "system_name" VARCHAR(120) NOT NULL DEFAULT 'MRF Hardware',
  "logo_url" TEXT,
  "updated_by" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_branding_pkey" PRIMARY KEY ("id")
);

INSERT INTO "app_branding" ("id", "system_name", "updated_at")
VALUES (1, 'MRF Hardware', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
