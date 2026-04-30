#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const dashboardDir = path.join(root, "src", "app", "(dashboard)");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function hasMutatingApiCall(source) {
  return /apiCall\([\s\S]*?method\s*:\s*"(POST|PUT|PATCH|DELETE)"/m.test(source);
}

function hasOfflinePrimitive(source) {
  const hasHook = /useOffline\(/.test(source);
  const hasQueueOrSnapshot = /(queuedItems|showOfflineSnapshot|readOfflineReadSnapshot|writeOfflineReadSnapshot)/.test(source);
  return hasHook && hasQueueOrSnapshot;
}

function main() {
  const files = walk(dashboardDir);
  const offenders = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    if (!hasMutatingApiCall(source)) continue;
    if (!hasOfflinePrimitive(source)) offenders.push(path.relative(root, file));
  }

  if (offenders.length) {
    console.error("Offline feature gate failed.");
    console.error("These dashboard modules mutate data but are missing required offline primitives:");
    for (const file of offenders) console.error(`- ${file}`);
    console.error("");
    console.error("Required minimum for mutating modules:");
    console.error("1) useOffline()");
    console.error("2) queue/snapshot awareness (queuedItems or offline read-snapshot handling)");
    process.exit(1);
  }

  console.log(`Offline feature gate passed (${files.length} dashboard modules scanned).`);
}

main();
