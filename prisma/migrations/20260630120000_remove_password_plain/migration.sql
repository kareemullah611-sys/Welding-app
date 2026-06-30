-- Drop plaintext password storage (passwords are stored only as bcrypt hashes).
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_plain";
