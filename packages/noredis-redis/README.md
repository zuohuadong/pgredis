# @postgresx/noredis-redis

Thin re-export package for projects using npm alias migrations such as:

```json
{
  "dependencies": {
    "redis": "npm:@postgresx/noredis-redis"
  }
}
```

It exposes `createRedisJsAdapter()` from `@postgresx/noredis/adapters/redis`.
It is not a Redis protocol client and does not provide a drop-in `createClient()`
replacement. Create a normal `PgredisClient` first, then wrap it:

```ts
import { createPgredis } from "@postgresx/noredis";
import { createRedisJsAdapter } from "redis";

const pg = createPgredis({ sql });
const redis = createRedisJsAdapter({ client: pg });
```
