import type { PgKvCache, PgKvSetOptions } from "../kv-cache";

export type SessionCallback<T = unknown> = (error?: unknown, value?: T | null) => void;

export interface PgredisSessionStoreOptions {
  prefix?: string;
  ttlMs?: number;
}

export interface PgredisCacheHelperOptions {
  prefix?: string;
  ttlMs?: number;
}

export interface PgredisSessionStore {
  get(sessionId: string, callback?: SessionCallback): Promise<unknown | null> | void;
  set(sessionId: string, session: unknown, callback?: SessionCallback<void>): Promise<void> | void;
  destroy(sessionId: string, callback?: SessionCallback<void>): Promise<void> | void;
  touch(sessionId: string, session: unknown, callback?: SessionCallback<void>): Promise<void> | void;
}

export interface PgredisCacheHelpers {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, options?: PgKvSetOptions): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  wrap<T>(key: string, loader: () => Promise<T> | T, options?: PgKvSetOptions): Promise<T>;
}

function keyWithPrefix(prefix: string, key: string): string {
  return `${prefix}${key}`;
}

function withCallback<T>(promise: Promise<T>, callback?: SessionCallback<T>): Promise<T> | void {
  if (!callback) return promise;
  promise.then((value) => callback(undefined, value)).catch((error: unknown) => callback(error));
}

export function createPgredisSessionStore(
  cache: PgKvCache,
  options: PgredisSessionStoreOptions = {}
): PgredisSessionStore {
  const prefix = options.prefix ?? "sess:";
  const ttlMs = options.ttlMs;

  return {
    get(sessionId, callback) {
      return withCallback(cache.get(keyWithPrefix(prefix, sessionId)), callback);
    },
    set(sessionId, session, callback) {
      return withCallback(
        cache.set(keyWithPrefix(prefix, sessionId), session, { ttlMs }).then(() => undefined),
        callback
      );
    },
    destroy(sessionId, callback) {
      return withCallback(cache.delete(keyWithPrefix(prefix, sessionId)).then(() => undefined), callback);
    },
    touch(sessionId, _session, callback) {
      const key = keyWithPrefix(prefix, sessionId);
      const promise = ttlMs === undefined
        ? cache.touch(key).then(() => undefined)
        : cache.expire(key, ttlMs).then(() => undefined);
      return withCallback(promise, callback);
    }
  };
}

export const createExpressSessionStore = createPgredisSessionStore;
export const createFastifySessionStore = createPgredisSessionStore;
export const createElysiaSessionStore = createPgredisSessionStore;

export function createPgredisCacheHelpers(
  cache: PgKvCache,
  options: PgredisCacheHelperOptions = {}
): PgredisCacheHelpers {
  const prefix = options.prefix ?? "";
  const ttlMs = options.ttlMs;

  return {
    get(key) {
      return cache.get(keyWithPrefix(prefix, key));
    },
    set(key, value, setOptions = {}) {
      return cache.set(keyWithPrefix(prefix, key), value, { ttlMs, ...setOptions });
    },
    delete(key) {
      return cache.delete(keyWithPrefix(prefix, key));
    },
    async wrap<T>(key: string, loader: () => Promise<T> | T, setOptions: PgKvSetOptions = {}) {
      const cacheKey = keyWithPrefix(prefix, key);
      const cached = await cache.get<T>(cacheKey);
      if (cached !== null) return cached;
      const value = await loader();
      await cache.set(cacheKey, value, { ttlMs, ...setOptions });
      return value;
    }
  };
}
