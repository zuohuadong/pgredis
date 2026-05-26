import type { PgredisClient } from "./client";

export type PgredisBatchOperation<T = unknown> = (client: PgredisClient) => Promise<T> | T;

export class PgredisPipeline {
  private readonly operations: PgredisBatchOperation[] = [];

  constructor(private readonly runBatch: <T>(operation: PgredisBatchOperation<T>) => Promise<T>) {}

  add<T>(operation: PgredisBatchOperation<T>): this {
    this.operations.push(operation);
    return this;
  }

  get<T = unknown>(key: string): this {
    return this.add((client) => client.cache.get<T>(key));
  }

  set<T = unknown>(key: string, value: T, options?: Parameters<PgredisClient["cache"]["set"]>[2]): this {
    return this.add((client) => client.cache.set(key, value, options));
  }

  del(key: string): this {
    return this.add((client) => client.cache.delete(key));
  }

  incr(key: string, amount?: number): this {
    return this.add((client) => client.counter.incr(key, amount));
  }

  publish(channel: string, payload: Parameters<PgredisClient["pubsub"]["publish"]>[1]): this {
    return this.add((client) => client.pubsub.publish(channel, payload));
  }

  async exec(): Promise<unknown[]> {
    const operations = [...this.operations];
    this.operations.length = 0;
    return this.runBatch(async (client) => {
      const results: unknown[] = [];
      for (const operation of operations) {
        results.push(await operation(client));
      }
      return results;
    });
  }
}
