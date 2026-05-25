const path = require("path");

const isElectronBuild = process.env.ELECTRON_BUILD === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  ...(isElectronBuild ? {
    output: "export",
    images: { unoptimized: true },
  } : {
    async headers() {
      const securityHeaders = [
        // Dashboard quickforms render same-origin pages in an iframe (?embed=1),
        // so DENY blocks them completely.
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ];
      if (process.env.NODE_ENV === "production") {
        securityHeaders.push({
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        });
      }
      return [{ source: "/:path*", headers: securityHeaders }];
    },
  }),
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(__dirname, "src"),
    };
    return config;
  },
};

module.exports = nextConfig;
