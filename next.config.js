const path = require("path");
const { getSecurityHeaders } = require("./scripts/security-headers.cjs");

const isElectronBuild = process.env.ELECTRON_BUILD === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  ...(isElectronBuild ? {
    output: "export",
    images: { unoptimized: true },
  } : {
    async headers() {
      return [{ source: "/:path*", headers: getSecurityHeaders() }];
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
