/**
 * ioredis 兼容外观适配器
 *
 * 提供 ioredis 风格的小写方法名和 chainable 接口，
 * 内部委托给 @postgresx/noredis 的 PgredisMigrationAliases。
 *
 * 不安装 ioredis 运行时依赖。用于 NestJS microservices、
 * cache-manager 等期望 ioredis 接口的场景。
 */
import type { PgredisClient } from "../client";
import {
  createPgredisMigrationAliases,
  type PgredisMigrationAliases,
  type PipelineFacade
} from "../redis-aliases";

export interface IoredisAdapterOptions {
  client: PgredisClient;
  /** 是否将不支持命令静默返回 null 而非抛错，默认 false */
  silentUnsupported?: boolean;
}

export interface IoredisLikeAdapter {
  // KV 基础
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  unlink(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  type(key: string): Promise<string>;

  // KV 过期
  expire(key: string, seconds: number): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  ttl(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  persist(key: string): Promise<number>;

  // KV 条件
  setex(key: string, seconds: number, value: string): Promise<"OK">;
  psetex(key: string, ms: number, value: string): Promise<"OK">;
  setnx(key: string, value: string): Promise<number>;
  getset(key: string, value: string): Promise<string | null>;
  getdel(key: string): Promise<string | null>;

  // KV 批量
  mget(...keys: string[]): Promise<Array<string | null>>;
  mset(kv: Record<string, string>): Promise<"OK">;

  // KV 扫描
  keys(pattern?: string): Promise<string[]>;
  scan(cursor?: string | null, options?: { count?: number; match?: string }): Promise<[string | null, string[]]>;
  rename(key: string, newKey: string): Promise<boolean>;

  // 计数器
  incr(key: string): Promise<number>;
  incrby(key: string, amount: number): Promise<number>;
  decr(key: string): Promise<number>;
  decrby(key: string, amount: number): Promise<number>;

  // Hash
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<number>;
  hmset(key: string, kv: Record<string, string>): Promise<"OK">;
  hmget(key: string, ...fields: string[]): Promise<Array<string | null>>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hexists(key: string, field: string): Promise<number>;
  hlen(key: string): Promise<number>;
  hincrby(key: string, field: string, amount?: number): Promise<number>;
  hkeys(key: string): Promise<string[]>;
  hvals(key: string): Promise<string[]>;
  hstrlen(key: string, field: string): Promise<number>;
  hscan(key: string, cursor?: string | null, options?: { count?: number }): Promise<[string | null, Array<[string, string]>]>;

  // List
  lpush(key: string, ...values: string[]): Promise<number>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string): Promise<string | null>;
  rpop(key: string): Promise<string | null>;
  blpop(keys: string | string[], timeout?: number): Promise<[string, string] | null>;
  brpop(keys: string | string[], timeout?: number): Promise<[string, string] | null>;
  llen(key: string): Promise<number>;
  lrange(key: string, start?: number, stop?: number): Promise<string[]>;
  lrem(key: string, count: number, value: string): Promise<number>;

  // Set
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string): Promise<number>;
  scard(key: string): Promise<number>;
  sinter(...keys: string[]): Promise<string[]>;
  sunion(...keys: string[]): Promise<string[]>;
  sdiff(...keys: string[]): Promise<string[]>;
  spop(key: string, count?: number): Promise<string | string[] | null>;
  srandmember(key: string, count?: number): Promise<string | string[] | null>;
  smove(src: string, dst: string, member: string): Promise<number>;
  sscan(key: string, cursor?: string | null, options?: { count?: number }): Promise<[string | null, string[]]>;

  // Sorted Set
  zadd(key: string, ...args: Array<number | string>): Promise<number>;
  zscore(key: string, member: string): Promise<number | null>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zrangebyscore(key: string, min: number, max: number): Promise<string[]>;
  zrank(key: string, member: string): Promise<number | null>;
  zcount(key: string, min: number, max: number): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zcard(key: string): Promise<number>;
  zincrby(key: string, amount: number, member: string): Promise<number>;
  zpopmin(key: string, count?: number): Promise<Array<{ member: string; score: number }>>;
  zpopmax(key: string, count?: number): Promise<Array<{ member: string; score: number }>>;
  zscan(key: string, cursor?: string | null, options?: { count?: number }): Promise<[string | null, Array<{ member: string; score: number }>]>;

  // Pub/Sub
  publish(channel: string, message: string): Promise<number>;

  // 连接生命周期
  connect(): Promise<void>;
  quit(): Promise<void>;
  disconnect(): void;
  duplicate(): IoredisLikeAdapter;

  // 事件（最小兼容外观）
  on(event: string, handler: (...args: unknown[]) => void): IoredisLikeAdapter;
  off(_event: string, _handler: (...args: unknown[]) => void): IoredisLikeAdapter;

  // Pipeline / Multi
  pipeline(): PipelineFacade;
  multi(): PipelineFacade;

  /** 底层 noredis 客户端 */
  readonly noredis: PgredisMigrationAliases;
}

function str<T>(v: T | null): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

function strArr(vals: unknown[]): string[] {
  return vals.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
}

export function createIoredisAdapter(options: IoredisAdapterOptions): IoredisLikeAdapter {
  const aliases = createPgredisMigrationAliases(options.client);
  const silent = options.silentUnsupported ?? false;

  const adapter: IoredisLikeAdapter = {
    noredis: aliases,

    // KV 基础
    get: (key) => aliases.get<string>(key).then(str),
    set: (key, value, ...args) => {
      // ioredis: set(key, value, 'EX', seconds) or set(key, value, 'PX', ms, 'NX')
      const opts: { EX?: number; PX?: number; NX?: boolean; XX?: boolean } = {};
      for (let i = 0; i < args.length; i++) {
        const a = String(args[i]).toUpperCase();
        if (a === "EX" && i + 1 < args.length) { opts.EX = Number(args[++i]); }
        else if (a === "PX" && i + 1 < args.length) { opts.PX = Number(args[++i]); }
        else if (a === "NX") { opts.NX = true; }
        else if (a === "XX") { opts.XX = true; }
      }
      return aliases.set(key, value, opts);
    },
    del: (...keys) => aliases.del(...keys),
    unlink: (...keys) => aliases.unlink(...keys),
    exists: (...keys) => aliases.exists(...keys),
    type: (key) => aliases.type(key).then((t) => t === "none" ? "none" : "string"),

    // KV 过期
    expire: (key, seconds) => aliases.expire(key, seconds),
    pexpire: (key, ms) => aliases.pexpire(key, ms),
    ttl: (key) => aliases.ttl(key),
    pttl: (key) => aliases.pttl(key),
    persist: (key) => aliases.persist(key),

    // KV 条件
    setex: (key, seconds, value) => aliases.setex(key, seconds, value),
    psetex: (key, ms, value) => aliases.psetex(key, ms, value),
    setnx: (key, value) => aliases.setnx(key, value),
    getset: (key, value) => aliases.getset<string>(key, value).then(str),
    getdel: (key) => aliases.getdel<string>(key).then(str),

    // KV 批量
    mget: (...keys) => aliases.mget<string>(...keys).then((vals) => vals.map(str)),
    mset: (kv) => aliases.mset(kv),

    // KV 扫描
    keys: (pattern) => aliases.keys(pattern),
    scan: (cursor, options) => aliases.scan(cursor, options?.count, options?.match)
      .then((r) => [r.cursor, r.keys] as [string | null, string[]]),
    rename: (key, newKey) => aliases.rename(key, newKey),

    // 计数器
    incr: (key) => aliases.incr(key),
    incrby: (key, amount) => aliases.incrby(key, amount),
    decr: (key) => aliases.decr(key),
    decrby: (key, amount) => aliases.decrby(key, amount),

    // Hash
    hget: (key, field) => aliases.hget<string>(key, field).then(str),
    hset: (key, field, value) => aliases.hset(key, field, value),
    hmset: (key, kv) => aliases.hmset(key, kv),
    hmget: (key, ...fields) => aliases.hmget<string>(key, ...fields).then((vals) => vals.map(str)),
    hgetall: (key) => aliases.hgetall<string>(key),
    hdel: (key, ...fields) => aliases.hdel(key, ...fields),
    hexists: (key, field) => aliases.hexists(key, field),
    hlen: (key) => aliases.hlen(key),
    hincrby: (key, field, amount) => aliases.hincrby(key, field, amount),
    hkeys: (key) => aliases.hkeys(key),
    hvals: (key) => aliases.hvals<string>(key).then(strArr),
    hstrlen: (key, field) => aliases.hstrlen(key, field),
    hscan: (key, cursor, options) => aliases.hscan<string>(key, cursor, options?.count)
      .then((r) => [r.cursor, r.entries] as [string | null, Array<[string, string]>]),

    // List
    lpush: (key, ...values) => aliases.lpush(key, ...values),
    rpush: (key, ...values) => aliases.rpush(key, ...values),
    lpop: (key) => aliases.lpop<string>(key).then(str),
    rpop: (key) => aliases.rpop<string>(key).then(str),
    blpop: (keys, timeout) => aliases.blpop<string>(keys, timeout),
    brpop: (keys, timeout) => aliases.brpop<string>(keys, timeout),
    llen: (key) => aliases.llen(key),
    lrange: (key, start, stop) => aliases.lrange<string>(key, start, stop).then(strArr),
    lrem: (key, count, value) => aliases.lrem(key, count, value),

    // Set
    sadd: (key, ...members) => aliases.sadd(key, ...members),
    srem: (key, ...members) => aliases.srem(key, ...members),
    smembers: (key) => aliases.smembers(key),
    sismember: (key, member) => aliases.sismember(key, member),
    scard: (key) => aliases.scard(key),
    sinter: (...keys) => aliases.sinter(...keys),
    sunion: (...keys) => aliases.sunion(...keys),
    sdiff: (...keys) => aliases.sdiff(...keys),
    spop: (key, count) => {
      if (count === undefined) return aliases.spop(key, 1).then((r) => r[0] ?? null) as unknown as Promise<string | string[]>;
      return aliases.spop(key, count) as unknown as Promise<string | string[]>;
    },
    srandmember: (key, count) => {
      if (count === undefined) return aliases.srandmember(key, 1).then((r) => r[0] ?? null) as unknown as Promise<string | string[]>;
      return aliases.srandmember(key, count) as unknown as Promise<string | string[]>;
    },
    smove: (src, dst, member) => aliases.smove(src, dst, member),
    sscan: (key, cursor, options) => aliases.sscan(key, cursor, options?.count)
      .then((r) => [r.cursor, r.members] as [string | null, string[]]),

    // Sorted Set
    zadd: (key, ...args) => aliases.zadd(key, ...args),
    zscore: (key, member) => aliases.zscore(key, member),
    zrange: (key, start, stop) => aliases.zrange(key, start, stop),
    zrevrange: (key, start, stop) => aliases.zrevrange(key, start, stop),
    zrangebyscore: (key, min, max) => aliases.zrangeByScore(key, min, max),
    zrank: (key, member) => aliases.zrank(key, member),
    zcount: (key, min, max) => aliases.zcount(key, min, max),
    zrem: (key, ...members) => aliases.zrem(key, ...members),
    zcard: (key) => aliases.zcard(key),
    zincrby: (key, amount, member) => aliases.zincrby(key, amount, member),
    zpopmin: (key, count) => aliases.zpopmin(key, count),
    zpopmax: (key, count) => aliases.zpopmax(key, count),
    zscan: (key, cursor, options) => aliases.zscan(key, cursor, options?.count)
      .then((r) => [r.cursor, r.entries] as [string | null, Array<{ member: string; score: number }>]),

    // Pub/Sub
    publish: (channel, message) => aliases.publish(channel, message),

    // 连接
    connect: () => aliases.connect(),
    quit: () => aliases.quit(),
    disconnect: () => aliases.disconnect(),
    duplicate: () => createIoredisAdapter({ client: options.client, silentUnsupported: silent }),
    on: (event, handler) => { aliases.on(event, handler); return adapter; },
    off: () => adapter,

    // Pipeline
    pipeline: () => aliases.pipeline(),
    multi: () => aliases.multi(),
  };

  return adapter;
}
