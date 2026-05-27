# @postgresx/noredis-ioredis

Thin re-export package for projects using npm alias migrations such as:

```json
{
  "dependencies": {
    "ioredis": "npm:@postgresx/noredis-ioredis"
  }
}
```

It exposes `createIoredisAdapter()` from `@postgresx/noredis/adapters/ioredis`.
It is not a Redis protocol client and does not provide a drop-in `new Redis()`
constructor. Create a normal `PgredisClient` first, then wrap it:

```ts
import { createPgredis } from "@postgresx/noredis";
import { createIoredisAdapter } from "ioredis";

const pg = createPgredis({ sql });
const redis = createIoredisAdapter({ client: pg });
```
