import type { PgSqlLike } from "./sql";

export type PgNotifyPayload = string | number | boolean | null | Record<string, unknown> | unknown[];

export interface PgPublisher {
  publish(channel: string, payload: PgNotifyPayload): Promise<void>;
}

export type NotifyHandler = (channel: string, payload: string) => void;

export interface PgListenerHealth {
  status: "connecting" | "connected" | "reconnecting" | "closed" | "error";
  connected: boolean;
  listeningChannels: string[];
  queuedQueries: number;
  activeQuery: boolean;
  reconnectAttempts: number;
  lastConnectedAt: number | null;
  lastMessageAt: number | null;
  lastNotificationAt: number | null;
  lastError: string | null;
}

export interface PgListenerEvents {
  connected: PgListenerHealth;
  close: { willReconnect: boolean; error?: Error };
  error: Error;
  health: PgListenerHealth;
  notification: { channel: string; payload: string };
  reconnect: { attempt: number; delayMs: number };
}

export interface PgListenerOptions {
  channels?: string[];
  onNotify?: NotifyHandler;
  tls?: boolean | Record<string, unknown>;
  ssl?: boolean | Record<string, unknown>;
  sslMode?: "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full" | "no-verify";
  reconnectDelayMs?: number | ((attempt: number) => number);
  healthCheckIntervalMs?: number;
  logger?: Partial<Pick<typeof console, "debug" | "info" | "warn" | "error">> | false;
}

export interface PgListenerHandle {
  close(): void;
  notify(channel: string, payload?: string): Promise<void>;
  getHealth(): PgListenerHealth;
  on<K extends keyof PgListenerEvents>(
    event: K,
    handler: (payload: PgListenerEvents[K]) => void
  ): () => void;
  off<K extends keyof PgListenerEvents>(
    event: K,
    handler: (payload: PgListenerEvents[K]) => void
  ): void;
}

export function createBunPgListener(
  databaseUrl: string,
  channels: string[],
  onNotify: NotifyHandler,
  options?: PgListenerOptions
): PgListenerHandle;
export function createBunPgListener(databaseUrl: string, options?: PgListenerOptions): PgListenerHandle;
export function createBunPgListener(
  databaseUrl: string,
  channelsOrOptions: string[] | PgListenerOptions = [],
  onNotify?: NotifyHandler,
  maybeOptions: PgListenerOptions = {}
): PgListenerHandle {
  let handle: PgListenerHandle | null = null;
  let loadError: Error | null = null;
  let closed = false;
  const queue: Array<{
    action(listener: PgListenerHandle): unknown;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }> = [];

  void import("@postgresx/bun-listen")
    .then((mod) => {
      if (closed) return;
      handle = Array.isArray(channelsOrOptions)
        ? mod.createPgListener(databaseUrl, channelsOrOptions, onNotify!, maybeOptions)
        : mod.createPgListener(databaseUrl, channelsOrOptions);
      const activeHandle = handle;
      for (const item of queue.splice(0)) {
        try {
          item.resolve(item.action(activeHandle));
        } catch (error) {
          item.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      loadError = new Error(`@postgresx/bun-listen is required for Bun LISTEN/NOTIFY. Install it with \`bun add @postgresx/bun-listen\`. ${message}`);
      for (const item of queue.splice(0)) item.reject(loadError);
    });

  const run = <T>(action: (listener: PgListenerHandle) => T): Promise<T> => {
    if (handle) return Promise.resolve(action(handle));
    if (loadError) return Promise.reject(loadError);
    return new Promise<T>((resolve, reject) => {
      queue.push({
        action: action as (listener: PgListenerHandle) => unknown,
        resolve: resolve as (value: unknown) => void,
        reject
      });
    });
  };

  return {
    close() {
      closed = true;
      if (handle) handle.close();
      queue.length = 0;
    },
    notify(channel, payload) {
      return run((listener) => listener.notify(channel, payload)).then(() => undefined);
    },
    getHealth() {
      return handle?.getHealth() ?? {
        status: closed ? "closed" : "connecting",
        connected: false,
        listeningChannels: Array.isArray(channelsOrOptions) ? channelsOrOptions : channelsOrOptions.channels ?? [],
        queuedQueries: queue.length,
        activeQuery: false,
        reconnectAttempts: 0,
        lastConnectedAt: null,
        lastMessageAt: null,
        lastNotificationAt: null,
        lastError: null
      };
    },
    on(event, handler) {
      if (handle) return handle.on(event, handler);
      let unsubscribe: (() => void) | null = null;
      const item = {
        action(listener: PgListenerHandle) {
          unsubscribe = listener.on(event, handler);
        },
        resolve() {},
        reject() {}
      };
      queue.push(item);
      return () => {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        unsubscribe?.();
      };
    },
    off(event, handler) {
      if (handle) handle.off(event, handler);
    }
  };
}

export const createPgListener = createBunPgListener;

function serializePayload(payload: PgNotifyPayload): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export async function publishPgNotify(sql: PgSqlLike, channel: string, payload: PgNotifyPayload): Promise<void> {
  await sql.unsafe("SELECT pg_notify($1, $2)", [channel, serializePayload(payload)]);
}

export function createPgPublisher(sql: PgSqlLike): PgPublisher {
  return {
    publish(channel, payload) {
      return publishPgNotify(sql, channel, payload);
    }
  };
}
