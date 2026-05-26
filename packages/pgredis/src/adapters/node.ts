import type { Client as PgClient, ClientConfig, Pool as PgPool, PoolClient, PoolConfig } from "pg";
import type {
  NotifyHandler,
  PgListenerEvents,
  PgListenerHandle,
  PgListenerHealth
} from "../pubsub";
import type { PgSqlLike } from "../sql";

export type PgConnectionInput = string | PoolConfig | PgPool;

export interface NodePgAdapter extends PgSqlLike {
  getPool(): Promise<PgPool>;
  close(): Promise<void>;
}

class PgClientSql implements PgSqlLike {
  constructor(private readonly client: PoolClient) {}

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.client.query(query, [...params]);
    return result.rows as T[];
  }
}

class PgPoolSql implements NodePgAdapter {
  private pool: PgPool | null;
  private readonly ownsPool: boolean;

  constructor(private readonly input: PgConnectionInput) {
    this.pool = isPool(input) ? input : null;
    this.ownsPool = !isPool(input);
  }

  async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    const { Pool } = await loadPg();
    if (typeof this.input === "string") {
      this.pool = new Pool({ connectionString: this.input });
    } else if (isPool(this.input)) {
      this.pool = this.input;
    } else {
      this.pool = new Pool(this.input);
    }
    return this.pool;
  }

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    const pool = await this.getPool();
    const result = await pool.query(query, [...params]);
    return result.rows as T[];
  }

  async begin<T>(callback: (tx: PgSqlLike) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(new PgClientSql(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool && this.pool) await this.pool.end();
    this.pool = null;
  }
}

async function loadPg(): Promise<typeof import("pg")> {
  try {
    const specifier = "pg";
    return await import(specifier);
  } catch (error) {
    throw new Error("pg is required for pgredis Node.js adapters. Install it with `npm install pg`.", {
      cause: error
    });
  }
}

function isPool(input: PgConnectionInput): input is PgPool {
  return typeof input === "object" && input !== null && "connect" in input && "query" in input && "end" in input;
}

export function createPgAdapter(input: PgConnectionInput): NodePgAdapter {
  return new PgPoolSql(input);
}

export const createNodePostgresAdapter = createPgAdapter;

type ListenerLogger = Partial<Pick<typeof console, "debug" | "info" | "warn" | "error">>;

export interface NodePgListenerOptions extends ClientConfig {
  channels?: string[];
  onNotify?: NotifyHandler;
  reconnectDelayMs?: number | ((attempt: number) => number);
  healthCheckIntervalMs?: number;
  logger?: ListenerLogger | false;
}

class TypedEventEmitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: Events[keyof Events]) => void>>();

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    const bucket = this.listeners.get(event) ?? new Set();
    bucket.add(handler as (payload: Events[keyof Events]) => void);
    this.listeners.set(event, bucket);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    bucket.delete(handler as (payload: Events[keyof Events]) => void);
    if (bucket.size === 0) this.listeners.delete(event);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const handler of [...bucket]) handler(payload);
  }
}

function quoteListenIdentifier(identifier: string): string {
  if (!identifier || identifier.includes("\0")) {
    throw new Error("PostgreSQL identifier must be non-empty and cannot contain null bytes");
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function resolveDelay(delay: number | ((attempt: number) => number), attempt: number): number {
  return typeof delay === "function" ? delay(attempt) : delay;
}

function buildClientConfig(input: string | ClientConfig, options: NodePgListenerOptions): ClientConfig {
  const { channels: _channels, onNotify: _onNotify, reconnectDelayMs: _reconnectDelayMs, healthCheckIntervalMs: _healthCheckIntervalMs, logger: _logger, ...clientOptions } = options;
  if (typeof input === "string") return { ...clientOptions, connectionString: input };
  return { ...input, ...clientOptions };
}

export function createPgNodeListener(
  input: string | ClientConfig,
  options: NodePgListenerOptions = {}
): PgListenerHandle {
  const subscribedChannels = new Set(options.channels ?? []);
  const logger = options.logger === false ? null : options.logger ?? console;
  const emitter = new TypedEventEmitter<PgListenerEvents>();
  const reconnectDelay = options.reconnectDelayMs ?? 3000;
  const healthCheckIntervalMs = options.healthCheckIntervalMs ?? 30000;

  let status: PgListenerHealth["status"] = "connecting";
  let closed = false;
  let client: PgClient | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectAttempts = 0;
  let lastConnectedAt: number | null = null;
  let lastMessageAt: number | null = null;
  let lastNotificationAt: number | null = null;
  let lastError: string | null = null;
  let connecting: Promise<void> | null = null;

  function getHealth(): PgListenerHealth {
    return {
      status,
      connected: status === "connected",
      listeningChannels: [...subscribedChannels],
      queuedQueries: 0,
      activeQuery: false,
      reconnectAttempts,
      lastConnectedAt,
      lastMessageAt,
      lastNotificationAt,
      lastError
    };
  }

  function emitHealth(): void {
    emitter.emit("health", getHealth());
  }

  function setStatus(next: PgListenerHealth["status"]): void {
    status = next;
    emitHealth();
  }

  function reportError(error: Error): void {
    lastError = error.message;
    logger?.error?.("[pgredis-node-listen]", error);
    emitter.emit("error", error);
    emitHealth();
  }

  function startHealthTimer(): void {
    stopHealthTimer();
    if (healthCheckIntervalMs <= 0) return;
    healthTimer = setInterval(() => {
      if (closed || !client || status !== "connected") return;
      void client.query("SELECT 1").catch((error: unknown) => {
        reportError(toError(error));
        void client?.end().catch(() => undefined);
      });
    }, healthCheckIntervalMs);
  }

  function stopHealthTimer(): void {
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = null;
  }

  function scheduleReconnect(error?: Error): void {
    if (closed) return;
    stopHealthTimer();
    reconnectAttempts += 1;
    const delayMs = resolveDelay(reconnectDelay, reconnectAttempts);
    setStatus("reconnecting");
    emitter.emit("reconnect", { attempt: reconnectAttempts, delayMs });
    if (error) reportError(error);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => void connect(), delayMs);
  }

  function handleNotification(message: { channel: string; payload?: string }): void {
    lastMessageAt = Date.now();
    lastNotificationAt = lastMessageAt;
    const payload = message.payload ?? "";
    try {
      options.onNotify?.(message.channel, payload);
    } catch (error) {
      reportError(toError(error));
    }
    emitter.emit("notification", { channel: message.channel, payload });
    emitHealth();
  }

  async function connect(): Promise<void> {
    if (closed || connecting) return connecting ?? undefined;
    setStatus(reconnectAttempts > 0 ? "reconnecting" : "connecting");
    const { Client } = await loadPg();
    const pgClient = new Client(buildClientConfig(input, options));
    client = pgClient;

    pgClient.on("notification", handleNotification);
    pgClient.on("error", (error: Error) => {
      if (client === pgClient) scheduleReconnect(error);
    });
    pgClient.on("end", () => {
      if (client === pgClient && !closed) scheduleReconnect();
    });

    connecting = pgClient.connect()
      .then(async () => {
        for (const channel of subscribedChannels) {
          await pgClient.query(`LISTEN ${quoteListenIdentifier(channel)}`);
        }
        reconnectAttempts = 0;
        lastConnectedAt = Date.now();
        setStatus("connected");
        startHealthTimer();
        emitter.emit("connected", getHealth());
      })
      .catch((error: unknown) => {
        reportError(toError(error));
        if (!closed) scheduleReconnect();
      })
      .finally(() => {
        connecting = null;
      });

    return connecting;
  }

  void connect();

  return {
    close() {
      if (closed) return;
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      stopHealthTimer();
      const activeClient = client;
      client = null;
      void activeClient?.end().catch(() => undefined);
      setStatus("closed");
      emitter.emit("close", { willReconnect: false });
    },
    async notify(channel: string, payload = "") {
      const activeClient = client;
      if (!activeClient || status !== "connected") {
        throw new Error("PostgreSQL listener is not connected");
      }
      await activeClient.query("SELECT pg_notify($1, $2)", [channel, payload]);
    },
    getHealth,
    on(event, handler) {
      return emitter.on(event, handler);
    },
    off(event, handler) {
      emitter.off(event, handler);
    }
  };
}
