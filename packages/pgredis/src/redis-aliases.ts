import type { PgredisClient } from "./client";
import type { PgNotifyPayload } from "./pubsub";
import { UnsupportedCommandError } from "./errors";

export interface RedisSetAliasOptions {
  EX?: number;
  PX?: number;
  NX?: boolean;
  XX?: boolean;
}

export interface PgredisMigrationAliases {
  // KV 基础
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, options?: RedisSetAliasOptions): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  unlink(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  type(key: string): Promise<"string" | "none">;

  // KV 过期
  expire(key: string, seconds: number): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  persist(key: string): Promise<number>;

  // KV 条件写入
  setex<T = unknown>(key: string, seconds: number, value: T): Promise<"OK">;
  psetex<T = unknown>(key: string, milliseconds: number, value: T): Promise<"OK">;
  setnx<T = unknown>(key: string, value: T): Promise<number>;
  getset<T = unknown>(key: string, value: T): Promise<T | null>;
  getdel<T = unknown>(key: string): Promise<T | null>;

  // KV 批量
  mget<T = unknown>(...keys: string[]): Promise<Array<T | null>>;
  mset<T = unknown>(entries: Record<string, T> | Iterable<readonly [string, T]>): Promise<"OK">;

  // KV 扫描
  keys(pattern?: string): Promise<string[]>;
  scan(cursor?: string | null, count?: number, pattern?: string): Promise<{ cursor: string | null; keys: string[] }>;
  rename(key: string, newKey: string): Promise<boolean>;

  // 计数器
  incr(key: string): Promise<number>;
  incrby(key: string, amount: number): Promise<number>;
  decr(key: string): Promise<number>;
  decrby(key: string, amount: number): Promise<number>;

  // Hash
  hget<T = unknown>(key: string, field: string): Promise<T | null>;
  hset<T = unknown>(key: string, field: string, value: T): Promise<number>;
  hmset<T = unknown>(key: string, entries: Record<string, T> | Iterable<readonly [string, T]>): Promise<"OK">;
  hmget<T = unknown>(key: string, ...fields: string[]): Promise<Array<T | null>>;
  hgetall<T = unknown>(key: string): Promise<Record<string, T>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hexists(key: string, field: string): Promise<number>;
  hlen(key: string): Promise<number>;
  hincrby(key: string, field: string, amount?: number): Promise<number>;
  hkeys(key: string): Promise<string[]>;
  hvals<T = unknown>(key: string): Promise<T[]>;
  hstrlen(key: string, field: string): Promise<number>;
  hscan<T = unknown>(key: string, cursor?: string | null, count?: number): Promise<{ cursor: string | null; entries: Array<readonly [string, T]> }>;

  // List
  lpush<T = unknown>(key: string, ...values: T[]): Promise<number>;
  rpush<T = unknown>(key: string, ...values: T[]): Promise<number>;
  lpop<T = unknown>(key: string): Promise<T | null>;
  rpop<T = unknown>(key: string): Promise<T | null>;
  blpop<T = unknown>(key: string | readonly string[], timeoutSeconds?: number): Promise<[string, T] | null>;
  brpop<T = unknown>(key: string | readonly string[], timeoutSeconds?: number): Promise<[string, T] | null>;
  llen(key: string): Promise<number>;
  lrange<T = unknown>(key: string, start?: number, stop?: number): Promise<T[]>;
  lrem(key: string, count: number, value: unknown): Promise<number>;

  // Set
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string): Promise<number>;
  scard(key: string): Promise<number>;
  sinter(...keys: string[]): Promise<string[]>;
  sunion(...keys: string[]): Promise<string[]>;
  sdiff(...keys: string[]): Promise<string[]>;
  spop(key: string, count?: number): Promise<string[]>;
  srandmember(key: string, count?: number): Promise<string[]>;
  smove(source: string, destination: string, member: string): Promise<number>;
  sscan(key: string, cursor?: string | null, count?: number): Promise<{ cursor: string | null; members: string[] }>;

  // Sorted Set
  zadd(key: string, ...args: Array<number | string>): Promise<number>;
  zscore(key: string, member: string): Promise<number | null>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zrangeByScore(key: string, min: number, max: number): Promise<string[]>;
  zrank(key: string, member: string): Promise<number | null>;
  zcount(key: string, min: number, max: number): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zcard(key: string): Promise<number>;
  zincrby(key: string, amount: number, member: string): Promise<number>;
  zpopmin(key: string, count?: number): Promise<Array<{ member: string; score: number }>>;
  zpopmax(key: string, count?: number): Promise<Array<{ member: string; score: number }>>;
  zscan(key: string, cursor?: string | null, count?: number): Promise<{ cursor: string | null; entries: Array<{ member: string; score: number }> }>;

  // Pub/Sub
  publish(channel: string, payload: PgNotifyPayload): Promise<number>;

  // 连接生命周期（适配 ioredis/redis.js 外观）
  connect(): Promise<void>;
  quit(): Promise<void>;
  disconnect(): void;
  duplicate(): PgredisMigrationAliases;
  on(event: string, handler: (...args: unknown[]) => void): PgredisMigrationAliases;

  // Pipeline / Multi（包装现有 batch/pipeline）
  pipeline(): PipelineFacade;
  multi(): PipelineFacade;

  // 不支持命令
  unsupported(command: string): never;
}

export interface PipelineCommand {
  command: string;
  args: unknown[];
}

export interface PipelineFacade {
  queue: PipelineCommand[];
  exec(): Promise<Array<[Error | null, unknown]>>;
  add(command: string, ...args: unknown[]): PipelineFacade;
}

function entriesFromRecord<T>(entries: Record<string, T> | Iterable<readonly [string, T]>): Array<readonly [string, T]> {
  return Symbol.iterator in Object(entries)
    ? Array.from(entries as Iterable<readonly [string, T]>)
    : Object.entries(entries) as Array<readonly [string, T]>;
}

function ttlResult(ttlMs: number | null): number {
  return ttlMs === null ? -1 : Math.ceil(ttlMs / 1000);
}

function createPipelineFacade(client: PgredisClient): PipelineFacade {
  const queue: PipelineCommand[] = [];
  const aliases = createPgredisMigrationAliases(client);
  const facade: PipelineFacade = {
    queue,
    add(command: string, ...args: unknown[]) {
      queue.push({ command, args });
      return facade;
    },
    async exec() {
      const results: Array<[Error | null, unknown]> = [];
      for (const cmd of queue) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fn = (aliases as any)[cmd.command];
          if (typeof fn === "function") {
            results.push([null, await fn.apply(aliases, cmd.args)]);
          } else {
            results.push([new UnsupportedCommandError(cmd.command), null]);
          }
        } catch (err) {
          results.push([err instanceof Error ? err : new Error(String(err)), null]);
        }
      }
      queue.length = 0;
      return results;
    }
  };
  return facade;
}

export function createPgredisMigrationAliases(client: PgredisClient): PgredisMigrationAliases {
  const noopHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

  return {
    // KV 基础
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
    async unlink(...keys) {
      return client.cache.unlink(...keys);
    },
    async exists(...keys) {
      const values = await client.cache.mget(keys);
      return keys.filter((key) => values.has(key)).length;
    },
    type: (key) => client.cache.type(key),

    // KV 过期
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
    async persist(key) {
      return await client.cache.persist(key) ? 1 : 0;
    },

    // KV 条件写入
    setex: (key, seconds, value) => client.cache.setex(key, seconds, value),
    psetex: (key, milliseconds, value) => client.cache.psetex(key, milliseconds, value),
    setnx: (key, value) => client.cache.setnx(key, value),
    getset: (key, value) => client.cache.getset(key, value),
    getdel: (key) => client.cache.getdel(key),

    // KV 批量
    async mget<T = unknown>(...keys: string[]) {
      const values = await client.cache.mget<T>(keys);
      return keys.map((key) => values.get(key) ?? null);
    },
    async mset(entries) {
      await client.cache.mset(entriesFromRecord(entries));
      return "OK";
    },

    // KV 扫描
    keys: (pattern) => client.cache.keys(pattern),
    scan: (cursor, count, pattern) => client.cache.scan(cursor, count, pattern),
    rename: (key, newKey) => client.cache.rename(key, newKey),

    // 计数器
    incr: (key) => client.counter.incr(key),
    incrby: (key, amount) => client.counter.incr(key, amount),
    decr: (key) => client.counter.decr(key),
    decrby: (key, amount) => client.counter.decr(key, amount),

    // Hash
    hget: (key, field) => client.hash.hget(key, field),
    async hset(key, field, value) {
      await client.hash.hset(key, field, value);
      return 1;
    },
    async hmset(key, entries) {
      await client.hash.hmset(key, entriesFromRecord(entries));
      return "OK";
    },
    hmget: (key, ...fields) => client.hash.hmget(key, ...fields),
    hgetall: (key) => client.hash.hgetall(key),
    async hdel(key, ...fields) {
      const results = await Promise.all(fields.map((f) => client.hash.hdel(key, f)));
      return results.filter(Boolean).length;
    },
    async hexists(key, field) {
      return await client.hash.hexists(key, field) ? 1 : 0;
    },
    hlen: (key) => client.hash.hlen(key),
    hincrby: (key, field, amount) => client.hash.hincrby(key, field, amount),
    hkeys: (key) => client.hash.hkeys(key),
    hvals: (key) => client.hash.hvals(key),
    hstrlen: (key, field) => client.hash.hstrlen(key, field),
    hscan: (key, cursor, count) => client.hash.hscan(key, cursor, count),

    // List
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
    lrange: (key, start, stop) => client.list.lrange(key, start, stop),
    async lrem() {
      throw new UnsupportedCommandError("lrem");
    },

    // Set
    sadd: (key, ...members) => client.set.sadd(key, ...members),
    srem: (key, ...members) => client.set.srem(key, ...members),
    smembers: (key) => client.set.smembers(key),
    async sismember(key, member) {
      return await client.set.sismember(key, member) ? 1 : 0;
    },
    scard: (key) => client.set.scard(key),
    sinter: (...keys) => client.set.sinter(...keys),
    sunion: (...keys) => client.set.sunion(...keys),
    sdiff: (key, ...otherKeys) => client.set.sdiff(key, ...otherKeys),
    spop: (key, count) => client.set.spop(key, count),
    srandmember: (key, count) => client.set.srandmember(key, count),
    async smove(source, destination, member) {
      return await client.set.smove(source, destination, member) ? 1 : 0;
    },
    sscan: (key, cursor, count) => client.set.sscan(key, cursor, count),

    // Sorted Set
    async zadd(key, ...args) {
      // zadd key score member [score member ...]
      if (args.length < 2) throw new Error("zadd requires at least score and member");
      let added = 0;
      for (let i = 0; i < args.length - 1; i += 2) {
        const score = Number(args[i]);
        const member = String(args[i + 1]);
        if (await client.sortedSet.zadd(key, score, member)) added++;
      }
      return added;
    },
    zscore: (key, member) => client.sortedSet.zscore(key, member),
    async zrange(key, start, stop) {
      return await client.sortedSet.zrange(key, start, stop, {}) as string[];
    },
    async zrevrange(key, start, stop) {
      return await client.sortedSet.zrange(key, start, stop, { desc: true }) as string[];
    },
    async zrangeByScore(key, min, max) {
      return await client.sortedSet.zrangeByScore(key, min, max, {}) as string[];
    },
    zrank: (key, member) => client.sortedSet.zrank(key, member),
    zcount: (key, min, max) => client.sortedSet.zcount(key, min, max),
    zrem: (key, ...members) => client.sortedSet.zrem(key, ...members),
    zcard: (key) => client.sortedSet.zcard(key),
    zincrby: (key, amount, member) => client.sortedSet.zincrby(key, amount, member),
    zpopmin: (key, count) => client.sortedSet.zpopmin(key, count),
    zpopmax: (key, count) => client.sortedSet.zpopmax(key, count),
    zscan: (key, cursor, count) => client.sortedSet.zscan(key, cursor, count),

    // Pub/Sub
    async publish(channel, payload) {
      await client.pubsub.publish(channel, payload);
      return 1;
    },

    // 连接生命周期
    async connect() {},
    async quit() {},
    disconnect() {},
    duplicate() {
      return createPgredisMigrationAliases(client);
    },
    on(event, handler) {
      noopHandlers.push({ event, handler });
      return this;
    },

    // Pipeline / Multi
    pipeline() {
      return createPipelineFacade(client);
    },
    multi() {
      return createPipelineFacade(client);
    },

    // 不支持命令
    unsupported(command) {
      throw new UnsupportedCommandError(command);
    }
  };
}
