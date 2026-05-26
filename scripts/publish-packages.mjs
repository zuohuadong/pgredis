import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = new URL("..", import.meta.url);
const packageDirs = ["packages/bun-listen", "packages/pgredis"];
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

async function run(command, args, options = {}) {
  const { stdout, stderr } = await exec(command, args, {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
    ...options
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function packageVersions() {
  const versions = new Map();
  for (const dir of packageDirs) {
    const pkg = await readJson(new URL(`${dir}/package.json`, root));
    versions.set(pkg.name, pkg.version);
  }
  return versions;
}

function rewriteWorkspaceDependencies(pkg, versions) {
  let changed = false;
  for (const field of dependencyFields) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (range === "workspace:*" && versions.has(name)) {
        deps[name] = `^${versions.get(name)}`;
        changed = true;
      }
    }
  }
  return changed;
}

async function packageExists(name, version) {
  try {
    await exec("npm", ["view", `${name}@${version}`, "version"], {
      cwd: root,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function publishPreparedPackage(dir, options) {
  const pkgFile = join(dir, "package.json");
  const pkg = await readJson(pkgFile);
  if (await packageExists(pkg.name, pkg.version)) {
    console.log(`${pkg.name}@${pkg.version} already exists, skipping`);
    return;
  }

  console.log(`Publishing ${pkg.name}@${pkg.version}`);
  const args = ["publish", dir, "--access", "public"];
  if (options.provenance) args.push("--provenance");
  if (options.authType) args.push("--auth-type", options.authType);
  if (options.otp) args.push(`--otp=${options.otp}`);
  await run("npm", args);
}

const options = {
  provenance: process.argv.includes("--provenance"),
  authType: process.argv.includes("--legacy-auth") ? "legacy" : null,
  otp: process.argv.find((arg) => arg.startsWith("--otp="))?.slice("--otp=".length) ?? null
};

const temp = await mkdtemp(join(tmpdir(), "pgredis-monorepo-publish-"));

try {
  await run("bun", ["run", "build"]);
  const versions = await packageVersions();

  for (const sourceDir of packageDirs) {
    const targetDir = join(temp, basename(sourceDir));
    await cp(new URL(`${sourceDir}/package.json`, root), join(targetDir, "package.json"), { recursive: true });
    await cp(new URL(`${sourceDir}/README.md`, root), join(targetDir, "README.md"), { recursive: true });
    await cp(new URL(`${sourceDir}/dist`, root), join(targetDir, "dist"), { recursive: true });

    const pkgFile = join(targetDir, "package.json");
    const pkg = await readJson(pkgFile);
    if (rewriteWorkspaceDependencies(pkg, versions)) {
      await writeJson(pkgFile, pkg);
      console.log(`Rewrote workspace dependencies for ${pkg.name}`);
    }
    if (!existsSync(join(targetDir, "dist"))) {
      throw new Error(`Missing dist directory for ${pkg.name}`);
    }
    await publishPreparedPackage(targetDir, options);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
