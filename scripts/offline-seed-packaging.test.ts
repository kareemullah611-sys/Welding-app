import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
const scripts = pkg.scripts as Record<string, string>;

test("the mac DMG build generates an offline seed before packaging", () => {
  const cmd = scripts["package:mac:dist"] || "";
  assert.match(
    cmd,
    /offline-seed:generate/,
    "package:mac:dist must regenerate public/offline-seed.json, otherwise the DMG ships with an empty archive"
  );
  const seedIndex = cmd.indexOf("offline-seed:generate");
  const buildIndex = cmd.indexOf("build:packaged");
  assert.ok(
    seedIndex < buildIndex,
    "the seed must be generated before the static build copies public/ into out/"
  );
});

test("the windows build generates an offline seed before packaging", () => {
  const cmd = scripts["package:win:dist"] || "";
  assert.match(cmd, /offline-seed:generate/, "package:win:dist must regenerate the offline seed");
});

test("the android build generates an offline seed before syncing assets", () => {
  const cmd = scripts["package:android:sync"] || "";
  assert.match(cmd, /offline-seed:generate/, "package:android:sync must regenerate the offline seed");
  assert.ok(
    cmd.indexOf("offline-seed:generate") < cmd.indexOf("cap sync"),
    "the seed must exist before cap sync copies out/ into the APK assets"
  );
});

test("a city-scoped seed script exists for per-city DMGs", () => {
  assert.ok(scripts["offline-seed:generate:lahore"], "expected the existing per-city seed script");
  assert.match(scripts["offline-seed:generate:lahore"], /--city=Lahore/);
});

test("the seed generator supports an arbitrary city, not only Lahore", () => {
  const generator = readFileSync(join(process.cwd(), "scripts/generate-offline-seed.ts"), "utf8");
  assert.match(generator, /--city=/, "the generator must accept --city=<name>");
  assert.match(generator, /--city-id=/, "the generator must accept --city-id=<id>");
});

test("offline seed data is committed so a checkout can build a DMG", () => {
  const seed = JSON.parse(readFileSync(join(process.cwd(), "public/offline-seed.json"), "utf8"));
  assert.ok(seed.version, "seed must carry a version");
  assert.ok(seed.modules && typeof seed.modules === "object", "seed must carry a modules object");
});
