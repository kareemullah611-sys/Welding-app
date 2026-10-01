#!/usr/bin/env node
// Asserts an E2E run left zero residue.
//
// Usage:
//   node --import tsx scripts/e2e-residue-check.ts snapshot   # writes baseline
//   node --import tsx scripts/e2e-residue-check.ts verify     # compares to baseline
import fs from "node:fs";
import path from "node:path";

import prisma from "../src/lib/prisma";
import { e2eResidueSnapshot } from "./e2e-fixture-lifecycle";

const BASELINE_FILE = path.join(process.cwd(), ".e2e-residue-baseline.json");

async function main() {
  const cmd = process.argv[2];
  const snapshot = await e2eResidueSnapshot();

  if (cmd === "snapshot") {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(snapshot, null, 2));
    console.log("baseline", JSON.stringify(snapshot));
    return;
  }

  if (cmd === "verify") {
    if (!fs.existsSync(BASELINE_FILE)) {
      console.error("no baseline captured; run 'snapshot' before the E2E run");
      process.exit(1);
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) as Record<string, number>;
    const growth = Object.entries(snapshot)
      .map(([table, count]) => ({ table, delta: count - baseline[table] }))
      .filter((row) => row.delta !== 0);

    if (growth.length > 0) {
      console.error("E2E residue detected:");
      for (const row of growth) console.error(`  ${row.table}: ${row.delta > 0 ? "+" : ""}${row.delta}`);
      process.exit(1);
    }
    console.log("zero residue: all E2E-sensitive tables unchanged");
    return;
  }

  console.error("usage: e2e-residue-check.ts snapshot|verify");
  process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
