import assert from "node:assert/strict";
import test from "node:test";
import { countPendingInterGodownTransfers } from "@/lib/offline-inventory";

test("counts queued offline inter-godown transfer creates", () => {
  const queued = [
    { url: "/api/v1/godowns/transfers", method: "POST", body: JSON.stringify({ qty: 10 }) },
    { url: "/api/v1/godowns/transfers", method: "POST", body: JSON.stringify({ qty: 2 }) },
    { url: "/api/v1/godowns/transfers", method: "POST", body: JSON.stringify({ qty: 0 }) },
    { url: "/api/v1/godowns/transfers", method: "PUT", body: JSON.stringify({ qty: 8 }) },
    { url: "/api/v1/payments", method: "POST", body: JSON.stringify({ amount: 100 }) },
  ];

  assert.equal(countPendingInterGodownTransfers(queued as any), 2);
});
