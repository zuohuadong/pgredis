import type { PgListenerHealth } from "./pubsub";
import type { PgBossJobQueue } from "./queue";
import { quoteQualifiedName, type PgSqlLike } from "./sql";

export interface PgredisTableMetrics {
  tableName: string;
  totalBytes: number;
  liveRows: number;
  deadRows: number;
  lastVacuum: Date | null;
  lastAutovacuum: Date | null;
  ttlBacklog: number | null;
}

export interface PgredisCleanupMetrics {
  totalDeleted: number;
  lastDeleted: number;
  lastRunAt: Date | null;
}

export interface PgredisListenerMetrics {
  status: PgListenerHealth["status"];
  connected: boolean;
  reconnectAttempts: number;
  listeningChannels: string[];
  lastConnectedAt: number | null;
  lastNotificationAt: number | null;
  lastError: string | null;
}

export interface PgredisQueueMetrics {
  queues: unknown[];
}

export interface PgredisMetrics {
  namespace?: string;
  tables: PgredisTableMetrics[];
  cleanup?: PgredisCleanupMetrics;
  listener?: PgredisListenerMetrics;
  queue?: PgredisQueueMetrics;
}

export interface PgredisMetricsOptions {
  sql: PgSqlLike;
  namespace?: string;
  tablePrefix?: string;
  tableNames?: readonly string[];
  cleanup?: PgredisCleanupMetrics;
  listener?: { getHealth(): PgListenerHealth };
  queue?: PgBossJobQueue;
}

interface PgStatUserTableRow {
  relname: string;
  total_bytes: string | number;
  n_live_tup: string | number;
  n_dead_tup: string | number;
  last_vacuum: Date | string | null;
  last_autovacuum: Date | string | null;
}

const DEFAULT_TABLE_PREFIX = "pgredis";
const DEFAULT_SUFFIXES = ["kv", "counter", "hash", "set", "list", "sorted_set", "rate_limit", "outbox"] as const;

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function defaultTableNames(prefix: string): string[] {
  return DEFAULT_SUFFIXES.map((suffix) => `${prefix}_${suffix}`);
}

async function collectTtlBacklog(sql: PgSqlLike, tableName: string): Promise<number | null> {
  try {
    const rows = await sql.unsafe<{ count: string | number }>(
      `SELECT COUNT(*)::bigint AS count
       FROM ${quoteQualifiedName(tableName)}
       WHERE expires_at IS NOT NULL AND expires_at <= NOW()`
    );
    return Number(rows[0]?.count ?? 0);
  } catch {
    return null;
  }
}

export async function collectPgredisMetrics(options: PgredisMetricsOptions): Promise<PgredisMetrics> {
  const tableNames = [...(options.tableNames ?? defaultTableNames(options.tablePrefix ?? DEFAULT_TABLE_PREFIX))];
  const rows = await options.sql.unsafe<PgStatUserTableRow>(
    `SELECT
       relname,
       pg_total_relation_size(relid)::bigint AS total_bytes,
       n_live_tup,
       n_dead_tup,
       last_vacuum,
       last_autovacuum
     FROM pg_stat_user_tables
     WHERE relname = ANY($1::text[])
     ORDER BY relname ASC`,
    [tableNames]
  );

  const tables: PgredisTableMetrics[] = [];
  for (const row of rows) {
    tables.push({
      tableName: row.relname,
      totalBytes: Number(row.total_bytes),
      liveRows: Number(row.n_live_tup),
      deadRows: Number(row.n_dead_tup),
      lastVacuum: toDate(row.last_vacuum),
      lastAutovacuum: toDate(row.last_autovacuum),
      ttlBacklog: await collectTtlBacklog(options.sql, row.relname)
    });
  }

  const listenerHealth = options.listener?.getHealth();
  const queue = options.queue ? { queues: await (await options.queue.getBoss()).getQueues() } : undefined;

  return {
    namespace: options.namespace,
    tables,
    cleanup: options.cleanup,
    listener: listenerHealth
      ? {
          status: listenerHealth.status,
          connected: listenerHealth.connected,
          reconnectAttempts: listenerHealth.reconnectAttempts,
          listeningChannels: listenerHealth.listeningChannels,
          lastConnectedAt: listenerHealth.lastConnectedAt,
          lastNotificationAt: listenerHealth.lastNotificationAt,
          lastError: listenerHealth.lastError
        }
      : undefined,
    queue
  };
}
