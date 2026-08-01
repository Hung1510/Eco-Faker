# Quick Start

## As a library

```ts
import { generate, serialize } from "eco-faker";

const dataset = generate({ seed: 42, scaleFactor: 200 });
const sql = serialize(dataset, "sql"); // or "json" / "csv"
```

`dataset` already contains relationally-linked `users`, `carts`, `abandonedCheckouts`, `orders`, `shipments`, `returnRequests`, and more.

## As a CLI

```bash
my-eco-gen generate --users 50 --format sql --output ./seed.sql

my-eco-gen generate \
  --users 100 --format json --output ./data/eco.json --seed 7 \
  --abandonment-rate 0.45 --delay-probability 0.25 --max-delay-days 5
```

Run `my-eco-gen generate --help` for the full flag list — every flag maps 1:1 to [`config.schema.json`](https://github.com/Hung1510/Eco-Faker/blob/main/config.schema.json).

## As a live API

```bash
my-eco-gen serve --users 300 --scenario black-friday --port 4000
curl "http://localhost:4000/api/orders?status=delivered&pageSize=5"
```

See [`serve`](/cli/serve) for the full mock-API reference — pagination, filtering, chaos mode, auth, live feeds.

## Next steps

- [CLI Reference](/cli/) for the full command list
- [Library API](/api/) for programmatic usage
- [Adapters](/adapters/) to wire this into MSW, tRPC, GraphQL, React Query, or Apollo Client — no server required
