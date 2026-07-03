import crypto from "crypto";

const ENCRYPTION_PREFIX = "enc:v1:";
const MIN_KEY_LENGTH = 32;

function getEncryptionKey(): Buffer {
  const secret = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret || (process.env.NODE_ENV === "production" && secret.length < MIN_KEY_LENGTH)) {
    throw new Error("DATA_ENCRYPTION_KEY must be set to at least 32 characters in production.");
  }
  return crypto.createHash("sha256").update(secret || "development-only-sensitive-data-key").digest();
}

export function isEncryptedSensitiveText(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTION_PREFIX);
}

export function encryptSensitiveText(value: string | null | undefined): string | null {
  if (value == null || value === "") return value ?? null;
  if (isEncryptedSensitiveText(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSensitiveText(value: string | null | undefined): string | null {
  if (value == null || value === "") return value ?? null;
  if (!isEncryptedSensitiveText(value)) return value;
  const [, , ivRaw, tagRaw, encryptedRaw] = value.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptSensitiveFields<T>(input: T): T {
  if (!input || typeof input !== "object") return input;
  if (input instanceof Date) return input;
  if (Array.isArray(input)) return input.map((item) => decryptSensitiveFields(item)) as T;
  const output = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(output)) {
    if (key === "accountNumber" && typeof value === "string") {
      output[key] = decryptSensitiveText(value);
    } else if (value && typeof value === "object") {
      output[key] = decryptSensitiveFields(value);
    }
  }
  return input;
}

export function encryptAccountNumberInData<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map((item) => encryptAccountNumberInData(item)) as T;
  const output = data as Record<string, unknown>;
  if (typeof output.accountNumber === "string") {
    output.accountNumber = encryptSensitiveText(output.accountNumber);
  }
  return data;
}
