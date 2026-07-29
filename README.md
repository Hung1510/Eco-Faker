# eco-faker

[![CI](https://github.com/Hung1510/Eco-Faker/actions/workflows/ci.yml/badge.svg)](https://github.com/Hung1510/Eco-Faker/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/eco-faker.svg)](https://www.npmjs.com/package/eco-faker)
[![npm downloads](https://img.shields.io/npm/dt/eco-faker.svg)](https://www.npmjs.com/package/eco-faker)
[![records/sec](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FHung1510%2FEco-Faker%2Fmain%2Fbenchmark-results.json&query=%24.recordsPerSecond&label=records%2Fsec&color=blue)](./benchmark-results.json)
[![relational integrity](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FHung1510%2FEco-Faker%2Fmain%2Fbenchmark-results.json&query=%24.relationalIntegrityPercent&suffix=%25&label=relational%20integrity&color=brightgreen)](./benchmark-results.json)

Stateful, relationally-consistent fake-data generator for e-commerce apps. Every `Cart`, `Order`, `Shipment`, and `ReturnRequest` is derived from the same underlying state machine, so the dataset reads like a real store's history instead of unrelated fixtures.

```
Users → Carts → (AbandonedCheckouts | Orders → Shipments → ReturnRequests)
```

- **It's a database, not a pile of JSON.** Every order references a real cart, every shipment a real order, every return a real shipment -- financials balance and referential integrity holds by construction. `lint`/`fuzz` exist specifically to break that on purpose so you can test what happens when it doesn't.
- **It's an API, not just a file.** `serve` turns any dataset into a live REST endpoint in one command, with pagination, filtering, chaos testing, auth, and adapters for MSW, tRPC, GraphQL, Apollo Client, and React Query.
- **It tests real systems, not just itself.** `test --contract`/`--mutate` fire real requests at a live API and check it against an OpenAPI contract. `lint --sql --db-url` dry-runs real SQL against a real Postgres. `warp` replays a fixed scenario at a different point in time.

<p align="center">
  <img src="./docs/demo.gif" alt="eco-faker demo: generating a relationally-consistent e-commerce dataset from the CLI" width="800">
  <br>
  <sub><a href="https://hung1510.github.io/Eco-Faker/">Live browser demo</a> (no install) · <a href="https://github.com/Hung1510/Eco-Faker">GitHub</a> · <a href="https://www.npmjs.com/package/eco-faker">npm</a></sub>
</p>

**Try it in 30 seconds:**

```bash
npm install -g eco-faker
my-eco-gen generate --scenario black-friday --users 100 --format sql --output ./seed.sql
```

No Node? No problem:

```bash
docker compose up --build
# Postgres @ localhost:5432 (eco/eco/eco_faker) seeded with a Black Friday dataset
```

## Run it from source: clone, build, test, generate (~2 minutes)

For anyone who'd rather clone the repo and see it work end-to-end than install the published package -- everything below is copy-pasteable, in the order you'd actually run it. No need to read anything past this section just to see what eco-faker does; jump into [Features](#features) whenever you're ready for the rest.

**1. Clone and install:**
```bash
git clone https://github.com/Hung1510/Eco-Faker.git
cd Eco-Faker
npm install
```

**2. Build:**
```bash
npm run build
```

**3. Run the full test suite** -- confirms everything actually works on your machine before you rely on any of it:
```bash
npm test
```

**4. Generate your first dataset:**
```bash
node dist/cli.js generate --users 50 --seed 1 --scenario black-friday --format json --output ./eco-data.json
```
(Once installed globally with `npm install -g eco-faker`, every `node dist/cli.js <command>` below is just `my-eco-gen <command>`.)

**5. Spin up a live mock API against it and hit a real endpoint:**
```bash
node dist/cli.js serve --users 50 --seed 1 --port 4000 &
curl "http://localhost:4000/api/orders?status=delivered&pageSize=5"
```

**6. Run the same full verification pass CI runs, end to end:**
```bash
npx tsc --noEmit -p tsconfig.json   # typecheck
npm test                             # full unit test suite
npm run build                        # compile
npm run smoke-test                   # runs dist/ against every scenario preset, checks referential integrity
```

That's the whole loop: clone -> install -> build -> test -> generate -> serve. Everything from here on is the full feature-by-feature reference -- skim the list below for what interests you, or use `my-eco-gen docs <topic>` (see [CLI docs & shell completion](#cli-docs--shell-completion)) to jump straight to a specific section's docs from the terminal.

## Features

- **Product catalog** -- categories, brands, suppliers, products with variants; every cart/order line item resolves to a real product, reused across many orders
- **Synthetic recommendation data** -- per-user browsing/search/wishlist/review trail (`View → Wishlist → Purchase → Review`), grounded in the rest of the dataset, own decoupled RNG stream
- **Inventory simulation** -- warehouses, replenishment orders, stockout periods, warehouse transfers, tied to real `Supplier.leadTimeDays`
- **Support tickets** -- tickets + threaded conversations grounded in real delayed shipments, returns, low ratings, missing addresses
- **Transactional emails** -- 5 real email types, each grounded in a real timestamp already in the dataset
- **Local email inbox** (`mail`) -- replays generated emails into a local MailDev inbox over real SMTP
- **Temporal scenario engine** (`temporal`) -- one dataset whose config varies over calendar time (baseline → spike → recovery)
- **OpenTelemetry export** (`otel-export`) -- real OTLP/JSON traces, a `checkout` trace per order and `fulfill_shipment` trace per shipment
- **Analytics dashboard** (`dashboard`) -- daily revenue, funnel, retention cohorts, LTV, CAC as CSV/SQL/JSON
- **Benchmark export** (`benchmark-export`) -- real Elasticsearch Bulk NDJSON + mappings, and ClickHouse DDL
- **Great Expectations export** (`ge-export`) -- one real expectation suite per table, every assertion derived from actual observed values, never a hardcoded assumption
- **DB snapshot + anonymization** (`db-snapshot`) -- connects to a real live Postgres database and writes deterministically-pseudonymized real rows to JSON, safe to hand to staging/dev/CI
- **AI dataset export** (`ai-export`) -- Text2SQL pairs, RAG corpus, agent-testing scenarios, LLM eval set
- **Event sourcing mode** (`events`) -- chronologically-ordered event stream across all 18 tables
- **Scenario composer** (`--scenario-file`) -- author your own reusable scenario, inheriting from built-ins or other files
- **Funnel-targeted generation** (`--target-funnel-rate`) -- binary-searches `abandonmentRate` to hit a target conversion rate
- **Data versioning** (`version save` / `list` / `diff` / `branch` / `log`) -- a local named store of dataset recipes, with branch lineage and by-name diffing
- **Framework scaffolding** (`init next` / `init msw` / `init prisma` / `init drizzle` / `init sqlalchemy`) -- writes real files wiring eco-faker into a project you already have, including a real ORM seed script scoped to the six core tables
- **Mock REST API** (`serve`) -- paginated, filterable, json-server-style API, with chaos mode, API-key auth, OpenAPI spec, Postman export, live WebSocket feed, GraphQL mount
- **OpenAPI-examples mocking** (`serve --openapi-examples`) -- an entirely different `serve` mode: serves a real OpenAPI 3.x document's own declared response examples verbatim, no dataset generation
- **Contract testing** (`test --contract`) -- fires real GET requests at a live API and checks status codes + response shapes against an OpenAPI contract
- **Mutation testing** (`test --mutate`) -- fires real POST/PATCH requests at a live API: idempotency, race conditions, invalid status transitions (auto-detected from the contract's own ordered enums), 401/404
- **Scenario testing** (`test --scenario`) -- a strict, ordered, cross-resource sequence of real requests (cart → checkout → ship → illegal cancel → return), threading real captured ids between steps, asserting the actual business-logic outcome at each stage
- **BDD / Gherkin testing** (`test --gherkin`) -- the same scenario engine, authored in real `.feature` syntax; a fixed step vocabulary, not a general-purpose Cucumber runner
- **MSW / tRPC / GraphQL / React Query / Apollo Client adapters** -- same dataset, same filter/sort/paginate semantics, no server required
- **MCP server** (`mcp`) -- generate/query/fuzz/lint/visualize as tools any MCP client can call directly
- **Semantic fuzzing** (`fuzz`) -- schema-valid but logically-impossible mutations, finding bugs schema validation can't catch
- **Data quality / realism score** (`score`) -- composite 0-100 score across referential integrity, financial/temporal consistency, uniqueness, and order-value distribution shape
- **Pre-flight lint** (`lint`) -- referential/financial/temporal consistency checks, offline or against a real Postgres dry run
- **Webhook event simulator** (`webhook`) -- paced, chronological stream of events POSTed to a URL
- **Dataset diffing** (`diff`) -- row-count deltas, schema drift, status-distribution shifts between two datasets
- **Time-travel debug/regression** (`replay` / `warp`) -- exact or time-shifted reproduction from a snapshot
- **Multi-store mode** (`--stores N`) -- N independent, distinctly-seeded stores in one call
- **Interactive playground / relationship explorer / journey timeline** -- visual, browser-based views over a real dataset
- **Anomaly injection & fraud simulation** -- rare, high-value edge cases and fraud risk signals
- **Schema introspection** (`init --schema`) -- maps onto an existing Prisma/Drizzle/SQLAlchemy/OpenAPI schema
- **High-volume stream mode** (`--stream`) -- NDJSON straight to stdout, flat memory regardless of scale
- **VS Code extension** -- generate a dataset, browse it in a webview table viewer, or scaffold a Next.js/MSW integration from the Command Palette, no terminal needed (`vscode-extension/`)
- **CLI docs & shell completion** (`docs` / `completion`) -- opens the relevant README section in your browser; generates real bash/zsh/fish completion scripts derived from the live command list
- **Dev container** (`.devcontainer/`) -- Node 22 + pre-seeded Postgres, zero-setup "Reopen in Container"
- **73 locales** (`locales`) -- every real locale @faker-js/faker ships, derived dynamically from the installed dependency rather than a hand-maintained list
- **Guaranteed-unique values** (`createUniqueTracker`) -- the same collision-prevention guarantee faker-js/faker-ruby's own `.unique` provide, explicitly scoped rather than a hidden global registry; applied internally to user emails
- **Three output formats** -- JSON, SQL, CSV; deterministic given the same seed + reference time

## Install

```bash
npm install -g eco-faker      # CLI
my-eco-gen --help
```

```bash
npm install eco-faker         # as a library
```

```bash
git clone https://github.com/Hung1510/Eco-Faker.git   # from source (contributing, web playground, static demo)
cd eco-faker && npm install && npm run build
```

## Quick start

```ts
import { generate, serialize } from "eco-faker";

const dataset = generate({ seed: 42, scaleFactor: 200 });
const sql = serialize(dataset, "sql"); // or "json" / "csv"
```

`dataset` already contains relationally-linked `users`, `carts`, `abandonedCheckouts`, `orders`, `shipments`, `returnRequests`, and more.

## Framework scaffolding (`init next` / `init msw` / `init prisma` / `init drizzle` / `init sqlalchemy`)

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

- **`init next`** -- a seed script (writes `eco-data.json`) plus a Next.js App Router route handler serving `GET /api/eco/orders` etc. with `?limit=&offset=` pagination.
- **`init msw`** -- MSW handlers (`toMswHandlers`) plus `mocks/browser.ts` (`setupWorker`) and `mocks/server.ts` (`setupServer`), both importing the same handlers.
- **`init prisma` / `init drizzle` / `init sqlalchemy`** -- need `--schema <path>` to introspect (same schema types `init --schema` alone accepts). Each writes the shared seed script plus a real `mapping.json` (identical to what `init --schema` alone produces -- review it before trusting it) *and* a real seed script that actually uses that mapping, scoped to the six core relational tables (`users`/`carts`/`abandonedCheckouts`/`orders`/`shipments`/`returnRequests`) in real FK-safe order:
  - **`prisma`** -- `prisma/seed.ts`, fully runnable as-is (assuming `@prisma/client` is generated and `DATABASE_URL` is set): one `createMany` per model.
  - **`drizzle`**/**`sqlalchemy`** -- a template, not a drop-in script. Connection setup (driver, credentials) varies too much project-to-project to generate blindly, so the `db`/`Session` is left as a clearly-marked `TODO` fill-in. SQLAlchemy's script also shells out to Node to run the seed generator first, since eco-faker has no Python bindings.

`--seed <number>` bakes a seed into the script (default 1); `--force` overwrites existing files. `init next`/`init msw` don't take `--schema` (nothing to introspect); `init prisma`/`init drizzle`/`init sqlalchemy` require it.

Note: the MSW scaffold paginates with `?page=&pageSize=` (matching `serve`), not `?limit=&offset=` -- an unrecognized param is silently treated as an equality filter rather than erroring.

`init prisma --schema X` is a strict superset of `init --schema X --schema-type prisma` (below) -- same parser, same mapping, plus the real seed script. Use `init --schema` alone if you only want the reviewable `mapping.json` and nothing else.

## CLI

```bash
my-eco-gen generate --users 50 --format sql --output ./seed.sql

my-eco-gen generate \
  --users 100 --format json --output ./data/eco.json --seed 7 \
  --abandonment-rate 0.45 --delay-probability 0.25 --max-delay-days 5
```

`my-eco-gen generate --help` for the full flag list -- every flag maps 1:1 to `config.schema.json`.

## Product catalog

```bash
my-eco-gen generate --users 300 --catalog-size 200
```

A 2-level category tree, brands, suppliers, and products with variants (`storage`, `color`, own `sku`/`priceDelta`/`stockLevel`). `LineItem.productId` on every cart/order/shipment resolves to a real product. Available through `serve`, all adapters, SQL/CSV output, and `init --schema`. `--catalog-size` controls product count (default 150).

## Synthetic recommendation data

```
User -> View Product -> Add Wishlist -> Purchase -> Review
```

```bash
my-eco-gen generate --users 300
my-eco-gen generate --users 300 --no-recommendation-data   # disable
```

Four tables (`productViews`, `searchQueries`, `wishlistItems`, `productRatings`), grounded in the rest of the dataset -- every purchased product was viewed beforehand, ratings only exist on delivered orders, wishlist items never predate a purchase. Runs on its own decoupled RNG stream, so toggling it changes nothing else.

## Inventory simulation

```bash
my-eco-gen generate --users 300
my-eco-gen generate --users 300 --no-inventory-simulation   # disable
```

Warehouses, replenishment orders (`expectedDeliveryAt = orderedAt + supplier.leadTimeDays`), stockout periods, warehouse transfers. Low-stock products are meaningfully more likely to have a recent stockout/replenishment history. Own decoupled RNG stream.

## Support tickets

```bash
my-eco-gen generate --users 300
my-eco-gen generate --users 300 --no-support-tickets   # disable
```

Tickets + full threaded conversations, each grounded in a real signal: a delayed shipment, a return, a low product rating, a missing address, or (only when recommendation data exists) a viewed-but-unpurchased product. A small share are ungrounded generic questions.

## Transactional emails

```bash
my-eco-gen generate --users 300
my-eco-gen generate --users 300 --no-email-messages   # disable
```

Five email types (order confirmation, shipping/delivery notification, return confirmation, cart-abandonment recovery), each grounded in a real timestamp elsewhere in the dataset. Also: varied, product-name-interpolated review text (`productRatings[].reviewText`).

## Local email inbox (`mail`)

```bash
my-eco-gen mail --users 300
# Inbox running at http://127.0.0.1:1080
```

Starts a local [MailDev](https://github.com/maildev/maildev) SMTP + web inbox and replays every generated email into it via real SMTP, chronologically, paced like `webhook` (`--speed`, `--max-wait-ms`, `--limit`).

```bash
my-eco-gen mail --users 300 --email-types order_confirmation,shipping_notification
my-eco-gen mail --users 300 --smtp-port 1035 --web-port 1090 --no-open
```

## Analytics dashboard (`dashboard`)

```bash
my-eco-gen generate --users 500 --output ./eco-data.json
my-eco-gen dashboard --input ./eco-data.json --format csv --output ./dashboard/
```

Daily revenue, conversion funnel, retention cohorts, customer LTV, and a CAC estimate (`--marketing-spend`, default $5000).

```bash
my-eco-gen dashboard --input ./eco-data.json --format csv    # daily_revenue.csv, funnel.csv, retention_cohorts.csv, customer_ltv.csv, summary.csv
my-eco-gen dashboard --input ./eco-data.json --format sql    # one .sql file, load into Postgres for Metabase/Superset
my-eco-gen dashboard --input ./eco-data.json --format json
```

Also an MCP tool (`compute_analytics`).

## Benchmark export (`benchmark-export`)

```bash
my-eco-gen generate --users 500 --output ./eco-data.json
my-eco-gen benchmark-export --input ./eco-data.json --target elasticsearch --output ./es-export/
my-eco-gen benchmark-export --input ./eco-data.json --target clickhouse --output ./ch-export/
```

`elasticsearch` writes real Bulk API NDJSON + inferred index mappings per table. `clickhouse` writes real DDL (`ENGINE = MergeTree()`); the data payload reuses the existing CSV output. Postgres isn't a target here -- `generate --format sql`/`csv` already cover it.

## Great Expectations export (`ge-export`)

```bash
my-eco-gen generate --users 500 --output ./eco-data.json
my-eco-gen ge-export --input ./eco-data.json --output ./ge-export/
cp ./ge-export/orders.json great_expectations/expectations/orders.json
```

Writes one real [Great Expectations](https://greatexpectations.io/) expectation suite per table, every expectation derived from this exact dataset's actual generated values -- column existence and order from the real columns present, not-null only where every real row genuinely has one, uniqueness only for non-float columns where it's actually true (a money/measurement value being unique in a small sample is chance, not a business rule -- `total`/`subtotal`/etc. never get it even when they happen to qualify), inferred type, numeric range from the real observed min/max, and an enum-style `value_set` for string columns with few enough distinct values relative to row count. This is a starting baseline meant to be reviewed and loosened -- the same role GE's own built-in profilers already play -- not a finished production suite; `expect_table_row_count_to_be_between` in particular pins the exact row count of this one export and will need widening for anything but revalidating this same data.

## Data quality / realism score (`score`)

```bash
my-eco-gen generate --users 500 --output ./eco-data.json
my-eco-gen score --input ./eco-data.json
```

```
Realism score: 87/100

  referential_integrity     100/100  (0 orphaned FKs, 0 duplicate ids)
  financial_consistency      98/100  (3/1240 orders off by >$0.01)
  temporal_plausibility     100/100  (0 out-of-order timestamps)
  distribution_shape         71/100  (order-value distribution: real-world e-commerce
                                       order values roughly follow a log-normal/power-law
                                       shape -- long right tail, few large orders; this
                                       dataset's tail is thinner than expected)
  uniqueness                 92/100  (12/500 emails collide)

my-eco-gen score --input ./eco-data.json --format json   # machine-readable, for CI gating
```

A composite 0-100 realism score across five dimensions, so you can objectively compare two datasets (before/after a config change, or two competing seeds) instead of eyeballing them. `referential_integrity`/`financial_consistency`/`temporal_plausibility`/`uniqueness` reuse `lint`'s own checks directly -- same rules, now expressed as a score contribution instead of a pass/fail. `distribution_shape` is new: checks whether `orders.total` and cart item-count roughly follow the right-skewed shape real order-value distributions have (a handful of large orders, many small ones) via a skewness statistic, rather than looking suspiciously uniform or normal.

Each dimension's score and *why* is printed, not just a bare number -- a `score` that can't explain itself isn't more useful than eyeballing the data yourself. `--format json` for CI: fail a build if `score.overall < 80`, or track it over time as config changes.

Also available as an MCP tool (`score_dataset`) and a `computeRealismScore(dataset)` library export.

## Scenario presets

```bash
my-eco-gen scenarios   # list all presets

my-eco-gen generate --scenario black-friday --format sql --output ./black-friday.sql
```

| Scenario | Story |
|---|---|
| `black-friday` | Traffic spike, overwhelmed checkout |
| `post-holiday-returns` | Weeks after peak season, carrier backlog |
| `flash-sale` | Short, intense burst, stock races out |
| `supply-chain-crisis` | Logistics network under strain |
| `steady-state` | Ordinary day-to-day traffic |

Explicit flags win over the scenario (`--scenario black-friday --users 50` keeps Black Friday's tuning but only 50 users).

```ts
import { generate, SCENARIOS, resolveScenario, mergeOverrides } from "eco-faker";
const dataset = generate(mergeOverrides(resolveScenario("black-friday"), { scaleFactor: 500 }));
```

## Scenario composer (`--scenario-file`)

```yaml
# my-holiday-crunch.yaml
name: my-holiday-crunch
inherits:
  - black-friday
  - ./base-tuning.yaml
overrides:
  scaleFactor: 250
  seed: 42
```

```bash
my-eco-gen generate --scenario-file ./my-holiday-crunch.yaml --output ./eco-data.json
my-eco-gen scenario resolve ./my-holiday-crunch.yaml   # debug/author without generating
```

Most-specific-wins precedence: own `overrides` > later `inherits` entries > earlier ones > explicit CLI flags win over all of it. Circular inheritance is detected and reported with the full chain. Also an MCP tool (`resolve_scenario_file`).

## Funnel-targeted generation (`--target-funnel-rate`)

```bash
my-eco-gen generate --users 500 --target-funnel-rate 0.3
# Hit 30.4% (target 30.0%) at abandonmentRate=0.7188, 5 attempt(s).
```

Binary-searches `abandonmentRate` until the dataset's own view→purchase conversion rate lands within `--target-funnel-tolerance` (default 0.02) of the target. If unreachable at the given scale/seed, reports the closest rate found rather than silently missing.

## Temporal scenario engine (`temporal`)

```bash
my-eco-gen temporal --profile holiday-arc --seed 1 --output ./holiday-arc.json
```

One dataset whose config varies over calendar time -- three built-in profiles (`holiday-arc`, `supply-chain-decline`, `flash-sale-week`), or author your own:

```yaml
# my-arc.yaml
name: my-arc
segments:
  - fromDaysAgo: 30
    toDaysAgo: 7
    label: quiet
    scenario: steady-state
  - fromDaysAgo: 7
    toDaysAgo: 0
    label: busy
    overrides:
      scaleFactor: 300
```

```bash
my-eco-gen temporal --profile ./my-arc.yaml --output ./eco-data.json
```

Segments must be contiguous and the last must end at `toDaysAgo: 0`. Implemented as N merged `generate()` calls, not a core-loop change -- each segment gets its own independent user pool and catalog (no cross-segment returning customers). Also an MCP tool (`generate_temporal_dataset`).

## OpenTelemetry export (`otel-export`)

```bash
my-eco-gen generate --users 200 --output ./eco-data.json
my-eco-gen otel-export --input ./eco-data.json --output ./traces.json
```

Real OTLP/JSON traces: a `checkout` trace per order (spanning `checkout-service`/`payment-service`), a `fulfill_shipment` trace per shipment with spans matching its real tracking-event timeline. `--seed <n>` for reproducible span/trace IDs. Also an MCP tool (`generate_otel_traces`, counts + sample only -- use the CLI for the full export).

## Mock REST API ("json-server for e-commerce")

```bash
my-eco-gen serve --users 300 --scenario black-friday --port 4000
```

```
GET  /                                             endpoint list + row counts
GET  /api/orders?status=delivered&page=2&pageSize=25
GET  /api/orders?sort=total&order=desc
GET  /api/users | /api/carts | /api/abandoned-checkouts | /api/orders | /api/shipments | /api/returns
GET  /openapi.json                                 OpenAPI 3.0 spec
```

Any query param other than `page`/`pageSize`/`sort`/`order` is an exact-match filter.

**Request logging** -- plain-English status meanings on every line and as an `X-Eco-Faker-Meaning` response header; `--quiet` disables the console line.

**Chaos mode:**
```bash
my-eco-gen serve --users 300 --chaos --chaos-error-rate 0.2 --chaos-rate-limit-rate 0.1 --chaos-latency-rate 0.3
```
Simulated 429s/500s/latency spikes on `/api/*` (defaults: 0.05/0.05/0.2); `/` and `/openapi.json` are never affected.

**API-key auth:**
```bash
my-eco-gen serve --users 300 --api-key my-secret-key
```

**Live WebSocket feed:** `--live --live-interval-ms 500` opens `ws://localhost:4000/live`.

**Live feed over plain HTTP:** `--live-sse` opens `GET /live/sse` (Server-Sent Events) broadcasting the exact same event feed -- for anything that can't do a WebSocket upgrade (`curl -N http://localhost:4000/live/sse`, a browser's built-in `EventSource`, a restrictive proxy/gateway that blocks WS but passes through a long-lived HTTP response fine). Each connecting client gets its own independent cursor, unlike the WebSocket feed's single shared broadcast loop.

**Postman export:** `--postman [--postman-output <path>]` writes a v2.1 collection and serves it at `GET /postman.json`.

## OpenAPI-examples mocking (`serve --openapi-examples`)

```bash
my-eco-gen serve --openapi-examples ./my-api-spec.yaml --port 4000
```

An entirely different mode of `serve`: instead of generating a fake e-commerce dataset, this reads a real OpenAPI 3.x document (local `.json`/`.yaml`/`.yml`, or a live `http(s)://` URL) and serves *its own declared response examples* verbatim -- for mocking an API you're designing or consuming, using example payloads you (or its authors) already wrote in the spec. Every dataset-shaping option (`--users`, `--seed`, `--scenario`, ...) is ignored in this mode; `--port`/`--chaos`/`--api-key`/`--quiet` still apply.

For each declared path+method, exactly one example is resolved, in priority order: a response's `example` -> the first (alphabetically) entry of its `examples` map -> its `schema.example`. A path+method declared in the spec with none of the three gets a real `501` saying so -- never a fabricated response. Anything not declared in the spec at all gets a `404`. This is a stateless, single-happy-path mock, not a request-aware state machine -- it can't tell "the 200 case" from "the 404 case" for the same operation from the request alone, so it always serves the lowest declared `2xx` (falling back to `default`) regardless of what you send it.

## MSW (Mock Service Worker) adapter

```bash
npm install --save-dev msw
```

```ts
import { setupServer } from "msw/node";
import { generate } from "eco-faker";
import { toMswHandlers } from "eco-faker/msw";

const dataset = generate({ seed: 1, scenario: "black-friday" });
const server = setupServer(...toMswHandlers(dataset));
```

Same routes, same query semantics, same `X-Eco-Faker-Meaning` header as `serve`. `toMswHandlers(dataset, { basePath: "/mock-api" })` for a custom mount point.

## MCP server

```bash
my-eco-gen mcp
```

Runs eco-faker as an [MCP](https://modelcontextprotocol.io) server over stdio, exposing these tools:

| Tool | What it does |
|---|---|
| `generate_dataset` | Generate a dataset -- returns a `datasetId`, counts, a 3-row sample |
| `generate_temporal_dataset` | Generate a dataset whose config varies over calendar time |
| `generate_otel_traces` | OTLP/JSON traces for a dataset -- counts + sample |
| `generate_ai_dataset` | Text2SQL/RAG/agent-scenarios/eval-set for a dataset |
| `score_dataset` | Composite realism score for a dataset |
| `query_table` | Filter/sort/paginate one table |
| `fuzz_dataset` | Semantic fuzzing -- returns a new `datasetId` |
| `fraud_simulate` | Fraud risk tagging -- returns a new `datasetId` |
| `compute_analytics` | Revenue/funnel/cohorts/LTV/CAC |
| `build_event_stream` | Chronological event stream |
| `resolve_scenario_file` | Resolves a scenario file's inherits chain |
| `lint_dataset` | Offline data-quality check |
| `visualize_journey` | Writes a customer-journey HTML timeline |
| `list_scenarios` | Lists scenario presets |

Datasets are kept server-side (in-memory, 20 most recent) and referenced by `datasetId` across calls.

```json
{
  "mcpServers": {
    "eco-faker": { "command": "npx", "args": ["-y", "eco-faker", "mcp"] }
  }
}
```

## tRPC adapter

```bash
npm install --save-dev @trpc/server
```

```ts
import { initTRPC } from "@trpc/server";
import { generate } from "eco-faker";
import { toTrpcRouter } from "eco-faker/trpc";

const ecoFakerRouter = toTrpcRouter(generate({ seed: 1, scenario: "black-friday" }));
```

One sub-router per table (camelCased), `list`/`byId` procedures, same filter/sort/paginate semantics as `serve`.

## GraphQL adapter

```bash
npm install --save-dev graphql
```

```ts
import { generate } from "eco-faker";
import { toGraphQLSchema } from "eco-faker/graphql";

const { schema, typeDefs } = toGraphQLSchema(generate({ seed: 1 }));
```

One `<table>(filters, sort, order, page, pageSize)` + `<table>ById(id)` field per table, plus `info`. Records/filters use a `JSON` scalar. `serve --graphql` mounts this same schema at `POST /graphql`.

## React Query adapter

```bash
npm install --save-dev @tanstack/react-query react
```

```ts
import { createEcoFakerQueryHooks } from "eco-faker/react-query";
const hooks = createEcoFakerQueryHooks({ baseUrl: "http://localhost:4000/api" });
// hooks.orders.useList(...), hooks.orders.useById(id)
```

## Apollo Client adapter

```bash
npm install --save-dev @apollo/client rxjs
```

```ts
import { createEcoFakerApolloClient } from "eco-faker/apollo";
const client = createEcoFakerApolloClient(generate({ seed: 1 }));
```

Wraps the GraphQL schema in Apollo's own `SchemaLink` (the documented SSR/mocking pattern) -- no server, no network hop. No Relay adapter (Relay expects `relay-compiler`-generated artifacts, not raw documents).

## Webhook event simulator

```bash
my-eco-gen webhook --url http://localhost:3000/webhooks --scenario post-holiday-returns --speed 3600
my-eco-gen webhook --url https://example.com/hook --events order.created,shipment.delivered --limit 50 --dry-run
```

`--speed 3600` = 1 simulated hour per real second. `--max-wait-ms` caps the real-world wait between events. `--dry-run` previews the timeline instead of POSTing.

## Event sourcing mode (`events`)

```bash
my-eco-gen generate --users 300 --output ./eco-data.json
my-eco-gen events --input ./eco-data.json --output ./events.ndjson
```

Chronologically-ordered event stream across all 18 tables, every event carrying `aggregateId`/`aggregateType`. `--event-types`, `--format json`. Also an MCP tool (`build_event_stream`).

## Dataset diffing

```bash
my-eco-gen diff ./before.json ./after.json
my-eco-gen diff ./bug-42.snapshot.json ./bug-43.snapshot.json --fail-on-schema-change   # for CI
```

Row-count deltas, schema drift, and status-distribution shifts between two datasets or snapshots.

## Semantic fuzzing (`fuzz`)

```bash
my-eco-gen fuzz --users 300 --scenario black-friday --intensity extreme --output ./eco-data.fuzzed.json
```

Four mutation types, each schema-valid but logically impossible: `address_mismatch`, `price_inversion` (no total recompute), `time_paradox` (return before order), `inventory_oversell`.

```bash
my-eco-gen fuzz --types price_inversion,time_paradox --intensity extreme --fuzz-seed 42
my-eco-gen fuzz --input ./eco-data.json --report ./mutations.json
```

Pair with `lint` to see the mutations get caught. For firing mutated payloads at a *live* API, see `test --contract`/`--mutate` below.

## Pre-flight lint (`lint`)

```bash
my-eco-gen lint --users 300 --scenario black-friday
```

Checks orphaned FKs, duplicate ids/emails, financial mismatches (`lineTotal`, order `total`), and temporal ordering (returns before their order). Exits `1` on any error.

```bash
my-eco-gen lint --sql ./seed.sql --db-url postgres://user:pass@localhost:5432/staging   # real Postgres BEGIN/ROLLBACK dry run, requires `pg`
```

## Contract testing (`test --contract`)

```bash
my-eco-gen openapi-export --users 200 --output ./contract.json
my-eco-gen test --url https://api.example.com --contract ./contract.json
```

Fires real GET requests at a live API and asserts status codes + response schemas against an OpenAPI 3.0 contract. Read-path only -- byId ids are harvested from real list responses. `--header "Authorization: Bearer ..."` (repeatable).

### Mutation testing (`test --mutate`)

```bash
my-eco-gen generate --users 300 --output ./eco-data.json
my-eco-gen test --url https://api.example.com --contract ./your-openapi.json --mutate --seed ./eco-data.json
```

Five checks: `not_found`, `unauthorized`, `duplicate_submission`, `race_condition`, `invalid_transition`. The last is fully automatic -- any schema with an ordered status `enum` gets a real backward-transition attempt, no config needed. `duplicate_submission`/`race_condition` need `--seed <dataset.json>` to build real POST bodies; `--concurrency`, `--idempotency-header` tune the race check. Every check here is a single mutating request against a single resource -- for a real cross-resource, multi-step workflow, see `--scenario` below.

### Scenario testing (`test --scenario`)

The cross-resource half `--mutate` doesn't cover: a strict, ordered sequence of real requests across multiple resources, with real ids captured from each response threaded into the next step -- and the actual business-logic outcome checked at every stage, not just the last request's HTTP code.

```bash
my-eco-gen generate --users 300 --output ./eco-data.json
my-eco-gen test --url https://api.example.com --contract ./your-openapi.json \
  --scenario ./examples/scenarios/full-lifecycle.yaml --seed ./eco-data.json
# ok:   createCart (POST /carts) -> 201
# ok:   checkout (POST /carts/26d26082.../checkout) -> 201
# ok:   ship (POST /orders/f64639df.../ship) -> 200
# ok:   illegalCancel (POST /orders/f64639df.../cancel) -> 409
# ok:   requestReturn (POST /orders/f64639df.../return) -> 200
#
# 5 passed, 0 failed (--scenario).
```

A scenario file (YAML or JSON, see [`examples/scenarios/full-lifecycle.yaml`](./examples/scenarios/full-lifecycle.yaml)) is a `name` plus an ordered `steps` list. Each step:

- `method`/`path` -- `path` can reference `{{stepName.field}}` (a value an earlier step captured) or `{{seed.field}}` (a real value from the dataset passed via `--seed`, e.g. `{{seed.users.0.id}}` for a real user id).
- `body` -- same placeholder substitution, at any depth.
- `expectStatus` -- accepted status code(s). A step that's *supposed* to be rejected (cancelling a shipped order, say) declares its real expected rejection code here -- that's a pass, not a failure.
- `expectBody` -- shallow dot-path field checks against the real response body. This is the actual business-logic assertion: a step can return the "right" status with the wrong resulting state, and `expectStatus` alone would miss that.
- `capture` -- `{ localName: "dot.path.into.response" }`, available to later steps as `{{stepName.localName}}`.

The scenario stops at the first failed step -- a later step referencing a value the failed step should have produced has nothing real to inject, so continuing wouldn't test anything meaningful. An unresolved placeholder (a typo'd step name, a reference to a step that never ran) is reported as its own specific failure, not silently left as a literal `{{...}}` in the request or swallowed into a confusing downstream 404.

Deliberately doesn't also validate each step's response against the OpenAPI contract's declared schema the way `test --contract`'s read-path checks do -- mapping a resolved request path with real ids substituted in back to the contract's own templated path is real work on its own, and `expectStatus`/`expectBody` already cover the actual point of this feature (the business-logic outcome at each stage). A stated future enhancement, not attempted this round.

### BDD / Gherkin testing (`test --gherkin`)

The same scenario engine above, authored in real `.feature` (Gherkin) syntax instead of YAML/JSON:

```gherkin
Feature: Order lifecycle

  Scenario: Fetch a real order
    Given I GET "/api/orders?pageSize=1" and call it "listOrders"
    Then the response status should be 200
    And I capture "data.0.id" as "firstOrderId"

  Scenario: A nonexistent order returns 404
    When I GET "/api/orders/does-not-exist" and call it "fetchMissing"
    Then the response status should be 404
```

```bash
my-eco-gen test --url https://api.example.com --contract ./your-openapi.json --gherkin ./order-lifecycle.feature
```

A `.feature` file translates directly into the same `Scenario`/`ScenarioStep` shape `--scenario` runs -- every step actually fires a real request and is really asserted, not just parsed. Multiple `Scenario:` blocks in one file each run independently. `{{seed.*}}`/`{{stepName.field}}` placeholders work identically to `--scenario`, including with `--seed <dataset.json>`.

This is a small, **fixed step vocabulary** -- not a general-purpose Gherkin runner with user-registrable step definitions the way real Cucumber/cucumber-js works (that's arbitrary custom code per step, a fundamentally different and much bigger feature):

- `I <GET|POST|PUT|PATCH|DELETE> "<path>" [with body <json>] [and call it "<name>"]`
- `the response status should be <code>`
- `the response field "<dot.path>" should be <json-value>` -- the value is parsed as real JSON, so strings need their own quotes (`should be "delivered"`), numbers/booleans/null don't (`should be 129.99`, `should be true`)
- `I capture "<dot.path>" as "<localName>"`

`Given`/`When`/`Then`/`And`/`But` are all treated identically -- only the step *text* is matched. Not supported in this first slice, with a clear parse error (not a silent misparse) if encountered: tags (`@smoke`), `Background:` (repeat shared setup in each `Scenario:` instead), `Scenario Outline:`/`Examples:` (write out each case as its own plain `Scenario:` instead), and data tables/doc strings.

## Multi-store / multi-tenant mode

```bash
my-eco-gen generate --stores 5 --users 200 --format json --output ./marketplace.json
```

N independent, distinctly-seeded stores. JSON output only for now.

## Interactive visual playground

```bash
npm run build && npm run web
# open http://localhost:4173
```

Live sliders + Chart.js charts (cart status, shipment status, revenue), an RFM cohort panel, and a side-by-side scenario comparison, backed by a small Express API wrapping real `generate()`.

## Customer journey timeline (`visualize`)

```bash
my-eco-gen visualize --users 300 --scenario black-friday --output ./journey.html
```

One customer's whole lifecycle as a self-contained, animated D3 timeline (works offline, no CDN). Without `--user`, picks whichever user has the richest journey.

```bash
my-eco-gen visualize --input ./eco-data.json --user <userId> --output ./journey.html
```

## Static browser demo

```bash
npm run build:static
# open web-static/index.html
```

The same generator bundled client-side with esbuild -- no server. `.github/workflows/pages.yml` deploys this to GitHub Pages on every push touching `web-static/` or `src/`.

## Interactive relationship explorer

```bash
npm run build:static
# open web-static/explorer.html
```

Miller-columns drill-down (User → Orders → Shipment/Returns), entirely client-side, same architecture as the playground above.

## Anomaly injection

`config.anomalies` injects realistic, rare edge cases:

| Anomaly | Trigger | What it does |
|---|---|---|
| Bot activity | `botCartRate` (0.02) | Cart gets 50-120 line items, 2-4am timestamp |
| Remote-shipping surcharge | `remoteShippingRate` (0.05) | Real `$24.99` freight surcharge added to shipping/total |
| Contradictory review | `contradictoryReturnRate` (0.01) | Negative-reason return with a perfect `csatScore: 5` |

Tagged, not hidden -- check `record.anomaly?.type`/`.note`.

```bash
my-eco-gen generate --users 500 --bot-cart-rate 0.05 --no-anomalies
```

## Fraud simulation engine

```bash
my-eco-gen generate --users 500 --fraud-rate 0.03
```

Six fraud types with a `riskScore` (0-100) and evidence `signals`: `account_farming`, `reseller_behavior`, `refund_abuse`, `friendly_chargeback`, `stolen_card`, `coupon_abuse_ring`. `--fraud-types`, `--fraud-seed`. JSON-only metadata (not in SQL/CSV). Also an MCP tool (`fraud_simulate`).

## Schema introspection & auto-mapping (`init --schema`)

```bash
my-eco-gen init --schema ./prisma/schema.prisma --output ./mapping.json          # Prisma
my-eco-gen init --schema ./db/schema.ts --schema-type drizzle -o ./mapping.json # Drizzle
my-eco-gen init --schema ./models.py --schema-type sqlalchemy -o ./mapping.json # SQLAlchemy
my-eco-gen init --schema https://api.example.com/openapi.json -o ./mapping.json # live OpenAPI spec
```

Maps eco-faker's canonical columns onto your real schema/API's field names. `mapping.json` is a plain, human-editable file -- review low-confidence entries before trusting them.

```bash
my-eco-gen generate --users 200 --format sql --mapping ./mapping.json --output ./seed.sql
```

(For a real seed script that actually uses this mapping, not just the mapping.json itself -- see `init prisma`/`init drizzle`/`init sqlalchemy` in Framework scaffolding above. For `init next`/`init msw` instead, same section.)

## High-volume stream mode

```bash
my-eco-gen generate --users 100000 --stream > eco.ndjson
```

One NDJSON line per record as it's produced, honoring stdout backpressure -- no dataset ever fully materialized.

```ts
import { generateRecords } from "eco-faker";
for (const { table, record } of generateRecords({ scaleFactor: 100000 })) { /* ... */ }
```

## Time-travel debug mode (snapshots)

```bash
my-eco-gen generate --users 100 --seed 42 --format json --output ./run1.json --snapshot ./bug-42.snapshot.json
my-eco-gen replay --input ./bug-42.snapshot.json --format json --output ./replay.json
```

A snapshot stores just the recipe (`seed`, config, `referenceNow`), not the dataset -- `replay` reproduces it byte-identically.

## Time-travel regression (`warp`)

```bash
my-eco-gen warp --snapshot ./bug-42.snapshot.json --days +30 --diff
```

Reproduces a snapshot with every timestamp shifted by N days, everything else identical -- for testing time-relative logic (overdue checks, SLA windows) against a fixed scenario at a different point in wall-clock time. `--diff` reuses the `diff` engine to compare original vs. warped.

## Data versioning (`version save` / `list` / `diff` / `branch` / `log`)

```bash
my-eco-gen version save baseline --users 200 --seed 1 --message "before the promo"
my-eco-gen version branch baseline promo-test --users 200 --seed 1 --abandonment-rate 0.2 --message "lower abandonment during promo"
my-eco-gen version diff baseline promo-test
my-eco-gen version log promo-test
my-eco-gen version list
```

A local, named store of dataset *recipes* (`.eco-faker/versions/<name>.json` -- same `config` + `referenceNow` shape as `generate --snapshot`, not the generated data itself), so you can save a run under a memorable name instead of a file path, branch a new named version from an existing one (explicit flags override the parent's values, same precedence as everywhere else), diff any two by name, and trace a version's full lineage back to its root. `--dir` points any of these at a different store location; default is `.eco-faker/versions` in the current directory.

## Docker: seed a real Postgres database

```bash
docker compose up --build
psql -h localhost -U eco -d eco_faker -c "select status, count(*) from orders group by status;"
```

Brings up `postgres` (real Postgres 16) and `seed` (builds the CLI, generates a `black-friday` dataset, loads it via `psql`, exits). Edit `docker-compose.yml`'s `seed.command` to change scenario/users/format.

## DB snapshot + anonymization (`db-snapshot`)

```bash
npm install pg   # optional dependency, same as lint --sql --db-url
my-eco-gen db-snapshot --db-url "postgresql://user:pass@host:5432/proddb" --output ./snapshot/
my-eco-gen db-snapshot --db-url "..." --tables users,orders --exclude-anonymize "products.name" --output ./snapshot/
```

Connects to a REAL live Postgres database, read-only (`SELECT` only, no writes -- nothing here can mutate anything), and writes real rows to JSON, one file per table, with PII-shaped columns (email, phone, SSN, first/last/full name, address, date of birth, credit card, generic secrets like passwords/API keys) deterministically pseudonymized by column-*name* heuristic. The same real value always maps to the same fake replacement (the fake is derived from a SHA-256 hash of the real value, never stored reversibly), so repeated real values -- the same customer's email showing up in multiple tables -- stay consistent with each other in the output.

Stated plainly, because it's a real, demonstrated limitation, not a hypothetical one: this is a column-*name* heuristic, not content inspection. A column literally named `name` holding a product name -- not a person's -- genuinely gets anonymized into a fake person's name by default (confirmed against a real database during this feature's own development). `--exclude-anonymize table.column` is the escape hatch for exactly that; `--anonymize table.column` is the reverse, forcing anonymization on a real PII column the heuristic misses (a company-specific field like `slack_handle`, say). Review both before trusting the auto-detection on your own schema.

Also stated plainly: `--row-limit` (default 1000 per table) reads whichever rows Postgres happens to return first with no `ORDER BY` -- not a representative sample, and not guaranteed to keep cross-table foreign keys intact if a referenced row falls outside another table's own limit. Fine for a small database; raise the limit (or drop it per-table) for a large one.

## Dev container (`.devcontainer/`)

Open in VS Code (or any [Dev Containers](https://containers.dev)-compatible tool), "Reopen in Container" -- Node 22, git, `psql`, and a real, pre-seeded Postgres. First creation runs `npm install`, `npm run build`, and a one-time seed guarded by a row-count check (so rebuilding the `app` container doesn't re-insert into already-seeded data). Self-contained, not merged with the root `docker-compose.yml` (which has its own one-shot, non-idempotent `seed` service meant for a separate workflow).

## Hosted playground API

`Dockerfile.serve`, `render.yaml`, `fly.toml` -- deploy config for running `serve` as a public demo instance. Not deployed anywhere yet (needs your own Render/Fly account).

```bash
fly launch --dockerfile Dockerfile.serve --copy-config --now
```

## Continuous integration

`.github/workflows/ci.yml` on every push/PR/nightly: typecheck + unit tests + build (Node 20.x/22.x), smoke tests, static-bundle check, CLI e2e, mock-API e2e, a performance-regression check against a committed baseline (`scripts/perf-regression.mjs`), and the VS Code extension's own compile/test/build/package (a real `.vsix`, validated but not published). `.github/workflows/pages.yml` deploys `web-static/` to GitHub Pages.

**Using eco-faker in your own CI:** `.github/actions/seed-database/` is a reusable GitHub Action -- generates a dataset, optionally lints it, and seeds a real Postgres database in one step (`uses: Hung1510/Eco-Faker/.github/actions/seed-database@main`). See its own [README](./.github/actions/seed-database/README.md) for inputs/outputs and a full example.

## Publishing to npm

```bash
npm version patch   # or minor / major
npm publish --access public
```

`prepublishOnly` runs build + full test suite + smoke-test first. Requires npm account 2FA.

## Business logic: the cart state machine

```
                    ┌─────────────┐
   cart created ───▶│   active    │
                    └──────┬──────┘
                           │  time passes / checkout happens
              ┌────────────┴────────────┐
              ▼                         ▼
     ┌─────────────────┐       ┌───────────────┐
     │   abandoned      │       │   converted    │
     │ (>3h inactive,   │       │ → becomes an   │
     │  within timeout) │       │   Order        │
     └────────┬─────────┘       └───────┬────────┘
              │                         │
              ▼                         ▼
   AbandonedCheckout            Order.status:
   - recoveryEmailSent?         processing → shipped → delivered
   - couponCodeOffered?                            │
   - recovered? (bool)                              ▼
                                          returnRate roll (delivered only)
                                                     │
                                                     ▼
                                            ReturnRequest?
```

1. **Relational integrity** -- every `Cart` belongs to a `User`; every `Order` traces back to a converted `Cart`; a cart never produces both an `Order` and an `AbandonedCheckout`.
2. **Abandonment timing** -- `lastActivityDate` falls strictly between `now - abandonmentTimeoutHours` and `now - 3h`.
3. **Tracking realism** -- event timestamps strictly increase, valid stage order.
4. **Financial exactness** -- `subtotal + tax + shipping === total`, no floating-point drift.
5. **Return eligibility** -- only for orders whose every `Shipment` reached `Delivered`.
6. **Determinism** -- same `seed` + same `referenceNow` → byte-identical dataset.

## Locale support (`locales`)

```bash
my-eco-gen locales
# 73 supported locales (derived from the installed @faker-js/faker):
# af-ZA, ar, az, ..., zh-CN, zh-TW, zu-ZA

my-eco-gen generate --users 200 --locale ja --format json --output ./eco-data.json
```

Every real locale [@faker-js/faker](https://fakerjs.dev) ships (73 at time of writing) -- names, addresses, and currency formatting all follow `--locale`/`config.locale`. Computed dynamically from the installed dependency's own real locale exports (`src/locales.ts`), not a hand-maintained list -- a future `@faker-js/faker` version adding a locale means eco-faker gains it automatically. Joke locales (`en_BORK`, the "Swedish Chef" parody; `en_AU_ocker`, an exaggerated-slang parody) are filtered out. Four legacy names (`es-ES`/`de-DE`/`fr-FR`/`vi-VN`, eco-faker's own historical spelling for what faker-js calls bare `es`/`de`/`fr`/`vi`) are kept working for backward compatibility.

A handful of locales genuinely lack certain address fields in faker-js's own data -- `ro-MD` has no state/region concept at all, and `en-HK` (Hong Kong) has no postal codes, both historically accurate rather than data gaps. Those fields come back as an empty string rather than a fabricated value.

## Guaranteed-unique values

`generate()` guarantees no two users share an email within one call -- the same real-collision problem faker-js's own `faker.helpers.unique(...)` and faker-ruby's `Faker::X.unique.method` exist to solve (naive fake-data generation really does produce duplicates: confirmed directly at `scaleFactor: 5000`, a handful of seeds produced real duplicate emails before this existed). `src/unique.ts` exports `createUniqueTracker<T>()` -- explicitly scoped by construction (you create one, hold onto it for exactly as long as the constraint should apply, and it's garbage afterward) rather than a hidden global registry that could leak state between two unrelated `generate()` calls in a long-running process:

```ts
import { createUniqueTracker } from "eco-faker";

const uniqueSku = createUniqueTracker<string>();
const sku = uniqueSku.next(() => faker.string.alphanumeric(8).toUpperCase());
```

Throws `UniqueRetryLimitExceededError` (not an infinite loop) if a value space turns out to be too small for what's being asked of it. The temporal scenario engine's segment-merging (`mergeDatasets`) resolves the same kind of collision one level up -- two independently-seeded segments producing the same email once merged -- with a deterministic `+2`/`+3`-style disambiguator, since a per-segment tracker alone can't see across segments.

## Configurable behavioral parameters

See [`config.schema.json`](./config.schema.json) for the full list. Highlights:

| Field | Meaning | Default |
|---|---|---|
| `abandonmentRate` | chance a cart is abandoned instead of converted | `0.35` |
| `returnRate` | chance a delivered order gets a return request | `0.08` |
| `delayProbability` | chance a shipment hits `Delayed` | `0.15` |
| `maxDelayDays` | max extra days added when delayed | `3` |
| `historicalDays` | span of history to generate | `90` |
| `scaleFactor` | number of core users | `100` |
| `multiPackageRate` | chance an order ships as 2-3 separate packages | `0.1` |
| `missingAddressRate` | chance an order has no shipping address | `0.05` |
| `anomalies.botCartRate` | chance of a bot-activity cart anomaly | `0.02` |
| `anomalies.remoteShippingRate` | chance of a remote-region shipping surcharge | `0.05` |
| `anomalies.contradictoryReturnRate` | chance of a negative-reason return with a perfect CSAT score | `0.01` |

Validated against `config.schema.json` via [ajv](https://ajv.js.org/) -- invalid values throw with every violation listed.

## Project layout

```
src/
  rng.ts                seeded PRNG (mulberry32) -- every probabilistic decision runs through this
  unique.ts              createUniqueTracker() -- scoped, explicit uniqueness guarantee (matches faker-js/faker-ruby's own .unique)
  locales.ts              dynamic locale resolution from @faker-js/faker's own allLocales export (`locales` command)
  config.ts              defaults, merging (mergeOverrides), ajv schema validation
  config-schema-object.ts  the schema as a plain TS object (mirrors config.schema.json)
  scenarios.ts            named business-scenario config presets
  types.ts                shared TypeScript types
  generator.ts            orchestrates the full pipeline (generate() and generateRecords())
  multi-store.ts           generateStores(): N independently-seeded stores
  serve.ts                 mock REST API: chaos mode, API-key auth, /openapi.json, /postman.json
  openapi.ts                OpenAPI 3.0 spec builder for the mock API
  postman.ts                 Postman Collection v2.1 export
  live.ts                   WebSocket /live feed + GET /live/sse (Server-Sent Events, same feed)
  webhook.ts                webhook event builder + paced replay
  diff.ts                   dataset/snapshot structural diffing
  contract-test.ts           read-path contract testing engine (`test --contract`)
  mutation-test.ts           write-path/mutation contract testing engine (`test --mutate`)
  scenario-test.ts            cross-resource, multi-step scenario testing engine (`test --scenario`)
  gherkin.ts                  parses real .feature files into the same scenario engine (`test --gherkin`)
  scaffold.ts                 templates for `init next` / `init msw`
  orm-scaffold.ts              real ORM seed scripts for `init prisma`/`init drizzle`/`init sqlalchemy`
  score.ts                   realism-score engine (`score`)
  docs.ts                     README heading parsing + GitHub-slug replication (`docs`)
  completion.ts                bash/zsh/fish completion script generation (`completion`)
  index.ts                  full public API (Node)
  browser.ts                 browser-safe subset (excludes serve.ts and diff.ts)
  modules/
    user/                  users + addresses
    cart/                   carts, line items, abandoned checkouts
    order/                 cart -> order conversion, financial math
    tracking/               shipments, tracking event timelines, delays
    return/                  return request eligibility + generation
    anomaly/                 bot carts, remote-shipping surcharges, contradictory reviews
  introspect/
    prisma.ts / drizzle.ts / sqlalchemy.ts   schema parsers
    mapper.ts                 fuzzy canonical-column -> schema-column matcher
  output/
    json.ts / sql.ts / csv.ts   (sql.ts and csv.ts accept an optional SchemaMapping)
    ai-dataset.ts              Text2SQL/RAG-corpus/agent-scenarios/eval-set export
    benchmark/                 elasticsearch.ts / clickhouse.ts
  cli.ts                   `my-eco-gen` entrypoint
web/
  server.mjs               Express API for the interactive playground
  public/index.html        sliders + Chart.js frontend
web-static/
  index.html / explorer.html   static demos, no server
  src/app.ts / explorer.ts     import src/browser.ts directly
examples/
  scenarios/full-lifecycle.yaml   real, runnable example for `test --scenario`
scripts/
  smoke-test.mjs           CI structural smoke test against compiled dist/
  perf-regression.mjs       generation-time/memory regression check against a stored baseline
.github/workflows/
  ci.yml                   typecheck/build/test/smoke-tests, CLI e2e, mock-API e2e
  pages.yml                 builds + deploys web-static/ to GitHub Pages
.github/actions/seed-database/   reusable GitHub Action: generate + seed a database in CI
Dockerfile                 multi-stage build: compile -> slim runtime with psql baked in
docker-compose.yml         postgres + one-shot seed service
.devcontainer/              Node 22 + psql dev image, self-contained postgres+app compose
vscode-extension/           standalone VS Code extension package (own package.json/tsconfig)
  src/extension.ts           command registration, QuickPick/progress UI (untested in a real Extension Host)
  src/cliRunner.ts            pure CLI-invocation building + spawn logic (unit- and integration-tested)
  src/tableViewer.ts           webview table browser: switch/search/sort/paginate, entirely client-side (jsdom-tested)
```

## Performance

Batch generation is O(n) in `scaleFactor` with no repeated I/O. `--stream` mode keeps memory flat regardless of scale. The `records/sec` and `relational integrity` badges above read live from [`benchmark-results.json`](./benchmark-results.json), regenerated by CI on every push.

```bash
npm run build && npm run benchmark
npm run perf-regression   # fails if generation time/memory regress beyond a stored baseline
```

## VS Code extension

A UI in front of the CLI, for generating data, browsing it, or scaffolding a project without leaving the editor -- see [`vscode-extension/`](./vscode-extension/) for the source and its own README.

Commands (Command Palette, `Cmd/Ctrl+Shift+P`): **eco-faker: Generate Dataset** (prompts for users/scenario/format/output path, then offers to jump into the table viewer), **eco-faker: View Dataset Tables** (browse any generated `dataset.json` in a webview -- switch tables, search, sort, paginate, entirely client-side), **eco-faker: Scaffold Next.js Integration**, **eco-faker: Scaffold MSW Integration**. The CLI-invoking commands shell out to the real `my-eco-gen` CLI (or `npx eco-faker` if it's not installed globally) -- not a reimplementation of any generation logic.

```bash
cd vscode-extension
npm install
npm test          # real CLI spawned end-to-end + the table viewer's real HTML/JS run via jsdom, no vscode module involved
npm run package   # produces an installable .vsix via @vscode/vsce
```

First slice, scoped deliberately: generate/view/scaffold commands only, no Miller-columns relationship drill-down yet (a natural next step, not attempted here -- the CLI's own `visualize`/static demo already cover a version of that outside the editor). The extension's own logic that builds CLI invocations and the table viewer's entire client-side behavior are both directly tested (including, for the table viewer, actually executing its real embedded script via jsdom -- table switching, search, sort, and pagination are all genuinely exercised) -- but `extension.ts`'s actual VS Code UI (QuickPicks, progress notifications, webview creation) hasn't been run inside a real Extension Host, since that needs downloading the actual VS Code binary from a host this environment can't reach. Stated plainly rather than implied otherwise.

## CLI docs & shell completion

```bash
my-eco-gen docs score          # prints (and tries to open) the realism-score README section
my-eco-gen docs mutate         # matches "Mutation testing", not "Contract testing"
my-eco-gen docs                # no topic -- opens the README's top

eval "$(my-eco-gen completion bash)"    # or: zsh / fish
my-eco-gen completion bash >> ~/.bashrc # persist it
```

`docs <topic>` case-insensitively matches `topic` against the real README's own `##`/`###` headings (parsed at runtime, not a hand-maintained topic list) and prints the resolved GitHub URL, then tries to open it in your default browser -- the URL is printed either way, so this is still useful headless. No match prints the real list of available sections instead of guessing.

`completion <bash|zsh|fish>` generates a completion script from the real, current set of subcommands and their real flags (introspected off the live Commander program, not a second hand-maintained copy that could drift the moment a flag changes).

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for what's next and the full history of what's been built, why, and every real bug found along the way.
