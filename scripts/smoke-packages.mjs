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

try {
  await run("bun", ["run", "build"]);

  const pgredisTarball = await packPackage("./packages/pgredis", temp);
  const listenerTarball = await packPackage("./packages/bun-listen", temp);

  await writeFile(join(temp, "package.json"), "{\"type\":\"module\"}\n");
  await run("npm", ["init", "-y"], { cwd: temp });
  await run("npm", ["install", "--ignore-scripts", pgredisTarball, listenerTarball, "pg@^8.16.3"], { cwd: temp });

  const nodeSmoke = `
    import { createPgredis, publishPgNotify } from "@postgresx/noredis";
    import { createPgAdapter, createPgNodeListener } from "@postgresx/noredis/adapters/node";
    import { createPgListener } from "@postgresx/bun-listen";
    if (typeof createPgredis !== "function") throw new Error("createPgredis export missing");
    if (typeof createPgAdapter !== "function") throw new Error("createPgAdapter export missing");
    if (typeof createPgNodeListener !== "function") throw new Error("createPgNodeListener export missing");
    if (typeof publishPgNotify !== "function") throw new Error("publishPgNotify export missing");
    if (typeof createPgListener !== "function") throw new Error("createPgListener export missing");
  `;
  const bunSmoke = `
    import { createPgredis } from "@postgresx/noredis";
    import { createBunSqlAdapter } from "@postgresx/noredis/adapters/bun";
    import { createPgListener } from "@postgresx/bun-listen";
    if (typeof createPgredis !== "function") throw new Error("createPgredis export missing");
    if (typeof createBunSqlAdapter !== "function") throw new Error("createBunSqlAdapter export missing");
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
