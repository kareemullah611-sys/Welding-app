import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("generated application icon routes are public", () => {
  const middleware = readFileSync("src/middleware.ts", "utf8");
  assert.match(middleware, /"\/icon"/);
  assert.match(middleware, /"\/apple-icon"/);
});

test("standard browser and Apple icon files are shipped", () => {
  for (const path of [
    "public/favicon.ico",
    "public/apple-touch-icon.png",
    "public/apple-touch-icon-precomposed.png",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist`);
  }
});
