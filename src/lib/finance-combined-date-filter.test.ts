import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");
const ROUTE = "src/app/api/v1/finance/combined/route.ts";

/** The `where:` clause of the openingCash / openingBankBalance ledger queries. */
function openingRowWhere(source: string, model: string): string {
  const at = source.indexOf(`prisma.${model}.findMany({`);
  assert.ok(at > 0, `expected the route to query ${model}`);
  const close = source.indexOf("where:", at);
  assert.ok(close > at, `${model} has no where clause`);
  const end = source.indexOf("include:", close);
  return source.slice(close, end > close ? end : close + 200);
}

test("combined ledger rows respect the requested date range", () => {
  const source = read(ROUTE);

  // Every ledger query must merge dateWhere(<column>); opening rows used only
  // cityWhere, so they were returned for every range and made a filtered view
  // look non-empty even when no transaction fell inside it.
  for (const model of ["openingCash", "openingBankBalance"]) {
    const where = openingRowWhere(source, model);
    assert.match(where, /dateWhere\("(openingDate|cashDate|bankDate)"\)/, `${model} is not date filtered`);
  }
});

test("date filtering still spans the whole end date", () => {
  const dateRange = read("src/lib/date-range.ts");

  assert.match(dateRange, /if \(dateTo\) \{[\s\S]*?setUTCDate\(end\.getUTCDate\(\) \+ 1\);[\s\S]*?range\.lt = end;/);
  assert.match(dateRange, /if \(dateFrom\) range\.gte = parseDateOnly\(dateFrom\);/);
});