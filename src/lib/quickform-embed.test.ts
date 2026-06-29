import test from "node:test";
import assert from "node:assert/strict";
import { shouldSimplifyCityModals } from "./quickform-embed";

test("shouldSimplifyCityModals is always true in embed quickforms", () => {
  assert.equal(shouldSimplifyCityModals(null, true), true);
  assert.equal(
    shouldSimplifyCityModals({ role: "super_admin", countryName: "Pakistan" }, true),
    true,
  );
});

test("shouldSimplifyCityModals enables compact modals for PK/AFG city admins", () => {
  assert.equal(
    shouldSimplifyCityModals({ role: "city_admin", countryName: "Pakistan" }, false),
    true,
  );
  assert.equal(
    shouldSimplifyCityModals({ role: "city_admin", countryName: "Afghanistan" }, false),
    true,
  );
  assert.equal(
    shouldSimplifyCityModals({ role: "city_admin", countryName: null }, false),
    false,
  );
});
