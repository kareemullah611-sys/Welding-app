import { execSync } from "node:child_process";

const MIGRATE_CMD = "npx prisma migrate deploy";
const MAX_ATTEMPTS = 8;

function errorToText(error: unknown): string {
  const e = error as { message?: string; stderr?: Buffer | string; stdout?: Buffer | string };
  const stderr = Buffer.isBuffer(e?.stderr) ? e.stderr.toString("utf8") : String(e?.stderr || "");
  const stdout = Buffer.isBuffer(e?.stdout) ? e.stdout.toString("utf8") : String(e?.stdout || "");
  return `${e?.message || ""}\n${stderr}\n${stdout}`;
}

export function isPrismaP1002(error: unknown): boolean {
  const text = errorToText(error);
  return /P1002/i.test(text) || /advisory lock/i.test(text) || /pg_advisory_lock/i.test(text);
}

export function assertProductionDatabaseEnv(): void {
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.RENDER === "true";
  if (!isProduction) return;

  const direct = (process.env.DIRECT_URL || "").trim();
  if (!direct) {
    throw new Error(
      "DIRECT_URL is required in production. Set Neon direct URL (non-pooler) in Render secrets."
    );
  }
  if (direct.includes("-pooler.") || /[?&]pgbouncer=true/i.test(direct)) {
    throw new Error(
      "DIRECT_URL must use Neon direct host (no -pooler, no pgbouncer). Migrations cannot run through the pooler."
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runMigrateDeployWithRetry(options?: { stdio?: "inherit" | "pipe" }): Promise<void> {
  assertProductionDatabaseEnv();
  const stdio = options?.stdio ?? "inherit";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      execSync(MIGRATE_CMD, { stdio });
      return;
    } catch (error) {
      if (isPrismaP1002(error) && attempt < MAX_ATTEMPTS - 1) {
        const waitMs = Math.min(30_000, 5_000 * (attempt + 1));
        console.warn(
          `Migration lock/timeout (attempt ${attempt + 1}/${MAX_ATTEMPTS}). Retrying in ${waitMs / 1000}s...`
        );
        await sleep(waitMs);
        continue;
      }
      throw error;
    }
  }
}

async function main() {
  console.log("Running prisma migrate deploy...");
  await runMigrateDeployWithRetry({ stdio: "inherit" });
  console.log("Migrations applied.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("migrate deploy failed:", error);
    process.exit(1);
  });
}
