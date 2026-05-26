import type { PgredisClient } from "./client";
import type { PgNotifyPayload } from "./pubsub";

export interface RedisSetAliasOptions {
  EX?: number;
  PX?: number;
  NX?: boolean;
  XX?: boolean;
}

export interface PgredisMigrationAliases {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, options?: RedisSetAliasOptions): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  mget<T = unknown>(...keys: string[]): Promise<Array<T | null>>;
  mset<T = unknown>(entries: Record<string, T> | Iterable<readonly [string, T]>): Promise<"OK">;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  incrby(key: string, amount: number): Promise<number>;
  decr(key: string): Promise<number>;
  decrby(key: string, amount: number): Promise<number>;
  hget<T = unknown>(key: string, field: string): Promise<T | null>;
  hset<T = unknown>(key: string, field: string, value: T): Promise<number>;
  hmset<T = unknown>(key: string, entries: Record<string, T> | Iterable<readonly [string, T]>): Promise<"OK">;
  hgetall<T = unknown>(key: string): Promise<Record<string, T>>;
  lpush<T = unknown>(key: string, ...values: T[]): Promise<number>;
  rpush<T = unknown>(key: string, ...values: T[]): Promise<number>;
  lpop<T = unknown>(key: string): Promise<T | null>;
  rpop<T = unknown>(key: string): Promise<T | null>;
  blpop<T = unknown>(key: string | readonly string[], timeoutSeconds?: number): Promise<[string, T] | null>;
  brpop<T = unknown>(key: string | readonly string[], timeoutSeconds?: number): Promise<[string, T] | null>;
  llen(key: string): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  publish(channel: string, payload: PgNotifyPayload): Promise<number>;
}

function entriesFromRecord<T>(entries: Record<string, T> | Iterable<readonly [string, T]>): Array<readonly [string, T]> {
  return Symbol.iterator in Object(entries)
    ? Array.from(entries as Iterable<readonly [string, T]>)
    : Object.entries(entries) as Array<readonly [string, T]>;
}

function ttlResult(ttlMs: number | null): number {
  return ttlMs === null ? -1 : Math.ceil(ttlMs / 1000);
}

export function createPgredisMigrationAliases(client: PgredisClient): PgredisMigrationAliases {
  return {
    get: (key) => client.cache.get(key),
    async set(key, value, options = {}) {
      const ttlMs = options.PX ?? (options.EX === undefined ? undefined : options.EX * 1000);
      const written = await client.cache.set(key, value, {
        ttlMs,
        nx: options.NX,
        xx: options.XX
      });
      return written ? "OK" : null;
    },
    async del(...keys) {
      const results = await Promise.all(keys.map((key) => client.cache.delete(key)));
      return results.filter(Boolean).length;
    },
    async mget<T = unknown>(...keys: string[]) {
      const values = await client.cache.mget<T>(keys);
      return keys.map((key) => values.get(key) ?? null);
    },
    async mset(entries) {
      await client.cache.mset(entriesFromRecord(entries));
      return "OK";
    },
    async exists(...keys) {
      const values = await client.cache.mget(keys);
      return keys.filter((key) => values.has(key)).length;
    },
    async expire(key, seconds) {
      return await client.cache.expire(key, seconds * 1000) ? 1 : 0;
    },
    async pexpire(key, milliseconds) {
      return await client.cache.expire(key, milliseconds) ? 1 : 0;
    },
    async ttl(key) {
      const value = await client.cache.get(key);
      if (value === null) return -2;
      return ttlResult(await client.cache.ttl(key));
    },
    async pttl(key) {
      const value = await client.cache.get(key);
      if (value === null) return -2;
      return await client.cache.ttl(key) ?? -1;
    },
    incr: (key) => client.counter.incr(key),
    incrby: (key, amount) => client.counter.incr(key, amount),
    decr: (key) => client.counter.decr(key),
    decrby: (key, amount) => client.counter.decr(key, amount),
    hget: (key, field) => client.hash.hget(key, field),
    async hset(key, field, value) {
      await client.hash.hset(key, field, value);
      return 1;
    },
    async hmset(key, entries) {
      await client.hash.hmset(key, entriesFromRecord(entries));
      return "OK";
    },
    hgetall: (key) => client.hash.hgetall(key),
    lpush: (key, ...values) => client.list.lpush(key, ...values),
    rpush: (key, ...values) => client.list.rpush(key, ...values),
    async lpop<T = unknown>(key: string) {
      return (await client.list.lpop<T>(key, 1))[0] ?? null;
    },
    async rpop<T = unknown>(key: string) {
      return (await client.list.rpop<T>(key, 1))[0] ?? null;
    },
    async blpop<T = unknown>(key: string | readonly string[], timeoutSeconds = 0) {
      const item = await client.list.blpop<T>(key, { timeoutMs: timeoutSeconds * 1000 });
      return item ? [item.key, item.value] : null;
    },
    async brpop<T = unknown>(key: string | readonly string[], timeoutSeconds = 0) {
      const item = await client.list.brpop<T>(key, { timeoutMs: timeoutSeconds * 1000 });
      return item ? [item.key, item.value] : null;
    },
    llen: (key) => client.list.llen(key),
    sadd: (key, ...members) => client.set.sadd(key, ...members),
    srem: (key, ...members) => client.set.srem(key, ...members),
    smembers: (key) => client.set.smembers(key),
    async zadd(key, score, member) {
      return await client.sortedSet.zadd(key, score, member) ? 1 : 0;
    },
    async zrange(key, start, stop) {
      return await client.sortedSet.zrange(key, start, stop, {}) as string[];
    },
    async publish(channel, payload) {
      await client.pubsub.publish(channel, payload);
      return 1;
    }
  };
}
