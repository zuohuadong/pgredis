export function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return Math.floor(parsed);
}

export async function runCase(operation, backend, iterations, concurrency, fn) {
  let next = 0;
  const start = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = next++;
        if (index >= iterations) return;
        await fn(index);
      }
    })
  );

  const durationMs = performance.now() - start;
  return {
    operation,
    backend,
    iterations,
    concurrency,
    durationMs,
    opsPerSecond: iterations / (durationMs / 1000)
  };
}

export async function runRedisCases(redis, backend, redisPrefix, iterations, concurrency) {
  const results = [];

  results.push(await runCase("KV write", backend, iterations, concurrency, (index) =>
    redis.set(`${redisPrefix}:kv:${index}`, JSON.stringify({ index }))
  ));
  results.push(await runCase("KV read", backend, iterations, concurrency, async (index) => {
    await redis.get(`${redisPrefix}:kv:${index}`);
  }));
  results.push(await runCase("Counter increment", backend, iterations, concurrency, (index) =>
    redis.incrby(`${redisPrefix}:counter`, index % 3 === 0 ? 2 : 1)
  ));
  results.push(await runCase("Set add", backend, iterations, concurrency, (index) =>
    redis.sadd(`${redisPrefix}:set`, `member:${index}`)
  ));
  results.push(await runCase("Pub/Sub publish", backend, iterations, concurrency, (index) =>
    redis.publish(`${redisPrefix}:events`, JSON.stringify({ index }))
  ));

  return results;
}

export async function runPgredisCases(pg, backend, tablePrefix, iterations, concurrency) {
  const results = [];
  await pg.ensureSchema();

  results.push(await runCase("KV write", backend, iterations, concurrency, (index) =>
    pg.cache.set(`kv:${index}`, { index }, { notify: false })
  ));
  results.push(await runCase("KV read", backend, iterations, concurrency, async (index) => {
    await pg.cache.get(`kv:${index}`);
  }));
  results.push(await runCase("Counter increment", backend, iterations, concurrency, (index) =>
    pg.counter.incr("counter", index % 3 === 0 ? 2 : 1)
  ));
  results.push(await runCase("Set add", backend, iterations, concurrency, (index) =>
    pg.set.sadd("set", `member:${index}`)
  ));
  results.push(await runCase("Pub/Sub publish", backend, iterations, concurrency, (index) =>
    pg.pubsub.publish(`${tablePrefix}_events`, { index })
  ));

  return results;
}

export async function cleanupRedis(redis, redisPrefix) {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${redisPrefix}:*`, "COUNT", 1000);
    cursor = nextCursor;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
}

export async function dropBenchmarkTables(sql, tablePrefix) {
  const names = ["kv", "counter", "hash", "set", "list", "sorted_set", "rate_limit"].map((name) => `${tablePrefix}_${name}`);
  for (const name of names) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(name)} CASCADE`);
  }
  if (typeof sql.close === "function") await sql.close();
}

export function quoteIdentifier(identifier) {
  const trimmed = identifier.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${trimmed.replaceAll('"', '""')}"`;
}
