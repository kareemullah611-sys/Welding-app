import test from "node:test";
import assert from "node:assert/strict";
import { getOfflineFormReadinessError } from "@/lib/offline-readiness";

test("returns null when online", () => {
  assert.equal(
    getOfflineFormReadinessError({ isOnline: true, currencyCount: 0, moduleTitle: "Payment" }),
    null,
  );
});

test("returns null when offline and currencies are seeded", () => {
  assert.equal(
    getOfflineFormReadinessError({ isOnline: false, currencyCount: 1, moduleTitle: "Payment" }),
    null,
  );
});

test("returns helpful error when offline and currencies are missing", () => {
  const message = getOfflineFormReadinessError({
    isOnline: false,
    currencyCount: 0,
    moduleTitle: "Payment",
  });
  assert.equal(
    message,
    "Offline Payment setup is not ready on this device yet. Connect internet once and open Payment, then you can use it offline.",
  );
});
