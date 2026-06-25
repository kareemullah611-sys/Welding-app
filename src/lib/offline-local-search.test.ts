import test from "node:test";
import assert from "node:assert/strict";
import { buildOfflineSearchResults } from "@/lib/offline-local-search";

test("buildOfflineSearchResults maps customer rows by name", () => {
  const results = buildOfflineSearchResults(
    {
      customers: [{ id: 1, name: "Ali Traders", phone: "0700", cityId: 5, cityName: "Kandahar" }],
    },
    { q: "ali", type: "customers", scopedCityId: 5 }
  );
  assert.equal(results.customers.length, 1);
  assert.equal((results.customers[0] as { name: string }).name, "Ali Traders");
});

test("buildOfflineSearchResults filters by city scope", () => {
  const results = buildOfflineSearchResults(
    {
      customers: [
        { id: 1, name: "Ali Traders", cityId: 5 },
        { id: 2, name: "Ali Abdul Khaliq", cityId: 6 },
      ],
    },
    { q: "ali", type: "customers", scopedCityId: 5 }
  );
  assert.equal(results.customers.length, 1);
  assert.equal((results.customers[0] as { id: number }).id, 1);
});
