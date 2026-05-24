#!/usr/bin/env tsx
/**
 * Generate public/offline-seed.json from the live database (super-admin scope).
 * Run before packaging DMG/APK when DATABASE_URL is available:
 *   npm run offline-seed:generate
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildOfflineSyncPayload } from "../src/lib/offline-sync-payload.server";

async function main() {
  const prisma = new PrismaClient();
  try {
    const modules = await buildOfflineSyncPayload(prisma, { role: "super_admin" });
    const generatedAt = new Date().toISOString();
    const outPath = path.join(process.cwd(), "public", "offline-seed.json");
    const bundle = {
      version: 1,
      generatedAt,
      modules,
    };
    writeFileSync(outPath, `${JSON.stringify(bundle, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`, "utf8");
    const counts = (modules.counts as Record<string, number>) || {};
    const totalRows = Object.values(counts).reduce((s, n) => s + n, 0);
    console.log(`Wrote ${outPath} (${totalRows} total rows across ${Object.keys(counts).length} modules)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("offline-seed:generate failed:", err);
  process.exit(1);
});
