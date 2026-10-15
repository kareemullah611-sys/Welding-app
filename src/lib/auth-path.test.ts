import assert from "node:assert/strict";
import test from "node:test";

import { isLoginPathname } from "./auth-path";

test("login path detection accepts canonical and trailing-slash paths", () => {
  assert.equal(isLoginPathname("/"), true);
  assert.equal(isLoginPathname("/login"), true);
  assert.equal(isLoginPathname("/login/"), true);
  assert.equal(isLoginPathname("/dashboard/"), false);
});
