export interface PgBossQueueDefinition {
  name?: string;
  [key: string]: unknown;
}

export type PgBossQueueMap = Record<string, Omit<PgBossQueueDefinition, "name">>;

export interface PgBossQueueOptions {
  connectionString?: string;
  schema?: string;
  queues?: PgBossQueueMap;
  [key: string]: unknown;
}

export type PgBossOptions = PgBossQueueOptions;

export interface PgBossJob<T extends object = object> {
  id: string;
  name?: string;
  data: T;
  [key: string]: unknown;
}

export interface PgBossQueueResult {
  name: string;
  [key: string]: unknown;
}

export interface PgBossSendOptions {
  [key: string]: unknown;
}

export interface PgBossWorkOptions {
  [key: string]: unknown;
}

export type PgBossWorkHandler<T extends object = object> = (jobs: PgBossJob<T>[]) => Promise<void> | void;

export interface PgBossLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  createQueue(name: string, options?: Omit<PgBossQueueDefinition, "name">): Promise<void>;
  send<T extends object>(name: string, data?: T | null, options?: PgBossSendOptions): Promise<string | null>;
  work<T extends object>(name: string, options: PgBossWorkOptions, handler: PgBossWorkHandler<T>): Promise<string>;
  getQueues(): Promise<PgBossQueueResult[]>;
}

async function loadPgBoss(): Promise<{ PgBoss: new (options: PgBossQueueOptions | string) => PgBossLike }> {
  try {
    const specifier = "pg-boss";
    return await import(specifier) as { PgBoss: new (options: PgBossQueueOptions | string) => PgBossLike };
  } catch (error) {
    throw new Error("pg-boss is required for pgredis queue features. Install it with `npm install pg-boss`.", {
      cause: error
    });
  }
}

export class PgBossJobQueue {
  private boss: PgBossLike | null = null;

  constructor(private readonly options: PgBossQueueOptions | string) {}

  async start(): Promise<PgBossLike> {
    if (this.boss) return this.boss;
    const { PgBoss } = await loadPgBoss();
    const boss = typeof this.options === "string"
      ? new PgBoss(this.options)
      : new PgBoss(this.options);
    await boss.start();
    const queues = typeof this.options === "string" ? undefined : this.options.queues;
    if (queues) {
      for (const [name, options] of Object.entries(queues)) {
        await boss.createQueue(name, options);
      }
    }
    this.boss = boss;
    return boss;
  }

  async stop(): Promise<void> {
    if (!this.boss) return;
    const boss = this.boss;
    this.boss = null;
    await boss.stop();
  }

  async ensureQueue(name: string, options: Omit<PgBossQueueDefinition, "name"> = {}): Promise<void> {
    const boss = await this.start();
    await boss.createQueue(name, options);
  }

  async send<T extends object>(name: string, data?: T | null, options?: PgBossSendOptions): Promise<string | null> {
    const boss = await this.start();
    return boss.send(name, data ?? null, options);
  }

  async work<T extends object>(
    name: string,
    options: PgBossWorkOptions,
    handler: PgBossWorkHandler<T>
  ): Promise<string> {
    const boss = await this.start();
    return boss.work<T>(name, options, handler);
  }

  async getBoss(): Promise<PgBossLike> {
    return this.start();
  }
}

export function createPgBossJobQueue(options: PgBossQueueOptions | string): PgBossJobQueue {
  return new PgBossJobQueue(options);
}

export type {
  PgBossJob as Job,
  PgBossLike as PgBoss,
  PgBossQueueDefinition as Queue,
  PgBossQueueResult as QueueResult,
  PgBossSendOptions as SendOptions,
  PgBossWorkHandler as WorkHandler,
  PgBossWorkOptions as WorkOptions
};
