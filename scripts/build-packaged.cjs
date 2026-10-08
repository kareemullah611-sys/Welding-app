const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const apiPath = path.join(root, "src", "app", "api");
const parkedApiPath = path.join(root, "src", "app", "_api");

if (fs.existsSync(parkedApiPath)) {
  throw new Error("src/app/_api already exists; restore src/app/api before building");
}

fs.renameSync(apiPath, parkedApiPath);
try {
  const env = {
    ...process.env,
    ELECTRON_BUILD: "true",
    NEXT_PUBLIC_OFFLINE_ENABLED: "true",
    NEXT_PUBLIC_PACKAGED_API_URL: process.env.NEXT_PUBLIC_PACKAGED_API_URL || "https://welding-app-production.up.railway.app",
  };
  for (const [command, args] of [
    ["npx", ["prisma", "generate"]],
    ["npx", ["next", "build"]],
  ]) {
    const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
    if (result.status !== 0) process.exitCode = result.status || 1;
    if (process.exitCode) break;
  }
} finally {
  fs.renameSync(parkedApiPath, apiPath);
}
