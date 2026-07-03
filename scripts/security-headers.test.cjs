const test = require("node:test");
const assert = require("node:assert/strict");
const { buildContentSecurityPolicy, getSecurityHeaders } = require("./security-headers.cjs");

test("buildContentSecurityPolicy allows same-origin frames and cloudinary images", () => {
  const csp = buildContentSecurityPolicy(true);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /frame-src 'self'/);
  assert.match(csp, /img-src[^;]*https:\/\/res\.cloudinary\.com/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.match(csp, /report-uri \/api\/csp-report/);
});

test("getSecurityHeaders includes baseline hardening headers in production", () => {
  const headers = getSecurityHeaders({ isProduction: true });
  const map = Object.fromEntries(headers.map((h) => [h.key, h.value]));
  assert.equal(map["X-Content-Type-Options"], "nosniff");
  assert.equal(map["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(map["Cross-Origin-Opener-Policy"], "same-origin");
  assert.match(map["Content-Security-Policy"], /default-src 'self'/);
  assert.match(map["Strict-Transport-Security"], /max-age=31536000/);
});

test("getSecurityHeaders omits HSTS outside production", () => {
  const headers = getSecurityHeaders({ isProduction: false });
  assert.equal(headers.some((h) => h.key === "Strict-Transport-Security"), false);
});

test("buildContentSecurityPolicy allows unsafe-eval in development only", () => {
  const prod = buildContentSecurityPolicy(true);
  const dev = buildContentSecurityPolicy(false);
  assert.doesNotMatch(prod, /unsafe-eval/);
  assert.match(dev, /script-src[^;]*'unsafe-eval'/);
  assert.match(dev, /connect-src[^;]*ws:/);
});

test("buildContentSecurityPolicy can use configured report URI", () => {
  const csp = buildContentSecurityPolicy(true, { reportUri: "https://reports.example.com/csp" });
  assert.match(csp, /report-uri https:\/\/reports\.example\.com\/csp/);
});
