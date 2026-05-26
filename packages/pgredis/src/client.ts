import { createPgKvCache, type PgKvCache, type PgKvCacheOptions } from "./kv-cache";
import { createPgAdvisoryLocker, type PgAdvisoryLocker } from "./advisory-lock";
import { createPgCounter, type PgCounter } from "./counter";
import { createPgHash, type PgHash } from "./hash";
import { createPgList, type PgList } from "./list";
import { collectPgredisMetrics, type PgredisCleanupMetrics, type PgredisMetrics } from "./metrics";
import { PgredisPipeline, type PgredisBatchOperation } from "./pipeline";
import { createPgPublisher, type PgPublisher } from "./pubsub";
import { createPgBossJobQueue, type PgBossJobQueue, type PgBossQueueOptions, type QueueResult } from "./queue";
import { createPgFixedWindowRateLimiter, type PgFixedWindowRateLimiter } from "./rate-limit";
import { createPgredisMigrationAliases, type PgredisMigrationAliases } from "./redis-aliases";
import { createPgSet, type PgSet } from "./set";
import { createPgSortedSet, type PgSortedSet } from "./sorted-set";
import type { PgSqlLike } from "./sql";
import { createPgOutboxStream, type PgOutboxStream } from "./stream";

export interface PgredisOptions {
  sql: PgSqlLike;
  namespace?: string;
  tablePrefix?: string;
  cache?: Omit<PgKvCacheOptions, "sql" | "namespace" | "tableName"> & {
    tableName?: string;
  };
  rateLimit?: {
    limit: number;
    windowMs: number;
    tableName?: string;
  };
  queue?: PgBossQueueOptions | string;
  outbox?: {
    tableName?: string;
  };
}

export interface PgredisClient {
  cache: PgKvCache;
  counter: PgCounter;
  hash: PgHash;
  set: PgSet;
  list: PgList;
  sortedSet: PgSortedSet;
  locks: PgAdvisoryLocker;
  pubsub: PgPublisher;
  rateLimit?: PgFixedWindowRateLimiter;
  queue?: PgBossJobQueue;
  outbox: PgOutboxStream;
  stream: PgOutboxStream;
  redis: PgredisMigrationAliases;
  batch<T>(operation: PgredisBatchOperation<T>): Promise<T>;
  pipeline(): PgredisPipeline;
  health(): Promise<{ ok: true }>;
  stats(): Promise<{
    cache: ReturnType<PgKvCache["stats"]>;
    queue?: QueueResult[];
    cleanup: PgredisCleanupMetrics;
  }>;
  metrics(): Promise<PgredisMetrics>;
  cleanupExpired(limit?: number): Promise<Record<string, number>>;
  startCleanupWorker(options?: { intervalMs?: number; limit?: number; onError?: (error: unknown) => void }): () => void;
  ensureSchema(): Promise<void>;
}

function tableName(prefix: string, name: string): string {
  return `${prefix}_${name}`;
}

export function createPgredis(options: PgredisOptions): PgredisClient {
  const namespace = options.namespace || "default";
  const prefix = options.tablePrefix || "pgredis";

  const cache = createPgKvCache({
    ...options.cache,
    sql: options.sql,
    namespace,
    tableName: options.cache?.tableName || tableName(prefix, "kv")
  });
  const counter = createPgCounter({
    sql: options.sql,
    namespace,
    tableName: tableName(prefix, "counter")
  });
  const hash = createPgHash({
    sql: options.sql,
    namespace,
    tableName: tableName(prefix, "hash")
  });
  const set = createPgSet({
    sql: options.sql,
    namespace,
    tableName: tableName(prefix, "set")
  });
  const list = createPgList({
    sql: options.sql,
    namespace,
    tableName: tableName(prefix, "list")
  });
  const sortedSet = createPgSortedSet({
    sql: options.sql,
    namespace,
    tableName: tableName(prefix, "sorted_set")
  });
  const outbox = createPgOutboxStream({
    sql: options.sql,
    namespace,
    tableName: options.outbox?.tableName || tableName(prefix, "outbox")
  });
  const rateLimit = options.rateLimit
    ? createPgFixedWindowRateLimiter({
        sql: options.sql,
        namespace,
        limit: options.rateLimit.limit,
        windowMs: options.rateLimit.windowMs,
        tableName: options.rateLimit.tableName || tableName(prefix, "rate_limit")
      })
    : undefined;
  const queue = options.queue ? createPgBossJobQueue(options.queue) : undefined;
  const cleanupMetrics: PgredisCleanupMetrics = {
    totalDeleted: 0,
    lastDeleted: 0,
    lastRunAt: null
  };

  let client!: PgredisClient;
  client = {
    cache,
    counter,
    hash,
    set,
    list,
    sortedSet,
    locks: createPgAdvisoryLocker(options.sql),
    pubsub: createPgPublisher(options.sql),
    rateLimit,
    queue,
    outbox,
    stream: outbox,
    redis: undefined as unknown as PgredisMigrationAliases,
    async batch<T>(operation: PgredisBatchOperation<T>): Promise<T> {
      if (!options.sql.begin) return operation(client);
      return options.sql.begin(async (tx) => {
        const txClient = createPgredis({ ...options, sql: tx });
        return operation(txClient);
      });
    },
    pipeline(): PgredisPipeline {
      return new PgredisPipeline((operation) => client.batch(operation));
    },
    async health() {
      await options.sql.unsafe("SELECT 1");
      return { ok: true as const };
    },
    async stats() {
      const boss = queue ? await queue.getBoss() : null;
      return {
        cache: cache.stats(),
        queue: boss ? await boss.getQueues() : undefined,
        cleanup: { ...cleanupMetrics }
      };
    },
    async metrics() {
      return collectPgredisMetrics({
        sql: options.sql,
        namespace,
        tablePrefix: prefix,
        cleanup: { ...cleanupMetrics },
        queue
      });
    },
    async cleanupExpired(limit = 1000) {
      const [
        cacheDeleted,
        counterDeleted,
        hashDeleted,
        setDeleted,
        listDeleted,
        sortedSetDeleted,
        rateLimitDeleted
      ] = await Promise.all([
        cache.cleanupExpired(limit),
        counter.cleanupExpired(limit),
        hash.cleanupExpired(limit),
        set.cleanupExpired(limit),
        list.cleanupExpired(limit),
        sortedSet.cleanupExpired(limit),
        rateLimit ? rateLimit.cleanupExpired(limit) : Promise.resolve(0)
      ]);
      const result = {
        cache: cacheDeleted,
        counter: counterDeleted,
        hash: hashDeleted,
        set: setDeleted,
        list: listDeleted,
        sortedSet: sortedSetDeleted,
        rateLimit: rateLimitDeleted
      };
      const deleted = Object.values(result).reduce((total, value) => total + value, 0);
      cleanupMetrics.totalDeleted += deleted;
      cleanupMetrics.lastDeleted = deleted;
      cleanupMetrics.lastRunAt = new Date();
      return result;
    },
    startCleanupWorker(cleanupOptions = {}) {
      const intervalMs = cleanupOptions.intervalMs ?? 60_000;
      const limit = cleanupOptions.limit ?? 1000;
      const timer = setInterval(() => {
        void this.cleanupExpired(limit).catch((error: unknown) => {
          cleanupOptions.onError?.(error);
        });
      }, intervalMs);
      return () => clearInterval(timer);
    },
    async ensureSchema() {
      await cache.ensureSchema();
      await counter.ensureSchema();
      await hash.ensureSchema();
      await set.ensureSchema();
      await list.ensureSchema();
      await sortedSet.ensureSchema();
      await outbox.ensureSchema();
      if (rateLimit) await rateLimit.ensureSchema();
    }
  };

  client.redis = createPgredisMigrationAliases(client);
  return client;
}
