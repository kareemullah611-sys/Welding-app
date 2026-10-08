import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/lib/offline-device-auth.ts"), "utf8");

/**
 * Re-issuing a device token happens on every successful login. If that write also
 * clears revokedAt, an admin revocation is silently undone the next time the
 * revoked device comes back online — the credential must stay revoked until an
 * explicit re-provisioning path decides otherwise.
 */
test("issuing a token for an existing device does not clear an existing revocation", () => {
  const updateBlock = source.slice(source.indexOf("update: {"), source.indexOf("});", source.indexOf("update: {")));

  assert.ok(updateBlock.length > 0, "expected an upsert update branch");
  assert.ok(
    !/revokedAt:\s*null/.test(updateBlock),
    "the upsert update branch must not reset revokedAt; a revoked device must stay revoked"
  );
});

test("the create branch still issues a usable credential", () => {
  const createBlock = source.slice(source.indexOf("create: {"), source.indexOf("update: {"));
  assert.match(createBlock, /tokenHash: hashDeviceToken\(token\)/);
  assert.match(createBlock, /expiresAt/);
});
