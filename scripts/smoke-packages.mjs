import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = new URL("..", import.meta.url);
const packageDirs = ["packages/bun-listen", "packages/pgredis", "packages/noredis-ioredis", "packages/noredis-redis"];
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

async function packPackage(packageDir, destination) {
  const { stdout } = await exec("npm", ["pack", packageDir, "--pack-destination", destination, "--silent"], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024
  });
  const fileName = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!fileName) throw new Error(`npm pack did not return a tarball for ${packageDir}`);
  return join(destination, fileName);
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

async function preparePackage(sourceDir, destination, versions) {
  const targetDir = join(destination, basename(sourceDir));
  await cp(new URL(`${sourceDir}/package.json`, root), join(targetDir, "package.json"), { recursive: true });
  await cp(new URL(`${sourceDir}/README.md`, root), join(targetDir, "README.md"), { recursive: true });
  await cp(new URL(`${sourceDir}/dist`, root), join(targetDir, "dist"), { recursive: true });

  const pkgFile = join(targetDir, "package.json");
  const pkg = await readJson(pkgFile);
  if (rewriteWorkspaceDependencies(pkg, versions)) {
    await writeJson(pkgFile, pkg);
  }
  return targetDir;
}

const temp = await mkdtemp(join(tmpdir(), "pgredis-pack-smoke-"));
process.env.npm_config_cache = join(temp, ".npm-cache");

try {
  await run("bun", ["run", "build"]);

  const versions = await packageVersions();
  const preparedDir = join(temp, "prepared");
  const pgredisTarball = await packPackage(await preparePackage("packages/pgredis", preparedDir, versions), temp);
  const listenerTarball = await packPackage(await preparePackage("packages/bun-listen", preparedDir, versions), temp);
  const ioredisAliasTarball = await packPackage(await preparePackage("packages/noredis-ioredis", preparedDir, versions), temp);
  const redisAliasTarball = await packPackage(await preparePackage("packages/noredis-redis", preparedDir, versions), temp);

  await writeFile(join(temp, "package.json"), "{\"type\":\"module\"}\n");
  await run("npm", ["init", "-y"], { cwd: temp });
  await run("npm", ["install", "--ignore-scripts", pgredisTarball, listenerTarball, ioredisAliasTarball, redisAliasTarball], { cwd: temp });

  const nodeSmoke = `
    import { createPgredis, createPgOutboxStream, collectPgredisMetrics, publishPgNotify } from "@postgresx/noredis";
    import { createPgAdapter, createPgNodeListener } from "@postgresx/noredis/adapters/node";
    import { createIoredisAdapter } from "@postgresx/noredis/adapters/ioredis";
    import { createRedisJsAdapter } from "@postgresx/noredis/adapters/redis";
    import { createIoredisAdapter as createIoredisAlias } from "@postgresx/noredis-ioredis";
    import { createRedisJsAdapter as createRedisAlias } from "@postgresx/noredis-redis";
    import { createPgredisSessionStore } from "@postgresx/noredis/adapters/web";
    import { PgKvCache } from "@postgresx/noredis/kv";
    import { PgHash } from "@postgresx/noredis/hash";
    import { PgSet } from "@postgresx/noredis/set";
    import { PgSortedSet } from "@postgresx/noredis/sorted-set";
    import { PgList } from "@postgresx/noredis/list";
    import { publishPgNotify as publishFromSubpath } from "@postgresx/noredis/pubsub";
    import { createPgListener } from "@postgresx/bun-listen";
    if (typeof createPgredis !== "function") throw new Error("createPgredis export missing");
    if (typeof createPgOutboxStream !== "function") throw new Error("createPgOutboxStream export missing");
    if (typeof collectPgredisMetrics !== "function") throw new Error("collectPgredisMetrics export missing");
    if (typeof createPgAdapter !== "function") throw new Error("createPgAdapter export missing");
    if (typeof createPgNodeListener !== "function") throw new Error("createPgNodeListener export missing");
    if (typeof createIoredisAdapter !== "function") throw new Error("createIoredisAdapter export missing");
    if (typeof createRedisJsAdapter !== "function") throw new Error("createRedisJsAdapter export missing");
    if (typeof createIoredisAlias !== "function") throw new Error("noredis-ioredis alias export missing");
    if (typeof createRedisAlias !== "function") throw new Error("noredis-redis alias export missing");
    if (typeof createPgredisSessionStore !== "function") throw new Error("createPgredisSessionStore export missing");
    if (typeof PgKvCache !== "function") throw new Error("PgKvCache subpath export missing");
    if (typeof PgHash !== "function") throw new Error("PgHash subpath export missing");
    if (typeof PgSet !== "function") throw new Error("PgSet subpath export missing");
    if (typeof PgSortedSet !== "function") throw new Error("PgSortedSet subpath export missing");
    if (typeof PgList !== "function") throw new Error("PgList subpath export missing");
    if (typeof publishPgNotify !== "function") throw new Error("publishPgNotify export missing");
    if (typeof publishFromSubpath !== "function") throw new Error("pubsub subpath export missing");
    if (typeof createPgListener !== "function") throw new Error("createPgListener export missing");
  `;
  const bunSmoke = `
    import { createPgredis, createPgredisMigrationAliases } from "@postgresx/noredis";
    import { createBunSqlAdapter } from "@postgresx/noredis/adapters/bun";
    import { createIoredisAdapter } from "@postgresx/noredis/adapters/ioredis";
    import { createRedisJsAdapter } from "@postgresx/noredis/adapters/redis";
    import { createIoredisAdapter as createIoredisAlias } from "@postgresx/noredis-ioredis";
    import { createRedisJsAdapter as createRedisAlias } from "@postgresx/noredis-redis";
    import { createPgredisCacheHelpers } from "@postgresx/noredis/adapters/web";
    import { PgKvCache } from "@postgresx/noredis/kv";
    import { PgHash } from "@postgresx/noredis/hash";
    import { PgSet } from "@postgresx/noredis/set";
    import { PgSortedSet } from "@postgresx/noredis/sorted-set";
    import { PgList } from "@postgresx/noredis/list";
    import { publishPgNotify } from "@postgresx/noredis/pubsub";
    import { createPgListener } from "@postgresx/bun-listen";
    if (typeof createPgredis !== "function") throw new Error("createPgredis export missing");
    if (typeof createPgredisMigrationAliases !== "function") throw new Error("createPgredisMigrationAliases export missing");
    if (typeof createBunSqlAdapter !== "function") throw new Error("createBunSqlAdapter export missing");
    if (typeof createIoredisAdapter !== "function") throw new Error("createIoredisAdapter export missing");
    if (typeof createRedisJsAdapter !== "function") throw new Error("createRedisJsAdapter export missing");
    if (typeof createIoredisAlias !== "function") throw new Error("noredis-ioredis alias export missing");
    if (typeof createRedisAlias !== "function") throw new Error("noredis-redis alias export missing");
    if (typeof createPgredisCacheHelpers !== "function") throw new Error("createPgredisCacheHelpers export missing");
    if (typeof PgKvCache !== "function") throw new Error("PgKvCache subpath export missing");
    if (typeof PgHash !== "function") throw new Error("PgHash subpath export missing");
    if (typeof PgSet !== "function") throw new Error("PgSet subpath export missing");
    if (typeof PgSortedSet !== "function") throw new Error("PgSortedSet subpath export missing");
    if (typeof PgList !== "function") throw new Error("PgList subpath export missing");
    if (typeof publishPgNotify !== "function") throw new Error("pubsub subpath export missing");
    if (typeof createPgListener !== "function") throw new Error("createPgListener export missing");
  `;

  await writeFile(join(temp, "node-smoke.mjs"), nodeSmoke);
  await writeFile(join(temp, "bun-smoke.mjs"), bunSmoke);
  await run("node", [join(temp, "node-smoke.mjs")], { cwd: temp });
  await run("bun", [join(temp, "bun-smoke.mjs")], { cwd: temp });

  console.log("Package tarball smoke test passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
