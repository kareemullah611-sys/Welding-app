import assert from "node:assert/strict";
import test from "node:test";

import {
  getLockedCityNames,
  isCityLockedDeployment,
  isAllowedCityName,
  allowSuperAdminInLockedDeployment,
} from "@/lib/deployment-profile";

test("CITY_LOCK_NAMES parses normalized city names", () => {
  process.env.CITY_LOCK_NAMES = " Kandahar ,  Saif Uddin ";
  assert.deepEqual(getLockedCityNames(), ["kandahar", "saif uddin"]);
  assert.equal(isCityLockedDeployment(), true);
  assert.equal(isAllowedCityName("Kandahar"), true);
  assert.equal(isAllowedCityName("Abdul Khaliq"), false);
});

test("CITY_LOCK_ALLOW_SUPER_ADMIN toggle", () => {
  process.env.CITY_LOCK_ALLOW_SUPER_ADMIN = "true";
  assert.equal(allowSuperAdminInLockedDeployment(), true);
  process.env.CITY_LOCK_ALLOW_SUPER_ADMIN = "false";
  assert.equal(allowSuperAdminInLockedDeployment(), false);
});
