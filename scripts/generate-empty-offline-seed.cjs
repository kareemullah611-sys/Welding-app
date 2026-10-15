const fs = require("node:fs");
const path = require("node:path");

const outputPath = path.resolve(__dirname, "..", "public", "offline-seed.json");
const payload = {
  version: 1,
  generatedAt: new Date(0).toISOString(),
  modules: {},
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload)}\n`);
console.log(`Created empty distributable offline seed: ${outputPath}`);
