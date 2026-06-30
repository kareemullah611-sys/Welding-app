import assert from "node:assert/strict";
import test from "node:test";

import { jwtExpirySeconds, parseJwtExpiryMs } from "./jwt-expiry";

test("parseJwtExpiryMs parses common suffixes", () => {
  assert.equal(parseJwtExpiryMs("3600"), 3600 * 1000);
  assert.equal(parseJwtExpiryMs("15m"), 15 * 60 * 1000);
  assert.equal(parseJwtExpiryMs("24h"), 24 * 60 * 60 * 1000);
  assert.equal(parseJwtExpiryMs("7d"), 7 * 24 * 60 * 60 * 1000);
});

test("jwtExpirySeconds returns whole seconds for cookies", () => {
  assert.equal(jwtExpirySeconds("24h"), 86400);
});

test("parseJwtExpiryMs falls back for invalid values", () => {
  assert.equal(parseJwtExpiryMs("bad"), 24 * 60 * 60 * 1000);
});
