/**
 * redis.js (node-redis) 兼容外观适配器
 *
 * 提供 redis.js 风格的 camelCase 方法名和返回值结构，
 * 内部委托给 @postgresx/noredis 的 PgredisMigrationAliases。
 *
 * 不安装 redis 运行时依赖。
 */
import type { PgredisClient } from "../client";
import {
  createPgredisMigrationAliases,
  type PgredisMigrationAliases,
  type PipelineFacade
} from "../redis-aliases";

export interface RedisJsAdapterOptions {
  client: PgredisClient;
}

export interface RedisJsLikeAdapter {
  // KV 基础
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number; PX?: number; NX?: boolean; XX?: boolean }): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  unlink(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  type(key: string): Promise<string>;

  // KV 过期
  expire(key: string, seconds: number): Promise<number>;
  pExpire(key: string, ms: number): Promise<number>;
  ttl(key: string): Promise<number>;
  pTtl(key: string): Promise<number>;
  persist(key: string): Promise<number>;

  // KV 条件
  setEx(key: string, seconds: number, value: string): Promise<"OK">;
  pSetEx(key: string, ms: number, value: string): Promise<"OK">;
  setNx(key: string, value: string): Promise<number>;
  getSet(key: string, value: string): Promise<string | null>;
  getDel(key: string): Promise<string | null>;

  // KV 批量
  mGet(...keys: string[]): Promise<Array<string | null>>;
  mSet(kv: Record<string, string>): Promise<"OK">;

  // KV 扫描
  keys(pattern?: string): Promise<string[]>;
  scan(cursor?: string | null, options?: { count?: number; match?: string }): Promise<{ cursor: string | null; keys: string[] }>;
  rename(key: string, newKey: string): Promise<boolean>;

  // 计数器
  incr(key: string): Promise<number>;
  incrBy(key: string, amount: number): Promise<number>;
  decr(key: string): Promise<number>;
  decrBy(key: string, amount: number): Promise<number>;

  // Hash
  hGet(key: string, field: string): Promise<string | null>;
  hSet(key: string, field: string, value: string): Promise<number>;
  hmSet(key: string, kv: Record<string, string>): Promise<"OK">;
  hmGet(key: string, ...fields: string[]): Promise<Array<string | null>>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hDel(key: string, ...fields: string[]): Promise<number>;
  hExists(key: string, field: string): Promise<number>;
  hLen(key: string): Promise<number>;
  hIncrBy(key: string, field: string, amount?: number): Promise<number>;
  hKeys(key: string): Promise<string[]>;
  hVals(key: string): Promise<string[]>;
  hStrLen(key: string, field: string): Promise<number>;
  hScan(key: string, cursor?: string | null, options?: { count?: number }): Promise<{ cursor: string | null; entries: Array<[string, string]> }>;

  // List
  lPush(key: string, ...values: string[]): Promise<number>;
  rPush(key: string, ...values: string[]): Promise<number>;
  lPop(key: string): Promise<string | null>;
  rPop(key: string): Promise<string | null>;
  blPop(keys: string | string[], timeout?: number): Promise<[string, string] | null>;
  brPop(keys: string | string[], timeout?: number): Promise<[string, string] | null>;
  lLen(key: string): Promise<number>;
  lRange(key: string, start?: number, stop?: number): Promise<string[]>;
  lRem(key: string, count: number, value: string): Promise<number>;

  // Set
  sAdd(key: string, ...members: string[]): Promise<number>;
  sRem(key: string, ...members: string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  sIsMember(key: string, member: string): Promise<number>;
  sCard(key: string): Promise<number>;
  sInter(...keys: string[]): Promise<string[]>;
  sUnion(...keys: string[]): Promise<string[]>;
  sDiff(...keys: string[]): Promise<string[]>;
  sPop(key: string, count?: number): Promise<string[]>;
  sRandMember(key: string, count?: number): Promise<string[]>;
  sMove(src: string, dst: string, member: string): Promise<number>;
  sScan(key: string, cursor?: string | null, options?: { count?: number }): Promise<{ cursor: string | null; members: string[] }>;

  // Sorted Set
  zAdd(key: string, ...args: Array<number | string>): Promise<number>;
  zScore(key: string, member: string): Promise<number | null>;
  zRange(key: string, start: number, stop: number): Promise<string[]>;
  zRevRange(key: string, start: number, stop: number): Promise<string[]>;
  zRangeByScore(key: string, min: number, max: number): Promise<string[]>;
  zRank(key: string, member: string): Promise<number | null>;
  zCount(key: string, min: number, max: number): Promise<number>;
  zRem(key: string, ...members: string[]): Promise<number>;
  zCard(key: string): Promise<number>;
  zIncrBy(key: string, amount: number, member: string): Promise<number>;
  zPopMin(key: string, count?: number): Promise<Array<{ member: string; score: number }>>;
  zPopMax(key: string, count?: number): Promise<Array<{ member: string; score: number }>>;
  zScan(key: string, cursor?: string | null, options?: { count?: number }): Promise<{ cursor: string | null; entries: Array<{ member: string; score: number }> }>;

  // Pub/Sub
  publish(channel: string, message: string): Promise<number>;

  // 连接
  connect(): Promise<void>;
  quit(): Promise<void>;
  disconnect(): void;
  duplicate(): RedisJsLikeAdapter;
  on(event: string, handler: (...args: unknown[]) => void): RedisJsLikeAdapter;

  // Pipeline
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

export function createRedisJsAdapter(options: RedisJsAdapterOptions): RedisJsLikeAdapter {
  const aliases = createPgredisMigrationAliases(options.client);

  const adapter: RedisJsLikeAdapter = {
    noredis: aliases,

    // KV 基础
    get: (key) => aliases.get<string>(key).then(str),
    set: (key, value, options) => aliases.set(key, value, options ?? {}),
    del: (...keys) => aliases.del(...keys),
    unlink: (...keys) => aliases.unlink(...keys),
    exists: (...keys) => aliases.exists(...keys),
    type: (key) => aliases.type(key).then((t) => t === "none" ? "none" : "string"),

    // KV 过期
    expire: (key, seconds) => aliases.expire(key, seconds),
    pExpire: (key, ms) => aliases.pexpire(key, ms),
    ttl: (key) => aliases.ttl(key),
    pTtl: (key) => aliases.pttl(key),
    persist: (key) => aliases.persist(key),

    // KV 条件
    setEx: (key, seconds, value) => aliases.setex(key, seconds, value),
    pSetEx: (key, ms, value) => aliases.psetex(key, ms, value),
    setNx: (key, value) => aliases.setnx(key, value),
    getSet: (key, value) => aliases.getset<string>(key, value).then(str),
    getDel: (key) => aliases.getdel<string>(key).then(str),

    // KV 批量
    mGet: (...keys) => aliases.mget<string>(...keys).then((vals) => vals.map(str)),
    mSet: (kv) => aliases.mset(kv),

    // KV 扫描
    keys: (pattern) => aliases.keys(pattern),
    scan: (cursor, options) => aliases.scan(cursor, options?.count, options?.match),
    rename: (key, newKey) => aliases.rename(key, newKey),

    // 计数器
    incr: (key) => aliases.incr(key),
    incrBy: (key, amount) => aliases.incrby(key, amount),
    decr: (key) => aliases.decr(key),
    decrBy: (key, amount) => aliases.decrby(key, amount),

    // Hash
    hGet: (key, field) => aliases.hget<string>(key, field).then(str),
    hSet: (key, field, value) => aliases.hset(key, field, value),
    hmSet: (key, kv) => aliases.hmset(key, kv),
    hmGet: (key, ...fields) => aliases.hmget<string>(key, ...fields).then((vals) => vals.map(str)),
    hGetAll: (key) => aliases.hgetall<string>(key),
    hDel: (key, ...fields) => aliases.hdel(key, ...fields),
    hExists: (key, field) => aliases.hexists(key, field),
    hLen: (key) => aliases.hlen(key),
    hIncrBy: (key, field, amount) => aliases.hincrby(key, field, amount),
    hKeys: (key) => aliases.hkeys(key),
    hVals: (key) => aliases.hvals<string>(key).then(strArr),
    hStrLen: (key, field) => aliases.hstrlen(key, field),
    hScan: (key, cursor, options) => aliases.hscan<string>(key, cursor, options?.count)
      .then((r) => ({ cursor: r.cursor, entries: r.entries as Array<[string, string]> })),

    // List
    lPush: (key, ...values) => aliases.lpush(key, ...values),
    rPush: (key, ...values) => aliases.rpush(key, ...values),
    lPop: (key) => aliases.lpop<string>(key).then(str),
    rPop: (key) => aliases.rpop<string>(key).then(str),
    blPop: (keys, timeout) => aliases.blpop<string>(keys, timeout),
    brPop: (keys, timeout) => aliases.brpop<string>(keys, timeout),
    lLen: (key) => aliases.llen(key),
    lRange: (key, start, stop) => aliases.lrange<string>(key, start, stop).then(strArr),
    lRem: (key, count, value) => aliases.lrem(key, count, value),

    // Set
    sAdd: (key, ...members) => aliases.sadd(key, ...members),
    sRem: (key, ...members) => aliases.srem(key, ...members),
    sMembers: (key) => aliases.smembers(key),
    sIsMember: (key, member) => aliases.sismember(key, member),
    sCard: (key) => aliases.scard(key),
    sInter: (...keys) => aliases.sinter(...keys),
    sUnion: (...keys) => aliases.sunion(...keys),
    sDiff: (...keys) => aliases.sdiff(...keys),
    sPop: (key, count) => aliases.spop(key, count),
    sRandMember: (key, count) => aliases.srandmember(key, count),
    sMove: (src, dst, member) => aliases.smove(src, dst, member),
    sScan: (key, cursor, options) => aliases.sscan(key, cursor, options?.count),

    // Sorted Set
    zAdd: (key, ...args) => aliases.zadd(key, ...args),
    zScore: (key, member) => aliases.zscore(key, member),
    zRange: (key, start, stop) => aliases.zrange(key, start, stop),
    zRevRange: (key, start, stop) => aliases.zrevrange(key, start, stop),
    zRangeByScore: (key, min, max) => aliases.zrangeByScore(key, min, max),
    zRank: (key, member) => aliases.zrank(key, member),
    zCount: (key, min, max) => aliases.zcount(key, min, max),
    zRem: (key, ...members) => aliases.zrem(key, ...members),
    zCard: (key) => aliases.zcard(key),
    zIncrBy: (key, amount, member) => aliases.zincrby(key, amount, member),
    zPopMin: (key, count) => aliases.zpopmin(key, count),
    zPopMax: (key, count) => aliases.zpopmax(key, count),
    zScan: (key, cursor, options) => aliases.zscan(key, cursor, options?.count),

    // Pub/Sub
    publish: (channel, message) => aliases.publish(channel, message),

    // 连接
    connect: () => aliases.connect(),
    quit: () => aliases.quit(),
    disconnect: () => aliases.disconnect(),
    duplicate: () => createRedisJsAdapter({ client: options.client }),
    on: (event, handler) => { aliases.on(event, handler); return adapter; },

    // Pipeline
    pipeline: () => aliases.pipeline(),
    multi: () => aliases.multi(),
  };

  return adapter;
}
