/**
 * Build public/offline-seed.json from the live database for packaged app first launch.
 *
 * Usage:
 *   npm run offline-seed:generate
 *   npm run offline-seed:generate -- --city=Lahore
 *   npm run offline-seed:generate -- --city-id=2
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
import { join } from "path";
import { buildOfflineSyncPayload, type OfflineSyncScope } from "../src/lib/offline-sync-payload.server";

function parseArgs(): { cityName?: string; cityId?: number } {
  const cityArg = process.argv.find((a) => a.startsWith("--city="));
  const cityIdArg = process.argv.find((a) => a.startsWith("--city-id="));
  return {
    cityName: cityArg?.slice("--city=".length).trim() || undefined,
    cityId: cityIdArg ? Number(cityIdArg.slice("--city-id=".length)) : undefined,
  };
}

async function resolveScope(
  prisma: PrismaClient,
  args: ReturnType<typeof parseArgs>
): Promise<{ scope: OfflineSyncScope; label: string }> {
  if (args.cityId != null && !Number.isFinite(args.cityId)) {
    throw new Error(`Invalid --city-id=${args.cityId}`);
  }

  if (args.cityName || args.cityId != null) {
    const city = args.cityId
      ? await prisma.city.findUnique({ where: { id: args.cityId } })
      : await prisma.city.findFirst({
          where: { name: { equals: args.cityName!, mode: "insensitive" } },
        });

    if (!city) {
      throw new Error(
        args.cityId
          ? `City not found for id ${args.cityId}`
          : `City not found: ${args.cityName}`
      );
    }

    return {
      scope: { role: "city_admin", cityId: city.id, countryId: city.countryId },
      label: city.name,
    };
  }

  return { scope: { role: "super_admin" }, label: "super_admin" };
}

async function main() {
  const prisma = new PrismaClient();
  const args = parseArgs();

  try {
    const { scope, label } = await resolveScope(prisma, args);
    const modules = await buildOfflineSyncPayload(prisma, scope);
    const bundle = {
      version: 1,
      generatedAt: new Date().toISOString(),
      scope: {
        role: scope.role,
        ...(scope.role === "city_admin"
          ? { cityId: scope.cityId, cityName: label, countryId: scope.countryId }
          : {}),
      },
      modules,
    };

    const outPath = join(process.cwd(), "public", "offline-seed.json");
    writeFileSync(outPath, JSON.stringify(bundle));
    const moduleCount = Object.keys(modules).length;
    console.log(`Wrote ${outPath} (${label}, ${moduleCount} modules)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
