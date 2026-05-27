export function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return Math.floor(parsed);
}


function computeLatencies(samples) {
  if (samples.length === 0) return { avgMs: 0, p50Ms: 0, p99Ms: 0 };
  samples.sort((a, b) => a - b);
  const sum = samples.reduce((acc, v) => acc + v, 0);
  const avgMs = sum / samples.length;
  const p50Ms = samples[Math.floor(samples.length * 0.5)];
  const p99Ms = samples[Math.floor(samples.length * 0.99)];
  return { avgMs, p50Ms, p99Ms };
}

export async function runCase(operation, backend, iterations, concurrency, fn) {
  let next = 0;
  const latencies = [];
  const start = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = next++;
        if (index >= iterations) return;
        const t0 = performance.now();
        await fn(index);
        latencies.push(performance.now() - t0);
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
    opsPerSecond: iterations / (durationMs / 1000),
    ...computeLatencies(latencies)
  };
}

export async function runGroupedCase(operation, backend, logicalOperations, groups, concurrency, fn) {
  let next = 0;
  const latencies = [];
  const start = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = next++;
        if (index >= groups) return;
        const t0 = performance.now();
        await fn(index);
        latencies.push(performance.now() - t0);
      }
    })
  );

  const durationMs = performance.now() - start;
  return {
    operation,
    backend,
    iterations: logicalOperations,
    concurrency,
    durationMs,
    opsPerSecond: logicalOperations / (durationMs / 1000),
    ...computeLatencies(latencies)
  };
}

export async function runRedisCases(redis, backend, redisPrefix, iterations, concurrency) {
  const results = [];
  const hotKeyCount = Math.min(iterations, Math.max(1, concurrency));
  const batchSize = Math.min(32, Math.max(1, concurrency));
  const batchGroups = Math.ceil(iterations / batchSize);

  function batchIndexes(groupIndex) {
    const start = groupIndex * batchSize;
    return Array.from({ length: Math.min(batchSize, iterations - start) }, (_, offset) => start + offset);
  }

  results.push(await runCase("KV write", backend, iterations, concurrency, (index) =>
    redis.set(`${redisPrefix}:kv:${index}`, JSON.stringify({ index }))
  ));
  results.push(await runGroupedCase("KV write (batch)", backend, iterations, batchGroups, concurrency, (groupIndex) => {
    const entries = [];
    for (const index of batchIndexes(groupIndex)) {
      entries.push(`${redisPrefix}:kvb:${index}`, JSON.stringify({ index }));
    }
    return redis.mset(entries);
  }));
  results.push(await runCase("KV read", backend, iterations, concurrency, async (index) => {
    await redis.get(`${redisPrefix}:kv:${index}`);
  }));
  results.push(await runGroupedCase("KV read (batch)", backend, iterations, batchGroups, concurrency, async (groupIndex) => {
    await redis.mget(batchIndexes(groupIndex).map((index) => `${redisPrefix}:kv:${index}`));
  }));
  results.push(await runCase("KV read (hot cache)", backend, iterations, concurrency, async (index) => {
    await redis.get(`${redisPrefix}:kv:${index % hotKeyCount}`);
  }));
  for (const hitRate of [99, 95, 90]) {
    results.push(await runCase(`KV read (${hitRate}% L1)`, backend, iterations, concurrency, async (index) => {
      const keyIndex = mixedReadKeyIndex(index, hitRate, hotKeyCount, iterations);
      await redis.get(`${redisPrefix}:kv:${keyIndex}`);
    }));
  }
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
  const hotKeyCount = Math.min(iterations, Math.max(1, concurrency));
  const batchSize = Math.min(32, Math.max(1, concurrency));
  const batchGroups = Math.ceil(iterations / batchSize);

  function batchIndexes(groupIndex) {
    const start = groupIndex * batchSize;
    return Array.from({ length: Math.min(batchSize, iterations - start) }, (_, offset) => start + offset);
  }

  await pg.ensureSchema();

  results.push(await runCase("KV write", backend, iterations, concurrency, (index) =>
    pg.cache.set(`kv:${index}`, { index }, { notify: false })
  ));
  results.push(await runGroupedCase("KV write (batch)", backend, iterations, batchGroups, concurrency, (groupIndex) =>
    pg.cache.mset(batchIndexes(groupIndex).map((index) => [`kvb:${index}`, { index }]), { notify: false })
  ));
  results.push(await runCase("KV read", backend, iterations, concurrency, async (index) => {
    await pg.cache.get(`kv:${index}`);
  }));
  results.push(await runGroupedCase("KV read (batch)", backend, iterations, batchGroups, concurrency, async (groupIndex) => {
    await pg.cache.mget(batchIndexes(groupIndex).map((index) => `kv:${index}`));
  }));
  results.push(await runCase("KV read (hot cache)", backend, iterations, concurrency, async (index) => {
    await pg.cache.get(`kv:${index % hotKeyCount}`);
  }));
  for (const hitRate of [99, 95, 90]) {
    results.push(await runCase(`KV read (${hitRate}% L1)`, backend, iterations, concurrency, async (index) => {
      const keyIndex = mixedReadKeyIndex(index, hitRate, hotKeyCount, iterations);
      await pg.cache.get(`kv:${keyIndex}`);
    }));
  }
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

export async function runPgredisL1Cases(pg, backend, iterations, concurrency) {
  const results = [];
  const hotKeyCount = Math.min(iterations, Math.max(1, concurrency));

  for (let index = 0; index < hotKeyCount; index++) {
    await pg.cache.get(`kv:${index}`);
  }

  results.push(await runCase("KV read (hot cache)", backend, iterations, concurrency, async (index) => {
    await pg.cache.get(`kv:${index % hotKeyCount}`);
  }));
  for (const hitRate of [99, 95, 90]) {
    await warmHotKeys(pg, hotKeyCount);
    results.push(await runCase(`KV read (${hitRate}% L1)`, backend, iterations, concurrency, async (index) => {
      const keyIndex = mixedReadKeyIndex(index, hitRate, hotKeyCount, iterations);
      await pg.cache.get(`kv:${keyIndex}`);
    }));
  }

  return results;
}

async function warmHotKeys(pg, hotKeyCount) {
  for (let index = 0; index < hotKeyCount; index++) {
    await pg.cache.get(`kv:${index}`);
  }
}

function mixedReadKeyIndex(index, hitRate, hotKeyCount, iterations) {
  if (index % 100 < hitRate) return index % hotKeyCount;
  const coldPool = Math.max(1, iterations - hotKeyCount);
  return hotKeyCount + (index % coldPool);
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
  const names = ["kv", "counter", "hash", "set", "list", "sorted_set", "rate_limit", "outbox"].map((name) => `${tablePrefix}_${name}`);
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
