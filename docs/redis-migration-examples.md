# Redis migration examples

These examples cover migration patterns that should be documented before a
1.0 launch. They are guidance for moving application behavior to PostgreSQL
primitives, not Redis protocol compatibility promises.

## Streams and consumer groups

Redis Streams consumer groups combine an append-only log, pending entry list,
consumer ownership, retry, and acknowledgement semantics. `pgredis` does not
implement `XREADGROUP`, `XPENDING`, `XCLAIM`, or Redis stream IDs. Use one of
these PostgreSQL-native replacements instead:

| Redis pattern | pgredis replacement | Notes |
| --- | --- | --- |
| `XADD stream * ...` | `PgOutboxStream.append()` | Stores a durable JSON payload and returns a numeric id. |
| `XREADGROUP GROUP group consumer COUNT n STREAMS stream >` | `PgOutboxStream.claim({ consumer, limit })` | Claims unprocessed rows for one worker. Use SQL ordering and limits instead of stream cursors. |
| `XACK stream group id` | `PgOutboxStream.ack([id])` | Marks rows processed. |
| `XPENDING` | `PgOutboxStream.pending()` | Reports pending and locked counts, not Redis pending-entry details. |
| Retry delayed jobs | `createPgBossJobQueue()` | Prefer `pg-boss` for job queues, delayed retries, and worker scheduling. |

```ts
import { createPgOutboxStream } from "@postgresx/noredis";

const stream = createPgOutboxStream({ sql, table: "app_outbox" });
await stream.ensureSchema();

await stream.append("email.requested", {
  userId: "user_123",
  template: "welcome"
});

const claimed = await stream.claim({
  consumer: "worker-a",
  limit: 25,
  lockMs: 30_000
});

for (const message of claimed) {
  await sendEmail(message.payload);
  await stream.ack([message.id]);
}
```

## Session middleware

Use the framework-neutral web adapter as the integration point. Existing
Express/Fastify/Elysia middleware should adapt to the callback-shaped store
instead of importing a Redis store package.

```ts
import { createPgredis, createPgredisSessionStore } from "@postgresx/noredis";

const pg = createPgredis({ sql });
const store = createPgredisSessionStore(pg.cache, {
  prefix: "session:",
  ttlMs: 7 * 24 * 60 * 60 * 1000
});

await store.set("sid", { userId: "user_123" });
const session = await store.get("sid");
```

## SQL adapter retry boundary

`pgredis` does not hide SQL driver failures behind a Redis-style offline queue.
Put retries at the operation boundary where idempotency is known.

```ts
async function withRetry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
  throw lastError;
}

await withRetry(() => pg.cache.set("profile:user_123", profile, { ttlMs: 60_000 }));
```

Use retries for idempotent cache writes, reads, and metrics. For append-only
outbox writes or job enqueueing, use application-level idempotency keys or
transactional constraints.

## Benchmark follow-ups

The current benchmark covers runtime/backend replacement paths and cache
read-hit behavior. Future benchmark rows should stay scenario-based:

1. Outbox append/claim/ack throughput and p50/p99 latency.
2. List `lpush`/`brpop` polling bridge under mixed producers and consumers.
3. `pipeline()` grouped KV operations versus individual operation calls.
4. Session-style cache workload with L1 disabled and mixed L1 hit rates.

Do not mix local L1 cache hits into remote backend comparisons. Keep L1 rows
explicitly labeled on the operation name.

## Explicit non-goals

These are intentionally out of scope unless the project changes direction:

1. Redis wire protocol, RESP proxying, `redis-cli` compatibility, Cluster slots, Sentinel, or Redis ACL.
2. Lua, `EVAL`, `EVALSHA`, Redis Functions, and custom command definitions.
3. Redis Stack facades for RedisJSON, RediSearch, RedisTimeSeries, RedisBloom, GEO, bitmap, or HyperLogLog commands.
4. BullMQ-compatible Redis Streams consumer groups or pending-entry-list semantics.
