/**
 * Shared HTTP security headers for Next.js (next.config.js).
 * Kept in a separate module so we can unit-test the policy without a full build.
 */

function buildContentSecurityPolicy(isProduction, options = {}) {
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const connectSrc = isProduction
    ? "connect-src 'self'"
    : "connect-src 'self' ws: wss:";

  const directives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "font-src 'self' data:",
    connectSrc,
    // Dashboard quickforms embed same-origin pages in an iframe (?embed=1).
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  if (isProduction) {
    directives.push("upgrade-insecure-requests");
    directives.push(`report-uri ${options.reportUri || process.env.CSP_REPORT_URI || "/api/csp-report"}`);
  }
  return directives.join("; ");
}

function getSecurityHeaders(options = {}) {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const headers = [
    // Dashboard quickforms render same-origin pages in an iframe (?embed=1).
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-site" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(isProduction, { reportUri: options.cspReportUri }),
    },
  ];
  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }
  return headers;
}

module.exports = {
  buildContentSecurityPolicy,
  getSecurityHeaders,
};
