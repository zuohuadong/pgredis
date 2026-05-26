# @postgresx/bun-listen

Bun-native PostgreSQL `LISTEN/NOTIFY` client used by `@postgresx/noredis`. It is published
as a separate package so Bun projects can use it directly without installing
the full `@postgresx/noredis` toolkit.

It connects through `Bun.connect()` and implements the PostgreSQL wire protocol
for notification workloads. It supports TLS negotiation, MD5, cleartext, and
SCRAM-SHA-256 authentication.

## Install

```bash
bun add @postgresx/bun-listen
```

## Usage

```ts
import { createPgListener } from "@postgresx/bun-listen";

const listener = createPgListener(process.env.DATABASE_URL!, {
  channels: ["events"],
  onNotify(channel, payload) {
    console.log(channel, payload);
  }
});

await listener.notify("events", JSON.stringify({ type: "ready" }));

listener.close();
```
