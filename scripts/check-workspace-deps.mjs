import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const packageDirs = ["packages/bun-listen", "packages/pgredis", "packages/noredis-ioredis", "packages/noredis-redis"];
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

const packages = new Map();
for (const dir of packageDirs) {
  const pkg = await readJson(`${dir}/package.json`);
  packages.set(pkg.name, { dir, version: pkg.version });
}

const errors = [];
for (const dir of packageDirs) {
  const pkg = await readJson(`${dir}/package.json`);
  for (const field of dependencyFields) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (!packages.has(name)) continue;
      if (range !== "workspace:*") {
        errors.push(`${pkg.name} ${field}.${name} must be workspace:* in source package.json, got ${range}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Workspace dependency specs are source-safe");
