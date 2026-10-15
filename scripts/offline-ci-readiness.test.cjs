const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");

function jobBlock(name) {
  const start = workflow.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `Missing ${name} CI job`);
  const remainder = workflow.slice(start + `  ${name}:`.length);
  const nextJobMatch = remainder.match(/^  [A-Za-z0-9_-]+:\s*$/m);
  const end = nextJobMatch?.index === undefined
    ? workflow.length
    : start + `  ${name}:`.length + nextJobMatch.index;
  return workflow.slice(start, end);
}

test("offline feature gate is enabled in the verify job", () => {
  const verify = jobBlock("verify");
  assert.match(verify, /NEXT_PUBLIC_OFFLINE_ENABLED:\s*["']true["']/);
});

test("offline packaged E2E is enabled in the e2e job", () => {
  const e2e = jobBlock("e2e");
  assert.match(e2e, /NEXT_PUBLIC_OFFLINE_ENABLED:\s*["']true["']/);
  assert.match(e2e, /npm run test:e2e:clean/);
});
