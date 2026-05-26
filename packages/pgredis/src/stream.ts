import { indexName, quoteQualifiedName, type PgSqlLike } from "./sql";

export interface PgOutboxStreamOptions {
  sql: PgSqlLike;
  namespace?: string;
  tableName?: string;
}

export interface PgOutboxStreamSchemaOptions {
  unlogged?: boolean;
}

export interface PgOutboxAppendOptions {
  availableAt?: Date;
}

export interface PgOutboxReadOptions {
  afterId?: string | number;
  limit?: number;
  includeProcessed?: boolean;
}

export interface PgOutboxClaimOptions {
  limit?: number;
  visibilityTimeoutMs?: number;
}

export interface PgOutboxTrimOptions {
  stream?: string;
  beforeId?: string | number;
  maxAgeMs?: number;
  limit?: number;
}

export interface PgOutboxMessage<T = unknown> {
  id: string;
  stream: string;
  payload: T;
  consumer: string | null;
  deliveryCount: number;
  availableAt: Date;
  lockedUntil: Date | null;
  processedAt: Date | null;
  createdAt: Date;
}

export interface PgOutboxPendingSummary {
  pending: number;
  locked: number;
}

interface MessageRow {
  id: string | number;
  stream: string;
  payload: unknown;
  consumer: string | null;
  delivery_count: string | number;
  available_at: Date | string;
  locked_until: Date | string | null;
  processed_at: Date | string | null;
  created_at: Date | string;
}

const DEFAULT_TABLE_NAME = "pgredis_outbox";
const DEFAULT_NAMESPACE = "default";

function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

function parseValue<T>(value: unknown): T {
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit)) throw new Error(`Invalid limit: ${limit}`);
  return Math.max(1, Math.floor(limit));
}

export class PgOutboxStream {
  readonly namespace: string;
  readonly tableName: string;
  readonly quotedTableName: string;

  private readonly sql: PgSqlLike;

  constructor(options: PgOutboxStreamOptions) {
    this.sql = options.sql;
    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.tableName = options.tableName || DEFAULT_TABLE_NAME;
    this.quotedTableName = quoteQualifiedName(this.tableName);
  }

  async ensureSchema(options: PgOutboxStreamSchemaOptions = {}): Promise<void> {
    const persistence = options.unlogged === true ? "UNLOGGED " : "";
    await this.sql.unsafe(`
      CREATE ${persistence}TABLE IF NOT EXISTS ${this.quotedTableName} (
        id BIGSERIAL PRIMARY KEY,
        namespace TEXT NOT NULL,
        stream TEXT NOT NULL,
        payload JSONB NOT NULL,
        consumer TEXT,
        delivery_count INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_until TIMESTAMPTZ,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${indexName(this.tableName, "ready")}
      ON ${this.quotedTableName} (namespace, stream, available_at, id)
      WHERE processed_at IS NULL
    `);
    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${indexName(this.tableName, "processed")}
      ON ${this.quotedTableName} (namespace, processed_at, id)
      WHERE processed_at IS NOT NULL
    `);
  }

  async append<T = unknown>(stream: string, payload: T, options: PgOutboxAppendOptions = {}): Promise<string> {
    const rows = await this.sql.unsafe<{ id: string | number }>(
      `INSERT INTO ${this.quotedTableName} (namespace, stream, payload, available_at, updated_at)
       VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, NOW()), NOW())
       RETURNING id`,
      [this.namespace, stream, jsonValue(payload), options.availableAt ?? null]
    );
    return String(rows[0]?.id);
  }

  async xadd<T = unknown>(stream: string, payload: T, options: PgOutboxAppendOptions = {}): Promise<string> {
    return this.append(stream, payload, options);
  }

  async read<T = unknown>(stream: string, options: PgOutboxReadOptions = {}): Promise<PgOutboxMessage<T>[]> {
    const rows = await this.sql.unsafe<MessageRow>(
      `SELECT id, stream, payload, consumer, delivery_count, available_at, locked_until, processed_at, created_at
       FROM ${this.quotedTableName}
       WHERE namespace = $1
         AND stream = $2
         AND id > $3::bigint
         AND ($5::boolean OR processed_at IS NULL)
       ORDER BY id ASC
       LIMIT $4`,
      [
        this.namespace,
        stream,
        options.afterId ?? 0,
        normalizeLimit(options.limit, 100),
        options.includeProcessed ?? false
      ]
    );
    return rows.map((row) => this.mapMessage<T>(row));
  }

  async claim<T = unknown>(
    stream: string,
    consumer: string,
    options: PgOutboxClaimOptions = {}
  ): Promise<PgOutboxMessage<T>[]> {
    const visibilityTimeoutMs = Math.max(1, Math.floor(options.visibilityTimeoutMs ?? 30_000));
    const rows = await this.sql.unsafe<MessageRow>(
      `WITH picked AS (
         SELECT id
         FROM ${this.quotedTableName}
         WHERE namespace = $1
           AND stream = $2
           AND processed_at IS NULL
           AND available_at <= NOW()
           AND (locked_until IS NULL OR locked_until <= NOW())
         ORDER BY id ASC
         LIMIT $4
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ${this.quotedTableName} target
       SET consumer = $3,
           delivery_count = target.delivery_count + 1,
           locked_until = NOW() + ($5::bigint * INTERVAL '1 millisecond'),
           updated_at = NOW()
       FROM picked
       WHERE target.id = picked.id
       RETURNING target.id, target.stream, target.payload, target.consumer, target.delivery_count,
                 target.available_at, target.locked_until, target.processed_at, target.created_at`,
      [this.namespace, stream, consumer, normalizeLimit(options.limit, 1), visibilityTimeoutMs]
    );
    return rows.map((row) => this.mapMessage<T>(row));
  }

  async ack(ids: readonly (string | number)[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.sql.unsafe<{ id: string | number }>(
      `UPDATE ${this.quotedTableName}
       SET processed_at = NOW(),
           locked_until = NULL,
           updated_at = NOW()
       WHERE namespace = $1
         AND id = ANY($2::bigint[])
         AND processed_at IS NULL
       RETURNING id`,
      [this.namespace, ids.map(String)]
    );
    return rows.length;
  }

  async pending(stream?: string): Promise<PgOutboxPendingSummary> {
    const rows = await this.sql.unsafe<{ pending: string | number; locked: string | number }>(
      `SELECT
         COUNT(*) FILTER (WHERE processed_at IS NULL)::bigint AS pending,
         COUNT(*) FILTER (WHERE processed_at IS NULL AND locked_until > NOW())::bigint AS locked
       FROM ${this.quotedTableName}
       WHERE namespace = $1
         AND ($2::text IS NULL OR stream = $2)`,
      [this.namespace, stream ?? null]
    );
    return {
      pending: Number(rows[0]?.pending ?? 0),
      locked: Number(rows[0]?.locked ?? 0)
    };
  }

  async trim(options: PgOutboxTrimOptions = {}): Promise<number> {
    const rows = await this.sql.unsafe<{ id: string | number }>(
      `DELETE FROM ${this.quotedTableName}
       WHERE id IN (
         SELECT id
         FROM ${this.quotedTableName}
         WHERE namespace = $1
           AND ($2::text IS NULL OR stream = $2)
           AND processed_at IS NOT NULL
           AND ($3::bigint IS NULL OR id < $3::bigint)
           AND ($4::bigint IS NULL OR processed_at <= NOW() - ($4::bigint * INTERVAL '1 millisecond'))
         ORDER BY id ASC
         LIMIT $5
       )
       RETURNING id`,
      [
        this.namespace,
        options.stream ?? null,
        options.beforeId ?? null,
        options.maxAgeMs ?? null,
        normalizeLimit(options.limit, 1000)
      ]
    );
    return rows.length;
  }

  private mapMessage<T>(row: MessageRow): PgOutboxMessage<T> {
    return {
      id: String(row.id),
      stream: row.stream,
      payload: parseValue<T>(row.payload),
      consumer: row.consumer,
      deliveryCount: Number(row.delivery_count),
      availableAt: toDate(row.available_at)!,
      lockedUntil: toDate(row.locked_until),
      processedAt: toDate(row.processed_at),
      createdAt: toDate(row.created_at)!
    };
  }
}

export function createPgOutboxStream(options: PgOutboxStreamOptions): PgOutboxStream {
  return new PgOutboxStream(options);
}
