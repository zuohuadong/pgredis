import { describe, expect, test } from "bun:test";
import { PgredisPipeline, type PgredisBatchOperation } from "./pipeline";

describe("PgredisPipeline", () => {
  function createPipeline() {
    const log: string[] = [];
    const runBatch = async <T>(op: PgredisBatchOperation<T>) => {
      log.push("batch-start");
      const result = await op({} as any);
      log.push("batch-end");
      return result;
    };
    const pipeline = new PgredisPipeline(runBatch);
    return { pipeline, log };
  }

  test("collects and executes chained operations", async () => {
    const { pipeline } = createPipeline();
    const results = await pipeline
      .add(() => "a")
      .add(() => "b")
      .exec();

    expect(results).toEqual(["a", "b"]);
  });

  test("get/set/del/incr/publish chain returns ordered results", async () => {
    const mockClient = {
      cache: { get: async () => "v1", set: async () => true, delete: async () => true },
      counter: { incr: async () => 2 },
      pubsub: { publish: async () => {} },
    };
    const runBatch = async <T>(op: any) => op(mockClient);
    const pipeline = new PgredisPipeline(runBatch);
    const results = await pipeline
      .get("k1")
      .set("k2", "v2")
      .del("k3")
      .incr("counter", 5)
      .publish("ch", { msg: 1 })
      .exec();

    expect(results).toEqual(["v1", true, true, 2, undefined]);
  });

  test("clears operations after exec", async () => {
    const { pipeline } = createPipeline();
    await pipeline.add(() => 1).exec();
    const results = await pipeline.add(() => 2).exec();
    expect(results).toEqual([2]);
  });

  test("exec with no operations returns empty array", async () => {
    const { pipeline } = createPipeline();
    const results = await pipeline.exec();
    expect(results).toEqual([]);
  });

  test("preserves operation order within batch", async () => {
    const order: number[] = [];
    const pipeline = new PgredisPipeline(async (op) => op({} as any));
    await pipeline
      .add(() => { order.push(1); })
      .add(() => { order.push(2); })
      .add(() => { order.push(3); })
      .exec();

    expect(order).toEqual([1, 2, 3]);
  });
});
