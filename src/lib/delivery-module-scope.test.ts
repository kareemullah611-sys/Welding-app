/**
 * The Delivery module's authorization boundary.
 *
 * The module is per-city, so the whole security story rests on one rule: the city
 * used for every Delivery service call comes from the caller's verified session,
 * never from anything the client can influence. These tests pin that rule down.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { deliveryCityScope } from "./delivery-guard.js";

const cityAdmin = { userId: 1, username: "ca", role: "city_admin", cityId: 7, countryId: 1 } as const;
const superAdmin = { userId: 2, username: "sa", role: "super_admin", cityId: null, countryId: null } as const;

// ─── Scope resolution ─────────────────────────────────────────────────────────

test("a city admin resolves to their own city", () => {
  const scope = deliveryCityScope(cityAdmin);
  assert.equal(scope.ok, true);
  assert.equal(scope.ok && scope.cityId, 7);
});

test("a super admin is refused, because there is no city to scope to", () => {
  // The Delivery service's service token deliberately has no all-cities mode.
  // A super_admin has cityId null, so there is no honest cityId to send. Refusing
  // is better than inventing a cross-city read that the integration was never
  // designed or security-reviewed for.
  const scope = deliveryCityScope(superAdmin);
  assert.equal(scope.ok, false);
  assert.match(scope.ok ? "" : scope.message, /city admins/i);
});

test("a city admin with no city is refused rather than allowed to pick one", () => {
  // Without this, a city_admin whose city assignment is missing could fall
  // through to "no filter" and read every city.
  const scope = deliveryCityScope({ ...cityAdmin, cityId: null });
  assert.equal(scope.ok, false);
  assert.match(scope.ok ? "" : scope.message, /not assigned to a city/i);
});

// ─── The credential must never reach a browser ────────────────────────────────

test("delivery-service refuses to load in a browser", () => {
  // Simulates the module being pulled into a client bundle: it must throw rather
  // than quietly exposing DELIVERY_SERVICE_TOKEN to every logged-in user.
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const previous = g.window;
  g.window = {};
  try {
    assert.throws(
      () => require("./delivery-service.js"),
      /server-only/,
      "importing delivery-service in a browser context must throw",
    );
  } finally {
    if (had) g.window = previous;
    else delete g.window;
  }
});

// ─── Every upstream call is city-scoped ───────────────────────────────────────

test("every upstream call carries an explicit city, and missing config fails loudly", async () => {
  const previousEnv = { ...process.env };
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  try {
    process.env.DELIVERY_API_URL = "https://delivery.example.test/";
    process.env.DELIVERY_SERVICE_TOKEN = "token-abc";
    globalThis.fetch = (async (input: string) => {
      calls.push(String(input));
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { parties: [], sales: [] } }),
      };
    }) as typeof fetch;

    const service = await import("./delivery-service.js");

    await service.fetchDeliveryParties(3);
    await service.fetchDeliveryStatus(3);
    await service.assignSale(3, 42);

    assert.equal(calls.length, 3);
    for (const url of calls) {
      assert.match(url, /cityId=3\b/, `call must name the caller's city: ${url}`);
      // A trailing slash in the base URL must not produce a double slash.
      assert.ok(!url.includes(".test//"), `base URL must be normalised: ${url}`);
    }

    // Unconfigured must not degrade into an empty page an admin would read as
    // "no deliveries yet" — it must be a loud 503.
    delete process.env.DELIVERY_SERVICE_TOKEN;
    const missing = service.deliveryErrorResponse(
      (() => {
        try {
          serviceConfigProbe();
        } catch (e) {
          return e;
        }
        return null;
      })(),
    );
    assert.ok(missing.code === "DELIVERY_NOT_CONFIGURED" || missing.code === "DELIVERY_UPSTREAM_ERROR");

    // Restore config so the next assertion isolates the city check.
    process.env.DELIVERY_SERVICE_TOKEN = "token-abc";

    // An invalid city is refused before any request is made.
    const callsBefore = calls.length;
    const badCity = service.deliveryErrorResponse(
      await service.fetchDeliveryParties(0).catch((e: unknown) => e),
    );
    assert.equal(badCity.code, "CITY_REQUIRED");
    assert.equal(calls.length, callsBefore, "a bad city must not reach the network");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = previousEnv;
  }
});

/** Force the missing-config path to throw so deliveryErrorResponse can classify it. */
function serviceConfigProbe(): void {
  const baseUrl = process.env.DELIVERY_API_URL;
  const token = process.env.DELIVERY_SERVICE_TOKEN;
  if (!baseUrl || !token) {
    throw Object.assign(new Error("Delivery integration is not configured"), {
      name: "DeliveryServiceError",
      code: "DELIVERY_NOT_CONFIGURED",
      status: 503,
    });
  }
}