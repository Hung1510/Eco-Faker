# Scaffolding

## Framework scaffolding (`init`)

Writes real, runnable files wiring eco-faker into a project you already have.

```bash
my-eco-gen init next
# Wrote scripts/eco-seed.mjs
# Wrote app/api/eco/[table]/route.ts

my-eco-gen init msw
# Wrote mocks/eco-handlers.ts
# Wrote mocks/browser.ts
# Wrote mocks/server.ts

my-eco-gen init prisma --schema ./schema.prisma
# Wrote scripts/eco-seed.mjs
# Wrote prisma/seed.ts
# Wrote mapping.json
```

- **`init next`** — a seed script (writes `eco-data.json`) plus a Next.js App Router route handler serving `GET /api/eco/orders` etc. with `?limit=&offset=` pagination.
- **`init msw`** — MSW handlers (`toMswHandlers`) plus `mocks/browser.ts` (`setupWorker`) and `mocks/server.ts` (`setupServer`), both importing the same handlers. See the [MSW adapter](/adapters/msw) for the underlying API.
- **`init prisma` / `init drizzle` / `init sqlalchemy`** — need `--schema <path>` to introspect (same schema types `init --schema` alone accepts). Each writes the shared seed script plus a real `mapping.json` *and* a real seed script that actually uses that mapping, scoped to the six core relational tables (`users`/`carts`/`abandonedCheckouts`/`orders`/`shipments`/`returnRequests`) in real FK-safe order:
  - **`prisma`** — `prisma/seed.ts`, fully runnable as-is (assuming `@prisma/client` is generated and `DATABASE_URL` is set): one `createMany` per model.
  - **`drizzle`**/**`sqlalchemy`** — a template, not a drop-in script. Connection setup (driver, credentials) varies too much project-to-project to generate blindly, so the `db`/`Session` is left as a clearly-marked `TODO` fill-in. SQLAlchemy's script also shells out to Node to run the seed generator first, since eco-faker has no Python bindings.

`--seed <number>` bakes a seed into the script (default 1); `--force` overwrites existing files. `init next`/`init msw` don't take `--schema` (nothing to introspect); `init prisma`/`init drizzle`/`init sqlalchemy` require it.

::: tip
The MSW scaffold paginates with `?page=&pageSize=` (matching `serve`), not `?limit=&offset=` — an unrecognized param is silently treated as an equality filter rather than erroring.
:::

`init prisma --schema X` is a strict superset of `init --schema X --schema-type prisma` (below) — same parser, same mapping, plus the real seed script. Use `init --schema` alone if you only want the reviewable `mapping.json` and nothing else.

## Schema introspection & auto-mapping (`init --schema`)

```bash
my-eco-gen init --schema ./prisma/schema.prisma --output ./mapping.json          # Prisma
my-eco-gen init --schema ./db/schema.ts --schema-type drizzle -o ./mapping.json # Drizzle
my-eco-gen init --schema ./models.py --schema-type sqlalchemy -o ./mapping.json # SQLAlchemy
my-eco-gen init --schema https://api.example.com/openapi.json -o ./mapping.json # live OpenAPI spec
```

Maps eco-faker's canonical columns onto your real schema/API's field names. `mapping.json` is a plain, human-editable file — review low-confidence entries before trusting them.

```bash
my-eco-gen generate --users 200 --format sql --mapping ./mapping.json --output ./seed.sql
```

For a real seed script that actually uses this mapping, not just the `mapping.json` itself, see `init prisma`/`init drizzle`/`init sqlalchemy` above.

## Related

- [Visual Tools](/guides/visual-tools) — the Schema Mapping Designer, a browser-based front end for this same mapping workflow
- [Adapters](/adapters/) — MSW, tRPC, GraphQL, React Query, Apollo Client
