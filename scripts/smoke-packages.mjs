import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = new URL("..", import.meta.url);

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

const temp = await mkdtemp(join(tmpdir(), "pgredis-pack-smoke-"));
process.env.npm_config_cache = join(temp, ".npm-cache");

try {
  await run("bun", ["run", "build"]);

  const pgredisTarball = await packPackage("./packages/pgredis", temp);
  const listenerTarball = await packPackage("./packages/bun-listen", temp);
  const ioredisAliasTarball = await packPackage("./packages/noredis-ioredis", temp);
  const redisAliasTarball = await packPackage("./packages/noredis-redis", temp);

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
