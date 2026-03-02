/**
 * Cross-platform SAM build script (replaces Makefile for Windows).
 *
 * Creates .aws-sam/build/ with a lean Lambda artifact:
 *   - Compiled JS only (no TypeScript source)
 *   - Production node_modules (no dev deps)
 *   - Prisma client with only the Lambda-compatible engine (rhel-openssl-3.0.x)
 *   - Strips Prisma CLI, cache, Windows/macOS engine binaries
 */
import { execSync } from "child_process";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const BUILD_DIR = join(ROOT, ".aws-sam", "build");
const ARTIFACT_DIR = join(BUILD_DIR, "ApiFunction");

console.log("=== ERP API — SAM Build (cross-platform) ===\n");

// 1. Clean previous build
console.log("1. Cleaning previous build...");
rmSync(BUILD_DIR, { recursive: true, force: true });
rmSync(join(ROOT, "dist"), { recursive: true, force: true });
mkdirSync(ARTIFACT_DIR, { recursive: true });

// 2. Install ALL dependencies (dev deps needed for tsc)
console.log("2. Installing all dependencies...");
execSync("npm ci", { stdio: "inherit", cwd: ROOT });

// 3. Generate Prisma Client
console.log("\n3. Generating Prisma Client...");
execSync("npx prisma generate", {
  stdio: "inherit",
  cwd: ROOT,
  env: {
    ...process.env,
    DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  },
});

// 4. Compile TypeScript
console.log("\n4. Compiling TypeScript...");
execSync("npx tsc", { stdio: "inherit", cwd: ROOT });

// 5. Copy compiled JS + prisma schema
console.log("\n5. Copying compiled output...");
cpSync(join(ROOT, "dist"), ARTIFACT_DIR, { recursive: true });
cpSync(join(ROOT, "package.json"), join(ARTIFACT_DIR, "package.json"));
cpSync(join(ROOT, "package-lock.json"), join(ARTIFACT_DIR, "package-lock.json"));
cpSync(join(ROOT, "prisma"), join(ARTIFACT_DIR, "prisma"), { recursive: true });

// 6. Install production-only deps in artifact
console.log("\n6. Installing production dependencies in artifact...");
execSync("npm ci --omit=dev", { stdio: "inherit", cwd: ARTIFACT_DIR });

// 7. Copy the pre-generated Prisma client (avoids needing prisma CLI in artifact)
console.log("\n7. Copying generated Prisma client...");
const srcPrismaClient = join(ROOT, "node_modules", "@prisma", "client");
const destPrismaClient = join(ARTIFACT_DIR, "node_modules", "@prisma", "client");
rmSync(destPrismaClient, { recursive: true, force: true });
cpSync(srcPrismaClient, destPrismaClient, { recursive: true });

const srcDotPrisma = join(ROOT, "node_modules", ".prisma");
const destDotPrisma = join(ARTIFACT_DIR, "node_modules", ".prisma");
rmSync(destDotPrisma, { recursive: true, force: true });
cpSync(srcDotPrisma, destDotPrisma, { recursive: true });

// 8. Strip unnecessary Prisma engine binaries (keep only rhel for Lambda)
console.log("8. Stripping unnecessary Prisma engine binaries...");
const engineDirs = [
  join(ARTIFACT_DIR, "node_modules", ".prisma", "client"),
  join(ARTIFACT_DIR, "node_modules", "@prisma", "client", "runtime"),
  join(ARTIFACT_DIR, "node_modules", "@prisma", "engines"),
];

let removedMB = 0;
for (const dir of engineDirs) {
  if (!existsSync(dir)) continue;
  try {
    const files = readdirSync(dir, { recursive: true, withFileTypes: false });
  } catch { /* skip */ }
}

// Remove engine files that are NOT for rhel-openssl (Lambda runtime)
function cleanEngines(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanEngines(fullPath);
      continue;
    }
    // Remove Windows, macOS, and debian engine binaries (keep rhel-openssl-3.0.x)
    const isNativeEngine = /libquery_engine-(windows|darwin|debian)/.test(entry.name)
      || /query-engine-(windows|darwin|debian)/.test(entry.name)
      || /query_engine-(windows|darwin|debian)/.test(entry.name)
      || entry.name.includes("query-engine-windows")
      || entry.name.includes("migration-engine")
      || entry.name.includes("introspection-engine")
      || entry.name.includes("prisma-fmt");

    if (isNativeEngine) {
      const stat = existsSync(fullPath) ? statSync(fullPath) : null;
      if (stat) removedMB += stat.size / 1048576;
      rmSync(fullPath, { force: true });
    }
  }
}
cleanEngines(join(ARTIFACT_DIR, "node_modules", ".prisma"));
cleanEngines(join(ARTIFACT_DIR, "node_modules", "@prisma"));

// 9. Remove known bloat
console.log("9. Removing bloat...");
const bloatPaths = [
  join(ARTIFACT_DIR, "node_modules", ".cache"),
  join(ARTIFACT_DIR, "node_modules", "prisma"),       // CLI, not needed at runtime
  join(ARTIFACT_DIR, "node_modules", "typescript"),    // should not be in prod
  join(ARTIFACT_DIR, "node_modules", "@prisma", "engines"), // engine download cache
  join(ARTIFACT_DIR, "package-lock.json"),
];
for (const p of bloatPaths) {
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log(`   Removed: ${p.replace(ARTIFACT_DIR, ".")}`);
  }
}

// 10. Measure final size
console.log("\n10. Measuring artifact size...");
let totalSize = 0;
function measureDir(dir) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        measureDir(fullPath);
      } else {
        totalSize += statSync(fullPath).size;
      }
    }
  } catch { /* skip */ }
}
measureDir(ARTIFACT_DIR);
console.log(`   Total artifact size: ${Math.round(totalSize / 1048576)}MB (Lambda limit: 250MB)`);

// 11. Create build template (CodeUri → ApiFunction/)
console.log("\n11. Creating build template...");
let template = readFileSync(join(ROOT, "template.yaml"), "utf8");
template = template.replace("CodeUri: ./", "CodeUri: ApiFunction/");
writeFileSync(join(BUILD_DIR, "template.yaml"), template);

console.log("\n=== Build complete! ===");
console.log(`\nNext: npm run sam:deploy`);
