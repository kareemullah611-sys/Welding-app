import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENT_DIRS = ["src/app", "src/components", "src/hooks"].map((d) => path.join(ROOT, d));
const API_SEGMENT = `${path.sep}api${path.sep}`;

const FORBIDDEN_LITERALS = [
  "DEEPSEEK_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_API_KEY",
  "JWT_SECRET",
  "ADMIN_CLEANUP_SECRET",
  "REDIS_URL",
  "api.deepseek.com",
];

const FORBIDDEN_IMPORTS = ["@/lib/cloudinary", "@/lib/prisma", "@/lib/auth"];

const ALLOWED_PROCESS_ENV = new Set(["NODE_ENV", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_OFFLINE_ENABLED"]);

function listSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "api") continue;
      listSourceFiles(full, out);
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isClientFacingFile(filePath: string): boolean {
  if (filePath.includes(API_SEGMENT)) return false;
  const rel = path.relative(ROOT, filePath);
  return CLIENT_DIRS.some((dir) => filePath.startsWith(dir)) || rel === "src/middleware.ts";
}

test("client-facing source must not reference server secrets or third-party API keys", () => {
  const files = CLIENT_DIRS.flatMap((dir) => listSourceFiles(dir)).filter(isClientFacingFile);
  assert.ok(files.length > 0, "expected client-facing files to scan");

  const violations: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);

    for (const literal of FORBIDDEN_LITERALS) {
      if (content.includes(literal)) {
        violations.push(`${rel}: forbidden literal "${literal}"`);
      }
    }

    for (const imp of FORBIDDEN_IMPORTS) {
      if (content.includes(`from "${imp}"`) || content.includes(`from '${imp}'`)) {
        violations.push(`${rel}: forbidden import "${imp}"`);
      }
    }

    const envMatches = content.matchAll(/process\.env\.([A-Z0-9_]+)/g);
    for (const match of envMatches) {
      const name = match[1];
      if (!ALLOWED_PROCESS_ENV.has(name)) {
        violations.push(`${rel}: process.env.${name} not allowed in client-facing code`);
      }
    }

    if (/Authorization\s*:\s*[`'"]Bearer/i.test(content)) {
      violations.push(`${rel}: must not set Authorization Bearer headers in client code`);
    }
  }

  assert.deepEqual(violations, [], violations.join("\n"));
});

test("NEXT_PUBLIC env vars must not carry secret-like names", () => {
  const violations: string[] = [];
  const scanRoots = [path.join(ROOT, "src"), path.join(ROOT, ".env.example"), path.join(ROOT, "render.yaml")];

  for (const root of scanRoots) {
    if (!fs.existsSync(root)) continue;
    const files = fs.statSync(root).isDirectory() ? listSourceFiles(root) : [root];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const rel = path.relative(ROOT, file);
      const matches = content.matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*/g);
      for (const match of matches) {
        violations.push(`${rel}: suspicious public env var "${match[0]}"`);
      }
    }
  }

  assert.deepEqual(violations, [], violations.join("\n"));
});
