import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("local and CI runtimes pin the supported Node 22 toolchain", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const nvmVersion = readFileSync(".nvmrc", "utf8").trim();
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");

  assert.equal(pkg.engines.node, "22.x");
  assert.match(nvmVersion, /^22\./);
  assert.match(ci, /node-version:\s*"22"/);
});
