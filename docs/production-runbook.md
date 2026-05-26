# pgredis production runbook

This runbook covers operational checks for applications using `pgredis` in
production. It assumes PostgreSQL is already backed up, monitored, and upgraded
through the application's normal database process.

## Pre-launch checklist

- Run the default CI workflow, including build, unit tests, PostgreSQL
  integration tests, type checks, and package tarball smoke tests.
- Run the benchmark workflow with the target PostgreSQL and Redis versions used
  for sizing decisions.
- Verify npm release secrets before dispatching a publish:
  `RELEASE_PAT` for Release Please and `NPM_TOKEN` for provenance publish.
- Install packed tarballs into a clean Node.js app and a clean Bun app before
  the first public release.
- Confirm every production application calls `ensureSchema()` during deploy or
  applies equivalent DDL before traffic reaches new code.

## Database tables

By default, `createPgredis()` creates these tables with the selected
`tablePrefix`:

- `<prefix>_kv`
- `<prefix>_counter`
- `<prefix>_hash`
- `<prefix>_set`
- `<prefix>_list`
- `<prefix>_sorted_set`
- `<prefix>_rate_limit`, when rate limiting is enabled

Each workload should use a stable `namespace` and a stable `tablePrefix`. Use
separate prefixes only when table-level ownership, retention, or permissions
must be different.

## TTL cleanup

Expired rows are ignored by reads, but they are not removed automatically by
PostgreSQL. Run one of these cleanup paths:

```ts
const stopCleanup = pg.startCleanupWorker({
  intervalMs: 60_000,
  limit: 1000,
  onError(error) {
    logger.error({ error }, "pgredis cleanup failed");
  }
});
```

For scheduled cleanup jobs:

```ts
const result = await pg.cleanupExpired(5000);
logger.info({ result }, "pgredis expired rows cleaned");
```

Alert when cleanup repeatedly fails or when expired rows grow faster than the
cleanup limit. Increase `limit` or run cleanup more frequently before table
bloat becomes visible in query latency.

## Health checks

Use the facade health check for the database path:

```ts
await pg.health();
```

For listeners, export `getHealth()` into the application's metrics surface:

```ts
const health = listener.getHealth();
```

Alert on:

- listener status not equal to `connected`
- reconnect attempts increasing across multiple intervals
- no notifications received for a channel that should be active
- cleanup errors or unexpectedly high cleanup counts
- queue lag or failed jobs from the underlying `pg-boss` instance

## Table growth and bloat checks

Run this query periodically for every pgredis table:

```sql
SELECT
  relname,
  n_live_tup,
  n_dead_tup,
  last_autovacuum,
  last_vacuum
FROM pg_stat_user_tables
WHERE relname LIKE 'pgredis_%'
ORDER BY n_dead_tup DESC;
```

If `n_dead_tup` grows continuously, confirm cleanup is running and autovacuum is
keeping up. For high-churn cache tables, tune autovacuum per table instead of
disabling cleanup.

## Pub/Sub limits

PostgreSQL `LISTEN/NOTIFY` is best for lightweight invalidation and transient
events. It is not a durable queue.

- Keep payloads below PostgreSQL's NOTIFY payload limit.
- Store large payloads in a table and publish only an identifier.
- Use `pg-boss` or an application outbox table for durable processing.
- Keep listener connections separate from request-query pools.

## Queues

Queue support delegates to `pg-boss`. Monitor the underlying `PgBoss` instance
for queue depth, failures, retries, and worker liveness:

```ts
const boss = await pg.queue?.getBoss();
const queues = await boss?.getQueues();
```

Use `pg-boss` retry settings for idempotent jobs. Do not use `LISTEN/NOTIFY` as
the durability layer for billing, webhook delivery, or user-visible workflows.

## Rollback

`pgredis` schema creation is additive and uses stable table names. A code
rollback normally only needs to roll back the application package version. If a
new table prefix was introduced accidentally, stop traffic, switch the
application back to the previous prefix, and drop the unused new tables after
verifying no production keys were written there.
