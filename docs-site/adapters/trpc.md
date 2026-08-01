# tRPC adapter

```bash
npm install --save-dev @trpc/server
```

```ts
import { initTRPC } from "@trpc/server";
import { generate } from "eco-faker";
import { toTrpcRouter } from "eco-faker/trpc";

const ecoFakerRouter = toTrpcRouter(generate({ seed: 1, scenario: "black-friday" }));
```

One sub-router per table (camelCased), `list`/`byId` procedures, same filter/sort/paginate semantics as [`serve`](/cli/serve).
