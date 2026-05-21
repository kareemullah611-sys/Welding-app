const path = require("path");

const isElectronBuild = process.env.ELECTRON_BUILD === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  ...(isElectronBuild ? {
    output: "export",
    images: { unoptimized: true },
  } : {}),
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(__dirname, "src"),
    };
    return config;
  },
};

module.exports = nextConfig;
