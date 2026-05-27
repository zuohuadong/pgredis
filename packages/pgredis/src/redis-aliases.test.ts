import { describe, test, expect, mock as mockFn } from "bun:test";
import { createPgredisMigrationAliases, type PgredisMigrationAliases } from "./redis-aliases";
import { UnsupportedCommandError } from "./errors";

// Mock PgredisClient
function createMockClient(): any {
  const cache = {
    get: mockFn(async (key: string) => `val:${key}`),
    set: mockFn(async () => true),
    delete: mockFn(async () => true),
    mget: mockFn(async (keys: readonly string[]) => {
      const m = new Map<string, unknown>();
      keys.forEach((k) => m.set(k, `val:${k}`));
      return m;
    }),
    mset: mockFn(async () => {}),
    expire: mockFn(async () => true),
    ttl: mockFn(async () => 5000),
    persist: mockFn(async () => true),
    type: mockFn(async () => "string" as const),
    unlink: mockFn(async (..._keys: string[]) => 2),
    setex: mockFn(async () => "OK" as const),
    psetex: mockFn(async () => "OK" as const),
    setnx: mockFn(async () => 1),
    getset: mockFn(async () => "old"),
    getdel: mockFn(async () => "deleted"),
    keys: mockFn(async () => ["k1", "k2"]),
    scan: mockFn(async () => ({ cursor: null, keys: ["k1"] })),
    rename: mockFn(async () => true),
  };

  const counter = {
    incr: mockFn(async (_key: string, amount?: number) => amount ?? 1),
    decr: mockFn(async (_key: string, amount?: number) => -(amount ?? 1)),
    cleanupExpired: mockFn(async () => 0),
  };

  const hash = {
    hget: mockFn(async () => "hval"),
    hset: mockFn(async () => {}),
    hmset: mockFn(async () => {}),
    hmget: mockFn(async () => ["f1", "f2"]),
    hgetall: mockFn(async () => ({ f1: "v1" })),
    hdel: mockFn(async () => true),
    hexists: mockFn(async () => true),
    hlen: mockFn(async () => 3),
    hincrby: mockFn(async () => 5),
    hkeys: mockFn(async () => ["f1", "f2"]),
    hvals: mockFn(async () => ["v1", "v2"]),
    hstrlen: mockFn(async () => 4),
    hscan: mockFn(async () => ({ cursor: null, entries: [["f1", "v1"]] as Array<readonly [string, unknown]> })),
  };

  const set = {
    sadd: mockFn(async () => 2),
    srem: mockFn(async () => 1),
    smembers: mockFn(async () => ["a", "b"]),
    sismember: mockFn(async () => true),
    scard: mockFn(async () => 5),
    sinter: mockFn(async () => ["a"]),
    sunion: mockFn(async () => ["a", "b"]),
    sdiff: mockFn(async () => ["a"]),
    spop: mockFn(async () => ["a"]),
    srandmember: mockFn(async () => ["b"]),
    smove: mockFn(async () => true),
    sscan: mockFn(async () => ({ cursor: null, members: ["a"] })),
  };

  const sortedSet = {
    zadd: mockFn(async () => true),
    zscore: mockFn(async () => 10.5),
    zrange: mockFn(async () => ["m1", "m2"]),
    zrangeByScore: mockFn(async () => ["m1"]),
    zrank: mockFn(async () => 0),
    zcount: mockFn(async () => 3),
    zrem: mockFn(async () => 1),
    zcard: mockFn(async () => 10),
    zincrby: mockFn(async () => 15),
    zpopmin: mockFn(async () => [{ member: "m1", score: 1 }]),
    zpopmax: mockFn(async () => [{ member: "m3", score: 100 }]),
    zscan: mockFn(async () => ({ cursor: null, entries: [{ member: "m1", score: 1 }] })),
  };

  const list = {
    lpush: mockFn(async () => 3),
    rpush: mockFn(async () => 3),
    lpop: mockFn(async () => ["val"]),
    rpop: mockFn(async () => ["val"]),
    blpop: mockFn(async () => ({ key: "mylist", value: "val" })),
    brpop: mockFn(async () => ({ key: "mylist", value: "val" })),
    llen: mockFn(async () => 5),
    lrange: mockFn(async () => ["a", "b"]),
  };

  const pubsub = {
    publish: mockFn(async () => {}),
  };

  return { cache, counter, hash, set, sortedSet, list, pubsub };
}

type MockClient = ReturnType<typeof createMockClient>;

function asPgredisClient(mock: MockClient) {
  return mock as unknown as import("./client").PgredisClient;
}

describe("PgredisMigrationAliases", () => {
  function makeAliases(): { aliases: PgredisMigrationAliases; mock: MockClient } {
    const mock = createMockClient();
    const aliases = createPgredisMigrationAliases(asPgredisClient(mock));
    return { aliases, mock };
  }

  test("get returns cached value", async () => {
    const { aliases } = makeAliases();
    const val = await aliases.get("k");
    expect(val).toBe("val:k");
  });

  test("set with EX option returns OK", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.set("k", "v", { EX: 60 });
    expect(result).toBe("OK");
  });

  test("set with NX option", async () => {
    const { aliases, mock } = makeAliases();
    mock.cache.set = mockFn(async () => false);
    const result = await aliases.set("k", "v", { NX: true });
    expect(result).toBeNull();
  });

  test("del returns count", async () => {
    const { aliases, mock } = makeAliases();
    mock.cache.delete = mockFn(async () => true);
    const count = await aliases.del("k1", "k2");
    expect(count).toBe(2);
  });

  test("unlink delegates to cache", async () => {
    const { aliases } = makeAliases();
    const count = await aliases.unlink("k1", "k2");
    expect(count).toBe(2);
  });

  test("exists returns count of found keys", async () => {
    const { aliases } = makeAliases();
    const count = await aliases.exists("k1", "k2");
    expect(count).toBe(2);
  });

  test("type returns string for existing key", async () => {
    const { aliases } = makeAliases();
    const t = await aliases.type("k");
    expect(t).toBe("string");
  });

  test("type returns none for missing key", async () => {
    const { aliases, mock } = makeAliases();
    mock.cache.type = mockFn(async () => "none" as const);
    const t = await aliases.type("missing");
    expect(t).toBe("none");
  });

  test("expire converts seconds to ms", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.expire("k", 60);
    expect(result).toBe(1);
  });

  test("ttl returns seconds", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.ttl("k");
    expect(result).toBe(5); // 5000ms -> 5s
  });

  test("ttl returns -2 for missing key", async () => {
    const { aliases, mock } = makeAliases();
    mock.cache.get = mockFn(async () => null);
    const result = await aliases.ttl("missing");
    expect(result).toBe(-2);
  });

  test("persist returns 1 on success", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.persist("k");
    expect(result).toBe(1);
  });

  test("setex delegates", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.setex("k", 60, "v");
    expect(result).toBe("OK");
  });

  test("psetex delegates", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.psetex("k", 60000, "v");
    expect(result).toBe("OK");
  });

  test("setnx returns 1 on success", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.setnx("k", "v");
    expect(result).toBe(1);
  });

  test("getset returns old value", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.getset("k", "new");
    expect(result).toBe("old");
  });

  test("getdel returns and deletes", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.getdel("k");
    expect(result).toBe("deleted");
  });

  test("mget returns array with nulls", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.mget("k1", "k2");
    expect(result).toEqual(["val:k1", "val:k2"]);
  });

  test("mset returns OK", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.mset({ a: "1", b: "2" });
    expect(result).toBe("OK");
  });

  test("keys delegates", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.keys("*");
    expect(result).toEqual(["k1", "k2"]);
  });

  test("scan delegates", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.scan(null, 100, "*");
    expect(result).toEqual({ cursor: null, keys: ["k1"] });
  });

  test("rename delegates", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.rename("old", "new");
    expect(result).toBe(true);
  });

  test("incr/decr delegates", async () => {
    const { aliases } = makeAliases();
    expect(await aliases.incr("k")).toBe(1);
    expect(await aliases.incrby("k", 5)).toBe(5);
    expect(await aliases.decr("k")).toBe(-1);
    expect(await aliases.decrby("k", 3)).toBe(-3);
  });

  // Hash
  test("hget/hset/hmset/hmget/hgetall", async () => {
    const { aliases } = makeAliases();
    expect(await aliases.hget<string>("h", "f")).toBe("hval");
    expect(await aliases.hset("h", "f", "v")).toBe(1);
    expect(await aliases.hmset("h", { f1: "v1" })).toBe("OK");
    expect(await aliases.hmget("h", "f1", "f2")).toEqual(["f1", "f2"]);
    expect(await aliases.hgetall("h")).toEqual({ f1: "v1" });
  });

  test("hdel/hexists/hlen/hincrby/hkeys/hvals/hstrlen/hscan", async () => {
    const { aliases } = makeAliases();
    expect(await aliases.hdel("h", "f")).toBe(1);
    expect(await aliases.hexists("h", "f")).toBe(1);
    expect(await aliases.hlen("h")).toBe(3);
    expect(await aliases.hincrby("h", "f", 2)).toBe(5);
    expect(await aliases.hkeys("h")).toEqual(["f1", "f2"]);
    expect(await aliases.hvals("h")).toEqual(["v1", "v2"]);
    expect(await aliases.hstrlen("h", "f")).toBe(4);
    expect(await aliases.hscan("h")).toEqual({ cursor: null, entries: [["f1", "v1"]] });
  });

  // List
  test("lpush/rpush/lpop/rpop/llen/lrange", async () => {
    const { aliases } = makeAliases();
    expect(await aliases.lpush("l", "a")).toBe(3);
    expect(await aliases.rpush("l", "b")).toBe(3);
    expect(await aliases.lpop<string>("l")).toBe("val");
    expect(await aliases.rpop<string>("l")).toBe("val");
    expect(await aliases.llen("l")).toBe(5);
    expect(await aliases.lrange("l", 0, -1)).toEqual(["a", "b"]);
  });

  test("lrem throws UnsupportedCommandError", async () => {
    const { aliases } = makeAliases();
    await expect(aliases.lrem("l", 1, "val")).rejects.toThrow(UnsupportedCommandError);
  });

  // Set
  test("sadd/srem/smembers/sismember/scard/sinter/sunion/sdiff", async () => {
    const { aliases } = makeAliases();
    expect(await aliases.sadd("s", "a")).toBe(2);
    expect(await aliases.srem("s", "a")).toBe(1);
    expect(await aliases.smembers("s")).toEqual(["a", "b"]);
    expect(await aliases.sismember("s", "a")).toBe(1);
    expect(await aliases.scard("s")).toBe(5);
    expect(await aliases.sinter("s1", "s2")).toEqual(["a"]);
    expect(await aliases.sunion("s1", "s2")).toEqual(["a", "b"]);
    expect(await aliases.sdiff("s1", "s2")).toEqual(["a"]);
  });

  test("spop/srandmember/smove/sscan", async () => {
    const { aliases } = makeAliases();
    expect(await aliases.spop("s")).toEqual(["a"]);
    expect(await aliases.srandmember("s")).toEqual(["b"]);
    expect(await aliases.smove("s1", "s2", "a")).toBe(1);
    expect(await aliases.sscan("s")).toEqual({ cursor: null, members: ["a"] });
  });

  // Sorted Set
  test("zadd/zscore/zrange/zrevrange/zrangeByScore/zrank/zcount/zrem/zcard/zincrby", async () => {
    const { aliases } = makeAliases();
    expect(await aliases.zadd("z", 1, "m1")).toBe(1);
    expect(await aliases.zscore("z", "m1")).toBe(10.5);
    expect(await aliases.zrange("z", 0, -1)).toEqual(["m1", "m2"]);
    expect(await aliases.zrevrange("z", 0, -1)).toEqual(["m1", "m2"]);
    expect(await aliases.zrangeByScore("z", 0, 100)).toEqual(["m1"]);
    expect(await aliases.zrank("z", "m1")).toBe(0);
    expect(await aliases.zcount("z", 0, 100)).toBe(3);
    expect(await aliases.zrem("z", "m1")).toBe(1);
    expect(await aliases.zcard("z")).toBe(10);
    expect(await aliases.zincrby("z", 5, "m1")).toBe(15);
  });

  test("zpopmin/zpopmax/zscan", async () => {
    const { aliases } = makeAliases();
    expect(await aliases.zpopmin("z")).toEqual([{ member: "m1", score: 1 }]);
    expect(await aliases.zpopmax("z")).toEqual([{ member: "m3", score: 100 }]);
    expect(await aliases.zscan("z")).toEqual({ cursor: null, entries: [{ member: "m1", score: 1 }] });
  });

  // Pub/Sub
  test("publish returns 1", async () => {
    const { aliases } = makeAliases();
    expect(await aliases.publish("ch", "msg")).toBe(1);
  });

  // 连接生命周期
  test("connect/quit/disconnect/duplicate/on", async () => {
    const { aliases } = makeAliases();
    await aliases.connect();
    await aliases.quit();
    aliases.disconnect();
    const dup = aliases.duplicate();
    expect(dup).toBeDefined();
    const ref = aliases.on("message", () => {});
    expect(ref).toBe(aliases);
  });

  // Pipeline
  test("pipeline/multi returns facade", async () => {
    const { aliases } = makeAliases();
    const p = aliases.pipeline();
    expect(p).toBeDefined();
    expect(p.queue).toEqual([]);
    const m = aliases.multi();
    expect(m).toBeDefined();
  });

  // Unsupported
  test("unsupported throws UnsupportedCommandError", () => {
    const { aliases } = makeAliases();
    expect(() => aliases.unsupported("EVAL")).toThrow(UnsupportedCommandError);
  });

  // blpop / brpop
  test("blpop/brpop returns tuple", async () => {
    const { aliases } = makeAliases();
    const result = await aliases.blpop("list", 5);
    expect(result).toEqual(["mylist", "val"]);
    const result2 = await aliases.brpop("list", 5);
    expect(result2).toEqual(["mylist", "val"]);
  });
});
