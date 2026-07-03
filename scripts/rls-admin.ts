import { PrismaClient } from "@prisma/client";

type RlsStatusRow = {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: bigint | number;
};

const prisma = new PrismaClient();

function selectedAction(): "status" | "enable" | "disable" {
  const actions = [
    process.argv.includes("--status") ? "status" : null,
    process.argv.includes("--enable") ? "enable" : null,
    process.argv.includes("--disable") ? "disable" : null,
  ].filter(Boolean);

  if (actions.length !== 1) {
    throw new Error("Choose exactly one RLS action: --status, --enable, or --disable.");
  }

  return actions[0] as "status" | "enable" | "disable";
}

function requireEnv(name: string, expected: string, message: string) {
  if (process.env[name] !== expected) {
    throw new Error(`${message} Set ${name}=${expected}.`);
  }
}

async function printStatus(label: string) {
  const rows = await prisma.$queryRaw<RlsStatusRow[]>`
    SELECT * FROM app_security.city_rls_status()
    ORDER BY table_name
  `;

  console.log(label);
  console.table(
    rows.map((row) => ({
      table: row.table_name,
      enabled: row.rls_enabled,
      forced: row.rls_forced,
      policies: Number(row.policy_count),
    }))
  );
}

async function enableCityRls() {
  requireEnv(
    "ENABLE_PRISMA_RLS_CONTEXT",
    "true",
    "RLS cannot be enabled until every authenticated request sets transaction-scoped Prisma context."
  );
  requireEnv(
    "CONFIRM_ENABLE_CITY_RLS",
    "YES",
    "Enabling city RLS changes database enforcement and must be confirmed explicitly."
  );

  await printStatus("Before enabling city RLS:");
  await prisma.$queryRaw`SELECT app_security.enable_city_rls()`;
  await printStatus("After enabling city RLS:");
}

async function disableCityRls() {
  requireEnv(
    "CONFIRM_DISABLE_CITY_RLS",
    "YES",
    "Disabling city RLS changes database enforcement and must be confirmed explicitly."
  );

  await printStatus("Before disabling city RLS:");
  await prisma.$queryRaw`SELECT app_security.disable_city_rls()`;
  await printStatus("After disabling city RLS:");
}

async function main() {
  const action = selectedAction();

  if (action === "status") {
    await printStatus("City RLS status:");
  } else if (action === "enable") {
    await enableCityRls();
  } else {
    await disableCityRls();
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("RLS admin action failed:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
