# eco-faker

[![CI](https://github.com/Hung1510/Eco-Faker/actions/workflows/ci.yml/badge.svg)](https://github.com/Hung1510/Eco-Faker/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/eco-faker.svg)](https://www.npmjs.com/package/eco-faker)
[![npm downloads](https://img.shields.io/npm/dt/eco-faker.svg)](https://www.npmjs.com/package/eco-faker)
[![records/sec](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FHung1510%2FEco-Faker%2Fmain%2Fbenchmark-results.json&query=%24.recordsPerSecond&label=records%2Fsec&color=blue)](./benchmark-results.json)
[![relational integrity](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FHung1510%2FEco-Faker%2Fmain%2Fbenchmark-results.json&query=%24.relationalIntegrityPercent&suffix=%25&label=relational%20integrity&color=brightgreen)](./benchmark-results.json)

Stateful, relationally-consistent fake-data generator for e-commerce apps. Not just a pile of random JSON — every `Cart`, `Order`, `Shipment`, and `ReturnRequest` is derived from the same underlying state machine, so the dataset reads like a real store's history instead of unrelated fixtures.

```
Users → Carts → (AbandonedCheckouts | Orders → Shipments → ReturnRequests)
```

![eco-faker demo](./docs/demo.gif)

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

## Features

- **Product catalog** — a real, shared catalog (categories in a 2-level department/subcategory tree, brands, suppliers, products with variants) that carts and orders actually draw their line items from -- the same product genuinely recurs across many orders instead of every line item being independently invented
- **Synthetic recommendation data** — for every user, the browsing/search/wishlist/review trail that explains their purchases (`User → View Product → Add Wishlist → Purchase → Review`), grounded in the rest of the dataset rather than independently random, generated on its own decoupled RNG stream
- **Inventory simulation** — warehouses, replenishment orders (tied to the same `Supplier.leadTimeDays` the catalog already generates), stockout periods, and warehouse transfers, with low-current-stock products meaningfully more likely to have a recent stockout/replenishment history
- **Analytics dashboard** (`dashboard`) — daily revenue, conversion funnel, retention cohorts, customer LTV, and CAC computed from a dataset, exported as CSV (PowerBI/Excel/Sheets), SQL (to seed a real database for Metabase/Superset), or JSON
- **Benchmark export** (`benchmark-export`) — real Elasticsearch Bulk API NDJSON + inferred index mappings, and ClickHouse DDL (`ENGINE = MergeTree()`, proper ClickHouse types); Postgres and ClickHouse's data payload both reuse the existing SQL/CSV output rather than reimplementing it a second or third time
- **Event sourcing mode** (`events`) — a comprehensive, chronologically-ordered event stream (`user.created`, `cart.item_added`, `order.created`, `shipment.delivered`, `product.viewed`, ...) across all 18 tables, every event carrying `aggregateId`/`aggregateType` for real event-sourcing replay
- **Shopping carts** — line items, quantities, status (`active` / `abandoned` / `converted`)
- **Abandoned checkouts** — recovery email timing, coupon offers, recovery outcome
- **Orders** — financially exact (`subtotal + tax + shipping === total`), locale-aware formatted currency (`totalFormatted`), free-shipping threshold, missing-address edge case
- **Shipment tracking** — realistic multi-stage event histories (`Label Created → Picked Up → In Transit → [Delayed] → Out for Delivery → Delivered`), multi-package orders
- **Return requests** — only for delivered orders, weighted approve/reject/pending, partial or full refunds, formatted refund amounts
- **Scenario presets** — `--scenario black-friday` swaps in a whole tuned config bundle for a recognizable business situation
- **Anomaly injection** — rare, high-value edge cases that stress-test downstream systems (see below)
- **Deterministic** — same seed + same reference time → byte-identical dataset; snapshot/replay for exact reproducibility
- **Three output formats** — JSON, SQL (Postgres-flavored `CREATE TABLE` + `INSERT`), CSV
- **Schema-aware output** — point it at an existing Prisma, Drizzle, or SQLAlchemy schema (or a live/local OpenAPI spec fetched over HTTP) and it maps its own columns onto yours
- **High-volume streaming** — NDJSON straight to stdout, no dataset ever held fully in memory
- **Mock REST API** — `my-eco-gen serve` spins up a paginated, filterable, json-server-style API backed by a generated dataset, with optional chaos mode, API-key auth, an OpenAPI spec, a Postman collection export, a live WebSocket event feed, a mounted GraphQL endpoint (`--graphql`), and plain-English request logging
- **Fraud simulation engine** — `my-eco-gen generate --fraud-rate 0.03` tags a subset of orders with realistic fraud risk signals (stolen cards, account farming, reseller behavior, refund abuse, chargebacks, coupon abuse rings) -- some structurally grounded (shared addresses really are shared, bulk quantities really are bulk), for fraud-detection demos, ML training data, or analytics dashboards
- **MSW adapter** — `eco-faker/msw` turns a dataset into Mock Service Worker request handlers for `setupServer`/`setupWorker`, sharing the exact same filter/sort/paginate logic as `serve`
- **MCP server** — `my-eco-gen mcp` exposes generate/query/fuzz/lint/visualize as tools any MCP client (Claude Code, Claude Desktop) can call directly, with datasets kept server-side and referenced by id across calls
- **tRPC adapter** — `eco-faker/trpc` turns a dataset into a typed tRPC router (one sub-router per table, `list`/`byId` procedures), same filter/sort/paginate semantics as `serve` and the MSW adapter
- **GraphQL adapter** — `eco-faker/graphql` turns a dataset into an executable GraphQL schema (mountable in graphql-yoga/apollo-server/mercurius), same filter/sort/paginate helpers as the other three adapters
- **Semantic fuzzing** — `my-eco-gen fuzz` mutates a dataset with data that's schema-valid but logically impossible (mismatched addresses, inverted prices, time-paradox returns, oversell quantities), finding business-logic bugs schema validation can't catch
- **Pre-flight lint** — `my-eco-gen lint` checks referential integrity, uniqueness, and financial/temporal consistency offline (or dry-runs real SQL against a real Postgres inside `BEGIN`/`ROLLBACK`)
- **Webhook event simulator** — replay the dataset as a paced, chronological stream of `order.created`/`cart.abandoned`/`shipment.delivered`-style events POSTed to a URL
- **Dataset diffing** — `my-eco-gen diff` reports row-count deltas, schema drift, and status-distribution shifts between two datasets or snapshots
- **Multi-store mode** — `--stores N` generates N independent, distinctly-seeded stores in one call
- **Interactive web playground** — sliders + live charts + RFM/cohort segmentation + side-by-side scenario comparison, backed by a small Express API
- **Customer journey timeline** — `my-eco-gen visualize` renders one customer's full lifecycle as a self-contained, animated D3 timeline (works fully offline, no CDN)
- **Static browser demo** — the same generator bundled with esbuild and running with zero server, deployable straight to GitHub Pages
- **One-command Postgres demo** — `docker compose up` generates a scenario and seeds a real database
- **CI-tested** — GitHub Actions runs typecheck/tests/build/smoke-test/CLI e2e/static-bundle-check on every push, PR, and nightly
- **CLI** — `my-eco-gen generate --users 50 --format sql --output ./seed.sql`

## Install

**As a CLI tool:**

```bash
npm install -g eco-faker
my-eco-gen --help
```

**As a library, in a project:**

```bash
npm install eco-faker
```

**From source** (for contributing, or to run the web playground / static demo):

```bash
git clone https://github.com/Hung1510/Eco-Faker.git
cd eco-faker
npm install
npm run build
```

## Quick start (2 lines)

```ts
import { generate, serialize } from "eco-faker";

const dataset = generate({ seed: 42, scaleFactor: 200 });
const sql = serialize(dataset, "sql"); // or "json" / "csv"
```

That's it — `dataset` already contains relationally-linked `users`, `carts`, `abandonedCheckouts`, `orders`, `shipments`, and `returnRequests`.

## CLI

```bash
npm install -g eco-faker   # or: npm link, if you're working from a source checkout
my-eco-gen generate --users 50 --format sql --output ./seed.sql

my-eco-gen generate \
  --users 100 \
  --format json \
  --output ./data/eco.json \
  --seed 7 \
  --abandonment-rate 0.45 \
  --delay-probability 0.25 \
  --max-delay-days 5
```

Run `my-eco-gen generate --help` for the full flag list. Every flag maps 1:1 to a field in `config.schema.json`.

---

## Product catalog

Every cart and order draws its line items from a real, shared catalog instead of inventing a fresh fake product per line item:

```bash
my-eco-gen generate --users 300 --catalog-size 200
```

```
catalog:             33 categories, 13 brands, 6 suppliers, 200 products
```

**Structure:**
- **Categories** — a 2-level tree (`Electronics > Laptops`, `Clothing > Women's Dresses`, etc.) across six departments and their subcategories. Category/product names are generic and Faker-synthesized -- deliberately no real trademarked brand or product-line names, for the same reason Faker.js's own commerce module avoids them.
- **Brands** and **Suppliers** (with `country`, `leadTimeDays`) — flat lists, referenced by every product.
- **Products** — `sku`, `name`, `categoryId`/`brandId`/`supplierId`, `basePrice` (drawn from a per-subcategory price band, so laptops and puzzles don't share a price range), and `variants[]` (e.g. `{ storage: "512GB", color: "Space Gray" }`, each with its own `sku`, `priceDelta`, and `stockLevel`).

**The important part:** this isn't just a products table sitting next to carts/orders unused. `LineItem.productId` on every cart, order, and shipment resolves to a real `products[].id` -- verified by `lint`'s referential-integrity check, and by the fact that the *same* product genuinely shows up across many different orders (a real, queryable pattern, not a coincidence):

```bash
my-eco-gen generate --users 300 --format json --output ./eco-data.json
my-eco-gen lint --input ./eco-data.json   # confirms every line item's productId is real
```

Available through everything else in this README the same way the original six tables are -- `serve`'s REST API (`/api/products`, `/api/categories`, `/api/brands`, `/api/suppliers`), the MSW/tRPC/GraphQL adapters, SQL/CSV output (with real `REFERENCES` foreign keys), and schema introspection (`my-eco-gen init`) -- all four adapters and both output formats are generic over the table list, so the catalog didn't need special-casing anywhere except the OpenAPI spec's hand-written schema definitions.

`--catalog-size` controls how many products get generated (default 150); categories/brands/suppliers scale automatically with it.

## Synthetic recommendation data

For every user, generates the browsing/search/wishlist/review trail that actually explains their purchases -- the shape recommendation engines, collaborative filtering demos, and vector search systems want to train on:

```
User -> View Product -> Add Wishlist -> Purchase -> Review
```

```bash
my-eco-gen generate --users 300
```

```
catalog:             33 categories, 13 brands, 6 suppliers, 150 products
...
productViews: 7339, searchQueries: 2836, wishlistItems: 345, productRatings: 414
```

Four new tables, and -- like the product catalog -- the point isn't that they exist, it's that they're *grounded* in the rest of the dataset rather than independently random:

- **`productViews`** -- every product a user actually bought was viewed 1-4 times beforehand (`source: "search" | "category_browse" | "recommendation" | "direct"`). Plus realistic *noise* browsing of products the user never bought -- a recommendation dataset where "viewed" trivially equals "purchased" isn't useful for anything.
- **`searchQueries`** -- every `search`-sourced view has a real, matching query (`clickedProductId` set, timestamped a few minutes before the view), with query text derived from the actual product/category name (`"laptop"`, not `faker.lorem.words()`).
- **`wishlistItems`** -- a subset of viewed-but-not-yet-purchased products. Never backdated to before a purchase already happened.
- **`productRatings`** -- only on **delivered** orders, only a subset of line items (not everyone reviews everything), timestamped after the shipment's real "Delivered" event, `rating` skewed positive (matching typical real-world review distributions) with an optional templated review matching the rating.

```bash
my-eco-gen generate --users 300 --no-recommendation-data   # disable, e.g. for a smaller/faster dataset
```

**Architecture note, since it matters for correctness:** unlike the product catalog (woven into the core per-user generation loop), recommendation data runs as a fully separate post-processing pass with its **own decoupled RNG stream** (seeded from your `--seed`, offset so it never repeats another module's sequence). Enabling or disabling it changes *nothing* about every other table's output -- verified by a dedicated test. This was a deliberate choice: integrating the product catalog into the core loop shifted RNG draw sequences enough to unmask three latent bugs elsewhere in the codebase (documented in `ROADMAP.md`); running this module in isolation means it can't do that to anything else.

Available through `serve`'s REST API (`/api/product-views`, `/api/search-queries`, `/api/wishlist-items`, `/api/product-ratings`), the MSW/tRPC/GraphQL adapters, SQL/CSV output, and `lint`'s referential checks, the same way every other table is.

## Inventory simulation

Warehouses, replenishment orders, stockout periods, and warehouse transfers -- for ERP demos and logistics simulations, and useful for anyone building against `Product.variants[].stockLevel` who wants a plausible *history* explaining why a level is what it is, not just the number itself.

```bash
my-eco-gen generate --users 300
```

```
inventorySimulation: 12 warehouses, 63 replenishments, 37 stockouts, 8 transfers
```

The grounding here is direct, not just thematic: `ReplenishmentOrder.expectedDeliveryAt` is exactly `orderedAt + supplier.leadTimeDays` -- the same `leadTimeDays` field already on every `Supplier` from the product catalog, not a second, disconnected lead-time number. And products/variants whose *current* `stockLevel` is low are meaningfully more likely to have a recent stockout period and/or a pending replenishment order than well-stocked ones -- a real, checkable correlation between "this product shows low stock right now" and "here's the order history that explains it," verified directly in tests rather than assumed.

Status/date consistency is enforced, not just independently randomized: a `received` replenishment order never has an `expectedDeliveryAt` still in the future, an order `ordered` weeks ago is nudged toward `delayed` or `received` rather than staying implausibly `ordered`, and a stockout period's `resolvedByReplenishmentId` (when set) always points to a real, `received` order for the same product with a matching `endedAt`.

```bash
my-eco-gen generate --users 300 --no-inventory-simulation   # disable
```

**Same decoupled-RNG architecture as recommendation data, with its own independent seed offset** -- toggling inventory simulation on or off changes nothing about recommendation data's output either, and vice versa. Verified directly: a real CLI run with and without `--no-inventory-simulation` produces byte-identical `productViews`/`productRatings` counts and content in both cases.

Available through `serve`'s REST API (`/api/warehouses`, `/api/replenishment-orders`, `/api/stockout-periods`, `/api/warehouse-transfers`), the MSW/tRPC/GraphQL adapters, SQL/CSV output (with real `REFERENCES` foreign keys, including `stockout_periods.resolved_by_replenishment_id -> replenishment_orders(id)`), and `lint`'s referential checks.

## Analytics dashboard (`dashboard`)

Computes daily revenue, a conversion funnel, monthly retention cohorts, per-customer LTV, and a CAC estimate from a dataset -- and exports it for a BI tool. Architecturally different from every other feature above: this is a pure, deterministic aggregation over data that already exists, not new synthetic content -- no RNG involved at all.

```bash
my-eco-gen generate --users 500 --output ./eco-data.json
my-eco-gen dashboard --input ./eco-data.json --format csv --output ./dashboard/
```

```
Written 5 CSV files to ./dashboard/
Import directly: PowerBI (Get Data > Text/CSV), Excel, or Google Sheets.

500 customers, 423 paying, avg LTV $11822.40, CAC $11.82 (assuming $5000 spend / 423 new customers -- override with --marketing-spend).
```

Three formats:

```bash
my-eco-gen dashboard --input ./eco-data.json --format csv    # daily_revenue.csv, funnel.csv, retention_cohorts.csv, customer_ltv.csv, summary.csv
my-eco-gen dashboard --input ./eco-data.json --format sql    # one .sql file: CREATE TABLE + INSERT for all four tables
my-eco-gen dashboard --input ./eco-data.json --format json   # the full computed report as one JSON object
```

**Worth being direct about, since "PowerBI CSV / Metabase seed / Superset demo" was the original ask:** neither Metabase nor Superset has a native static "seed file" format -- both connect to a real database and build questions/dashboards against whatever's there. `--format sql` *is* what seeds them: load it into Postgres, then point either tool at that database. `--format csv` is the one that's genuinely tool-native, since PowerBI's Get Data > Text/CSV (and Excel, and Google Sheets) import flat files directly. This is stated plainly rather than claiming three distinct proprietary export formats that don't actually exist.

What's computed, and what it means:
- **Daily revenue** — grouped by `order.createdAt`'s date, summed to the cent. Verified against a direct sum of every order's `total`.
- **Conversion funnel** — `viewed → added_to_cart → checkout_started → purchased`, each stage a real distinct-user count (not four independently random numbers). The `viewed` stage only appears if the dataset actually has recommendation data -- it's omitted entirely rather than reporting a fabricated zero.
- **Retention cohorts** — classic cohort table: users grouped by the month of their first order, tracked against whether they ordered again in each subsequent relative month.
- **Customer LTV** — total revenue, order count, and average order value per customer, plus a dataset-wide average/median summary.
- **CAC** — the one figure this dataset has nothing else to derive from. `--marketing-spend <number>` sets the assumed total spend explicitly (default: `$5000`, a plain, clearly-arbitrary placeholder, not disguised as computed data); `newCustomersAcquired` and `cac` itself are real, computed numbers once that one input is given.

**Two real bugs found building this, both fixed:**
1. The `viewed` funnel stage could show *fewer* users than `added_to_cart` -- a >100% "conversion rate" -- because recommendation data's noise-browsing pass didn't guarantee every cart-active user had at least one recorded view. Fixed in `generateRecommendationData` itself (a real realism improvement, not a funnel-side patch): any user with cart activity and zero recorded views gets one, since realistically you view something before adding it to a cart even if that view isn't tied to a specific purchase.
2. `computeAnalytics` crashed with a real `TypeError` when run against a dataset loaded back in via `--input`, because `generate --format json`'s output deliberately omits `config` (see `output/json.ts`) and the funnel computation read `dataset.config.recommendationData.enabled` directly. Fixed by checking whether `productViews` actually has content instead -- a strictly better design, not just a crash workaround, since it doesn't depend on config metadata surviving a round trip it was never guaranteed to survive.

Also available as an MCP tool (`compute_analytics`).

## Benchmark export (`benchmark-export`)

Exports a dataset for benchmarking Elasticsearch or ClickHouse.

```bash
my-eco-gen generate --users 500 --output ./eco-data.json
my-eco-gen benchmark-export --input ./eco-data.json --target elasticsearch --output ./es-export/
my-eco-gen benchmark-export --input ./eco-data.json --target clickhouse --output ./ch-export/
```

**Deliberately scoped to the one real gap, not three parallel reimplementations of the same data:**
- **Postgres** isn't a target here at all -- `generate --format sql` and `generate --format csv` (+ `\copy table FROM 'file.csv' CSV HEADER`) already cover it. A third code path producing the same rows a third time would be maintenance surface with no new capability behind it.
- **ClickHouse** ingests the *existing* CSV output natively (`clickhouse-client --query "INSERT INTO table FORMAT CSVWithNames" < file.csv`), so `--target clickhouse` only generates `schema.sql` -- real ClickHouse DDL (`ENGINE = MergeTree()`, `ORDER BY (id)`, and ClickHouse's own type names: `String`, `Int64`, `Float64`, `DateTime64(3)`, `Nullable(...)` where a column can actually be null). The data payload is the CSV you already have.
- **Elasticsearch** is the one target that genuinely needed new serialization code, since ES has no CSV/SQL ingestion path -- its Bulk API takes NDJSON (alternating `{"index":{"_index":...,"_id":...}}` action lines and document lines), which nothing else in this repo produces. `--target elasticsearch` writes one real index mapping (`<table>.mapping.json`) and one real bulk file (`<table>.bulk.ndjson`) per table, field types inferred from the actual generated values (`keyword` for ids, `date` for ISO timestamps, `long`/`double`/`boolean` for the rest).

Both targets are driven by the same new generic row extractor (`datasetToCanonicalRows`, in `introspect/canonical-rows.ts`) rather than a fourth hand-written per-table field mapping alongside the ones already in `output/sql.ts` and `output/csv.ts` -- it derives every field name generically from `CANONICAL_COLUMNS` (`user_id` -> `userId`) instead of listing all 18 tables' fields out by hand again.

**One real bug found and fixed:** the Elasticsearch type inference originally sampled a single value per column to decide `long` vs `double` -- so a column like `orders.shipping`, which is `$0` for most orders but a real decimal surcharge for others, could get mapped as integer-only `long` depending on which row happened to be sampled first, silently truncating or rejecting the real decimal values on actual ingestion. Fixed to check *every* value in the column, not just the first; verified across five seeds with a test that cross-checks every field mapped `long` against every real value in that column, with zero violations.

## Scenario presets

Instead of hand-tuning a dozen rates, apply a named business scenario -- a whole pre-tuned config bundle:

```bash
my-eco-gen scenarios   # list all presets with their key values

my-eco-gen generate --scenario black-friday --format sql --output ./black-friday.sql
my-eco-gen generate --scenario post-holiday-returns --format json --output ./returns.json
```

| Scenario | Story | Key tuning |
|---|---|---|
| `black-friday` | Traffic spike, overwhelmed checkout | high `scaleFactor` + `abandonmentRate`, low `delayProbability` (logistics hasn't caught up yet) |
| `post-holiday-returns` | Weeks after peak season | high `returnRate` + `delayProbability` (carrier backlog), low new-cart activity |
| `flash-sale` | Short, intense burst | very high `abandonmentRate` (stock races out before checkout), tiny `historicalDays` window |
| `supply-chain-crisis` | Logistics network under strain | high `delayProbability` + `maxDelayDays` + `multiPackageRate` (partial fulfillment) |
| `steady-state` | Ordinary day-to-day traffic | close to `DEFAULT_CONFIG`, named for symmetry |

Explicit flags still win over the scenario -- `--scenario black-friday --users 50` uses Black Friday's abandonment/delay/coupon tuning but only 50 users, not the preset's 2,000. This is the same precedence a snapshot records, so `--scenario X --snapshot ./run.json` captures the fully-resolved recipe, scenario included.

Programmatically:

```ts
import { generate, SCENARIOS, resolveScenario, mergeOverrides } from "eco-faker";

const dataset = generate(mergeOverrides(resolveScenario("black-friday"), { scaleFactor: 500 }));
```

---

## Mock REST API ("json-server for e-commerce")

Build or demo a frontend against a realistic, stateful backend without waiting on a real API:

```bash
my-eco-gen serve --users 300 --scenario black-friday --port 4000
```

```
GET  /                                             endpoint list + row counts
GET  /api/orders?status=delivered&page=2&pageSize=25
GET  /api/orders?sort=total&order=desc
GET  /api/shipments/:id
GET  /api/users | /api/carts | /api/abandoned-checkouts | /api/orders | /api/shipments | /api/returns
GET  /openapi.json                                 OpenAPI 3.0 spec -- import into Postman/Insomnia/Swagger UI
```

Any query param other than `page`/`pageSize`/`sort`/`order` is treated as an exact-match filter against that field (`?status=delivered`, `?userId=...`). It's deliberately simple -- no query language, just enough surface to build and demo a real UI against. All the usual flags apply (`--scenario`, `--seed`, `--bot-cart-rate`, etc.) since it's generating data through the same pipeline as `generate`.

### Request logging with plain-English status meanings

By default, every `/api/*` request prints a colored, human-readable line to
the console once it finishes -- not just a bare status code:

```
GET /api/orders 200 -- orders fetched successfully (3ms)
GET /api/orders/ord_a1b2 200 -- order fetched -- purchase confirmed (1ms)
GET /api/orders 429 -- rate limit hit (simulated chaos) (2ms)
GET /api/users 500 -- internal server error (simulated chaos) (7ms)
GET /api/orders/does-not-exist 404 -- no matching record found (1ms)
```

Green for 2xx, yellow for 4xx, red for 5xx. The same description is also
sent as an `X-Eco-Faker-Meaning` response header on every response
(including ones short-circuited by chaos mode or auth), so tooling can read
it programmatically without parsing the console. Disable the console line
with `--quiet` (the header is still sent either way):

```bash
my-eco-gen serve --users 300 --chaos --quiet
```

### Chaos mode -- don't just mock the happy path

```bash
my-eco-gen serve --users 300 --chaos
my-eco-gen serve --users 300 --chaos --chaos-error-rate 0.2 --chaos-rate-limit-rate 0.1 --chaos-latency-rate 0.3
```

Every `/api/*` request rolls the dice: a simulated `429` (with a `Retry-After` header), a simulated `500`, an injected latency spike (300-2000ms by default), or -- most of the time -- the normal response. Defaults are `errorRate=0.05`, `rateLimitRate=0.05`, `latencyRate=0.2`; tune each independently. `/` and `/openapi.json` are never affected, so tooling and docs stay reachable even under chaos. This is the same "don't just generate the happy path" philosophy as anomaly injection, applied to the API layer instead of the data layer.

### API-key auth simulation

```bash
my-eco-gen serve --users 300 --api-key my-secret-key
curl -H "Authorization: Bearer my-secret-key" http://localhost:4000/api/orders
```

Every `/api/*` request without a matching `Authorization: Bearer <key>` header gets a `401`. One static key, no scopes or expiry -- the point is forcing frontend code to exercise its 401-handling path, not modeling real auth.

### Live WebSocket event feed

```bash
my-eco-gen serve --users 300 --live --live-interval-ms 500
```

Opens `ws://localhost:4000/live`, broadcasting one dataset-derived event every `--live-interval-ms` (default 800ms) to every connected client -- literally "watch orders roll in" instead of a static chart. It reuses the same event list the webhook simulator builds, so a `shipment.delivered` message references a shipment also reachable via `GET /api/shipments/:id` on the same server -- consistent ids across the REST API and the live feed. Loops back to the start when the event list is exhausted.

### Postman collection export

```bash
my-eco-gen serve --users 300 --postman
my-eco-gen serve --users 300 --postman --postman-output ./my-collection.json --api-key my-secret-key
```

Writes a ready-to-import Postman Collection v2.1 file to disk at startup (default `./eco-faker.postman_collection.json`) *and* serves it live at `GET /postman.json` -- import via file or via URL, whichever's more convenient. One folder per resource (Users, Carts, Abandoned Checkouts, Orders, Shipments, Returns), each with a pre-filled "List" request (page/pageSize/sort/order params, plus a disabled example filter) and a "Get by id" request. If `--api-key` is set, the collection gets a matching collection-level Bearer auth block, so authenticated requests work the moment you import it -- no manual header setup. Both the file and the `/postman.json` endpoint are generated from the exact same `TABLE_ROUTES` the REST server and the OpenAPI spec use, so all three never drift out of sync with each other.

## MSW (Mock Service Worker) adapter

If your tests already use [MSW](https://mswjs.io) instead of a standalone
server, skip `serve` entirely and get the same data straight into your
existing `setupServer`/`setupWorker`:

```bash
npm install --save-dev msw   # peer dependency, not bundled -- install it yourself
```

```ts
import { setupServer } from "msw/node";
import { generate } from "eco-faker";
import { toMswHandlers } from "eco-faker/msw";

const dataset = generate({ seed: 1, scenario: "black-friday" });
const server = setupServer(...toMswHandlers(dataset));

beforeAll(() => server.listen());
afterAll(() => server.close());
```

Same routes, same query semantics (`?status=delivered`, `?sort=total&order=desc`,
`?page=2&pageSize=25`), same `X-Eco-Faker-Meaning` response header as `serve`
-- `toMswHandlers` reuses the exact same filter/sort/paginate implementation,
so the two adapters can't drift apart from each other. Handlers match by path
regardless of origin (`*/api/orders`), so they work whether your app fetches
`/api/orders` relatively or hits a fully-qualified URL in a Node test
environment with no `window.location`.

```ts
// custom mount point, e.g. if your app calls a different base path
toMswHandlers(dataset, { basePath: "/mock-api" });
```

## MCP server -- use eco-faker from Claude Code, Claude Desktop, or any MCP client

```bash
my-eco-gen mcp
```

Runs eco-faker as an [MCP](https://modelcontextprotocol.io) server over stdio, exposing nine tools an agent can call directly instead of shelling out to the CLI and parsing stdout:

| Tool | What it does |
|---|---|
| `generate_dataset` | Generate a dataset (scenario/seed/scaleFactor/locale) -- returns a `datasetId`, counts, and a 3-row sample, not the full dataset |
| `query_table` | Filter/sort/paginate one table of a previously generated dataset -- same semantics as `serve` and the MSW adapter |
| `fuzz_dataset` | Semantic fuzzing against a dataset -- returns a *new* `datasetId` for the mutated copy |
| `fraud_simulate` | Tags a subset of orders with realistic fraud risk signals -- returns a *new* `datasetId` for the tagged copy |
| `compute_analytics` | Daily revenue, conversion funnel, retention cohorts, customer LTV, and CAC for a dataset -- a pure aggregation, no new datasetId |
| `build_event_stream` | Chronological event stream across all 18 tables -- returns counts + a small sample, not the full stream |
| `lint_dataset` | Offline data-quality check (plus an optional live-Postgres dry run) |
| `visualize_journey` | Writes a customer-journey HTML timeline to disk, returns the path + event summary |
| `list_scenarios` | Lists the five named scenario presets with descriptions |

Datasets are kept in an in-memory store (capped at the 20 most recent, oldest evicted first) and referenced by `datasetId` across calls -- an agent generates once, then queries/fuzzes/lints/visualizes against that id without the full dataset ever needing to round-trip through its context window. This is exactly the `fuzz` → `lint` loop from the CLI, just callable as agent tools:

```
generate_dataset({ scenario: "black-friday", seed: 1 })
  -> { datasetId: "518068db-...", counts: { orders: 1842, ... } }
fuzz_dataset({ datasetId: "518068db-...", intensity: "extreme" })
  -> { datasetId: "9c2a-...", mutationCount: 24, summary: { price_inversion: 8, ... } }
lint_dataset({ datasetId: "9c2a-..." })
  -> { errorCount: 8, issues: [ { rule: "financial_mismatch", ... }, ... ] }
```

**Claude Desktop / Claude Code config** (`claude_desktop_config.json` or your MCP client's equivalent):

```json
{
  "mcpServers": {
    "eco-faker": {
      "command": "npx",
      "args": ["-y", "eco-faker", "mcp"]
    }
  }
}
```

(Swap `npx -y eco-faker` for `my-eco-gen` if you have it installed globally.)

## tRPC adapter

For T3-stack-style apps, skip `serve` and get a typed tRPC router instead:

```bash
npm install --save-dev @trpc/server   # peer dependency, not bundled -- install it yourself
```

```ts
import { initTRPC } from "@trpc/server";
import { generate } from "eco-faker";
import { toTrpcRouter } from "eco-faker/trpc";

const dataset = generate({ seed: 1, scenario: "black-friday" });
const ecoFakerRouter = toTrpcRouter(dataset);

// merge into your existing app router, or use standalone:
const t = initTRPC.create();
export const appRouter = t.router({
  ecoFaker: ecoFakerRouter,
  // ...your real routers
});
```

One sub-router per table, camelCased (`abandoned-checkouts` becomes `abandonedCheckouts`), each with `list` (filter/sort/paginate -- identical semantics and identical helper functions to `serve` and the MSW adapter) and `byId` (throws a `TRPCError({ code: "NOT_FOUND" })` for an unknown id, tRPC's idiomatic equivalent of `serve`'s 404):

```ts
await caller.orders.list({ filters: { status: "delivered" }, sort: "total", order: "desc", pageSize: 10 });
await caller.orders.byId({ id: "ord_123" });
await caller.info(); // table names + counts, same shape as serve's GET /
```

The `X-Eco-Faker-Meaning` header `serve` and the MSW adapter send doesn't have a tRPC equivalent (tRPC procedures don't carry HTTP headers in the same sense), so it rides along in the response payload instead, as a `meaning` field on every `list`/`byId` result.

## GraphQL adapter

```bash
npm install --save-dev graphql   # peer dependency, not bundled -- install it yourself
```

```ts
import { graphql } from "graphql";
import { generate } from "eco-faker";
import { toGraphQLSchema } from "eco-faker/graphql";

const dataset = generate({ seed: 1, scenario: "black-friday" });
const { schema, typeDefs } = toGraphQLSchema(dataset);

// mount `schema` directly into graphql-yoga / apollo-server / mercurius,
// or execute it yourself:
await graphql({
  schema,
  source: `{ orders(filters: { status: "delivered" }, pageSize: 10) { data pagination { total } meaning } }`,
});
```

One `<table>(filters, sort, order, page, pageSize)` list field and one `<table>ById(id)` field per table, plus `info` -- same filter/sort/paginate helpers as `serve`, the MSW adapter, and the tRPC adapter. Records and `filters` use a `JSON` scalar rather than hand-typed per-resource GraphQL types -- e-commerce records here are nested (line items, addresses, tracking events) and vary per table, so fully typing all six shapes would be a lot of ceremony for a mock-data adapter. `typeDefs` (plain SDL string) is exported alongside the executable `schema` as a starting point if you want to layer concrete types on top yourself.

**Don't want to wire it into your own GraphQL server?** `serve --graphql` mounts this same schema directly as `POST /graphql` on the mock REST API, no extra setup:

```bash
my-eco-gen serve --users 300 --graphql
curl -X POST http://localhost:4000/graphql -H "Content-Type: application/json" \
  -d '{"query":"{ orders(filters: { status: \"delivered\" }, pageSize: 5) { data pagination { total } meaning } }"}'
```

`GET /graphql` returns a usage hint (not an error) if you hit it in a browser. Requires the same optional `graphql` package as the standalone adapter above.

## Webhook event simulator

Replay the dataset as a paced, chronological stream of webhook events -- exactly what a Stripe/Shopify-style webhook consumer needs to test against:

```bash
my-eco-gen webhook --url http://localhost:3000/webhooks --scenario post-holiday-returns --speed 3600
my-eco-gen webhook --url https://example.com/hook --events order.created,shipment.delivered --limit 50 --dry-run
```

- `--speed 3600` means 1 simulated hour of dataset history per real second (so a 90-day `historicalDays` span replays in ~36 minutes; tune to taste).
- `--max-wait-ms` (default 5000) caps the real-world wait between any two events, so a rare multi-day gap in the data doesn't stall the replay.
- Shipment tracking is the richest source: every entry in a shipment's event history becomes its own webhook (`shipment.label_created`, `shipment.picked_up`, ..., `shipment.delayed`, `shipment.delivered`), each with its own real timestamp.
- `--dry-run` prints `[i/n] timestamp type` instead of POSTing, so you can preview the timeline before pointing it at a real endpoint.

Event types emitted: `user.created`, `cart.created`, `cart.abandoned`, `checkout.abandoned`, `checkout.recovery_email_sent`, `order.created`, `shipment.<status>` (per tracking-event stage), `return.requested`, `return.approved` / `return.rejected`.

## Event sourcing mode (`events`)

Builds a comprehensive, chronologically-ordered event stream from a dataset -- `user.created`, `cart.item_added`, `order.created`, `shipment.delivered`, `product.viewed`, `replenishment.received`, and more, across all 18 tables.

```bash
my-eco-gen generate --users 300 --output ./eco-data.json
my-eco-gen events --input ./eco-data.json --output ./events.ndjson
```

```
Written 13239 events (25 event types) to ./events.ndjson
```

**How this differs from the webhook simulator above, since they're clearly related:** `webhook` is about *replaying* a dataset at a controlled pace to an HTTP endpoint (only 6 tables' worth of event types, streamed directly off the generator for memory efficiency). `events` is about the dataset's event-sourced *representation* itself -- every event carries `aggregateId`/`aggregateType`, the fields an actual event-sourced system needs to group events into per-entity streams and replay them into current state (`webhook.ts`'s `WebhookEvent` has neither, since pacing deliveries doesn't need them), and it covers all 18 tables including the ones the webhook simulator predates (recommendation data, inventory simulation). Write it to a file immediately with `events`; pace it out to a URL over time with `webhook`.

```bash
my-eco-gen events --input ./eco-data.json --event-types "order.created,shipment.delivered" --output ./fulfillment.ndjson
my-eco-gen events --input ./eco-data.json --format json --output ./events.json
```

No RNG anywhere in this module -- every event's timestamp comes directly from real data already in the dataset, with one grounded exception: `Cart.items[]` has no per-item timestamp of its own, so `cart.item_added` events are evenly interpolated between the cart's real `createdAt` and `lastActivityDate` bounds rather than left out or given a fabricated independent timestamp.

Also available as an MCP tool (`build_event_stream`), which returns counts and a small sample rather than the full stream (which can run into the thousands of events) -- use `eventTypes` to filter, or the CLI command to write the complete stream to a file.

## Dataset diffing

"Did this dependency bump silently change the shape of my data?" -- diff two datasets (from `generate --format json`) or two snapshot recipes (from `generate --snapshot`), auto-detected either way:

```bash
my-eco-gen diff ./before.json ./after.json
my-eco-gen diff ./bug-42.snapshot.json ./bug-43.snapshot.json --fail-on-schema-change   # for CI
```

```
Row counts (./before.json -> ./after.json):
  users                    50 -> 50     (+0, +0.0%)
  orders                   84 -> 75     (-9, -10.7%)
  ...

Schema drift (added/removed fields per table):
  (none)

Cart status distribution:
  converted                84 -> 75     (-10.7%)
  abandoned                35 -> 50     (+42.9%)
  ...
```

Schema-drift detection only compares field sets when both sides actually sampled at least one row for that table -- an empty array on one side isn't evidence of a missing field, just missing data (an earlier version of this feature had that false-positive bug; there's a regression test for it now).

## Semantic fuzzing (`fuzz`) -- finding bugs schema validation can't catch

Schema/type fuzzing (nulls, missing fields, wrong types) tests type safety. Semantic fuzzing tests business logic: it generates data that's still perfectly *valid* against a schema, but logically impossible.

```bash
my-eco-gen fuzz --users 300 --scenario black-friday --intensity extreme --output ./eco-data.fuzzed.json
```

Four mutation types, each targeting a real class of bug:

- **`address_mismatch`** -- takes a real city/state from one order and a real postal code from a *different* order, producing a shipping address where every field is individually valid but the combination describes nowhere real. Tests whether anything cross-checks postal code against city/state.
- **`price_inversion`** -- drops a line item's unit price by ~95-99% *without* recomputing the order's subtotal/total, so the order becomes internally inconsistent. Tests whether financial totals are validated on ingest or just trusted as-given -- the class of bug that lets an "impossible discount" through a checkout pipeline.
- **`time_paradox`** -- dates a return request before the order it's returning was even created. Tests whether temporal ordering between related records is enforced anywhere, since each timestamp alone is still a valid ISO date.
- **`inventory_oversell`** -- jumps a line item's quantity to 500-999 in a single order. No real per-order retail purchase looks like this; tests whether anything caps implausible per-SKU quantities.

```bash
my-eco-gen fuzz --types price_inversion,time_paradox --intensity extreme --fuzz-seed 42   # restrict + reproducible
my-eco-gen fuzz --input ./eco-data.json --report ./mutations.json                          # fuzz existing data, save the mutation log
```

Mutation selection is deterministic for a given `--fuzz-seed` (default `1`) -- the same seed always produces the same mutations against the same input. Pair it with `lint` (below) to see the mutations actually get caught:

```bash
my-eco-gen fuzz --users 300 --intensity extreme --output ./fuzzed.json
my-eco-gen lint --input ./fuzzed.json   # reports the financial_mismatch / temporal_paradox issues fuzz just introduced
```

**What's not built yet:** firing these mutated payloads at a *live* API and asserting on the response -- that needs the contract-testing engine (`my-eco-gen test --contract`), which is speced but not implemented (see [ROADMAP.md](./ROADMAP.md)). Today, `fuzz` mutates data; wiring it into an HTTP-assertion pipeline against a real API is the next step. In the meantime, feed the mutated dataset into your own seed/insert pipeline and see what breaks.

## Pre-flight lint (`lint`) -- a data quality gate before you insert anything

Offline by default -- checks a dataset in memory for the same class of thing a real `BEGIN; ...; ROLLBACK;` dry run against Postgres would catch, without needing a database:

```bash
my-eco-gen lint --users 300 --scenario black-friday
```

```
ok: no lint issues found (referential integrity, uniqueness, financial/temporal consistency).
```

Checks: orphaned foreign keys (a `cart.userId` that doesn't match any user), duplicate ids within a table, duplicate user emails, line items whose `lineTotal` doesn't equal `unitPrice * quantity`, orders whose `total` doesn't equal `subtotal + tax + shipping`, and return requests dated before their order. Exits with code `1` if any errors are found, so it's a real CI gate:

```bash
my-eco-gen lint --input ./eco-data.json || exit 1
```

**Real Postgres dry-run mode** -- for validating an actual `.sql` seed file against your *actual* schema's real constraints (catching a custom `CHECK` constraint or trigger the offline checks above don't model), pass `--sql` and `--db-url`:

```bash
my-eco-gen lint --sql ./seed.sql --db-url postgres://user:pass@localhost:5432/staging
```

This runs the SQL inside `BEGIN; ...; ROLLBACK;` against the real database -- nothing is ever committed. Requires the optional `pg` package (`npm install pg`) and a reachable Postgres instance; unlike the offline checks above, this mode needs a live database and isn't exercised by eco-faker's own test suite for that reason.

## Multi-store / multi-tenant mode

Generate N independent, distinctly-seeded stores in one call -- useful for marketplace or multi-tenant SaaS demo data:

```bash
my-eco-gen generate --stores 5 --users 200 --format json --output ./marketplace.json
```

Produces `[{ storeId: "store-1", dataset: {...} }, { storeId: "store-2", dataset: {...} }, ...]`, each store fully independent (own seed derived from the base seed + store index) but reproducible as a whole. **JSON output only for now** -- SQL/CSV would need a `store_id` column threaded through every canonical table, which isn't implemented yet.

---

## Interactive visual playground

A small full-stack demo: an Express API wrapping the real `generate()` call, and a vanilla-JS + Chart.js frontend with live sliders.

```bash
npm run build
npm run web
# open http://localhost:4173
```

Adjust **Abandonment rate** or **Delay probability** and the cart-status pie chart, shipment-status bar chart (with `Delayed` highlighted), revenue-by-day chart, and a **customer-segment (RFM) doughnut chart + top-10-spenders table** all regenerate in real time from the same generator that powers the CLI — same code, same guarantees, just visualized.

The RFM panel (`GET /api/rfm`) buckets customers into Recency/Frequency/Monetary quartiles and labels them with simple rule-based segments (Champions, Loyal, Big Spenders, At Risk, New/One-time, Hibernating) -- illustrative cohort analytics, not a trained clustering model, but a genuine demonstration of turning generated orders into a business-relevant view.

A **"Compare scenarios side by side"** panel (`GET /api/compare?scenarioA=&scenarioB=`) runs two scenario presets at the same scale and charts their abandonment/delayed-shipment/return-rate percentages next to each other, with average order value shown as two separate stat badges (dollar figures and percentages don't share a sensible axis, so they're not forced onto the same bar chart). The CLI's `diff` command covers the same underlying need in text form; this is the visual, exploratory version.

```
web/
  server.mjs        Express API: GET /api/generate?scaleFactor=&abandonmentRate=&...
                              GET /api/rfm?scaleFactor=&... (cohort segmentation)
                              GET /api/compare?scenarioA=&scenarioB=&scaleFactor=&... (side-by-side)
                              GET /api/scenarios (list of preset names, for the dropdowns)
  public/index.html sliders + Chart.js, fetches all endpoints and re-renders
```

## Customer journey timeline (`visualize`)

The playground above shows aggregate charts. This shows one customer's whole story as an animated, time-scaled swimlane -- proof the data isn't just random rows, it's a coherent narrative:

```bash
my-eco-gen visualize --users 300 --scenario black-friday --output ./journey.html
# open journey.html directly in a browser -- no server needed
```

```
Terrance Frami (85b02bfe-...): 10 events.
Journey timeline written to ./journey.html -- open it directly in a browser.
```

Walks signup → every cart (and whether it was abandoned) → checkout recovery attempts → every order → every shipment tracking event → every return, all pulled from the real relational links between tables (same `userId`/`cartId`/`orderId` foreign keys `lint` checks). Without `--user`, it picks whichever user has the richest journey (most cart/order/return activity) so the default output is actually interesting instead of a near-empty timeline.

```bash
my-eco-gen visualize --input ./eco-data.json --user <userId> --output ./journey.html   # a specific user from existing data
```

The output is a single genuinely self-contained HTML file -- D3 is vendored and inlined directly into it (see `assets/d3.v7.min.js`, ISC-licensed), not loaded from a CDN, so it opens and renders correctly from a plain `file://` URL with zero network access, on an air-gapped machine or behind a locked-down proxy.

## Static browser demo (no server, deployable to GitHub Pages)

The same generator, bundled with esbuild, running entirely client-side -- click a link, no install:

```bash
npm run build:static
# open web-static/index.html directly, or serve the folder with any static host
```

This works because `src/config.ts` loads its validation schema from a plain TS object (`src/config-schema-object.ts`) instead of reading a JSON file off disk with `node:fs` -- that's what makes the whole generation pipeline (`generate`, `generateRecords`, `generateStores`, scenarios, even the webhook event builder) bundleable for the browser. `src/browser.ts` is the curated entrypoint for this: everything except `serve.ts` (needs Express/Node's HTTP server) and `diff.ts` (reads files via `node:fs`), which don't make sense client-side anyway.

```
web-static/
  index.html         same dashboard UI, but calls generate() directly in-browser
  src/app.ts          imports from ../../src/browser.js, no fetch() calls at all
  dist/bundle.js      esbuild output (platform: browser, ~970kb, includes faker-js + ajv)
```

`.github/workflows/pages.yml` builds and deploys this to GitHub Pages on every push to `main` that touches `web-static/` or `src/`.

## Anomaly injection (rare, high-value edge cases)

Boring fake data is predictable. `config.anomalies` injects realistic chaos that stress-tests fraud detection, payment gateways, and inventory systems -- the kind of contradictory signal real e-commerce platforms actually see:

| Anomaly | Trigger | What it does |
|---|---|---|
| **Bot activity** | `botCartRate` (default `0.02`) | Cart gets 50-120 line items; timestamp forced to 2-4am when that doesn't break timeline ordering |
| **Remote-shipping surcharge** | `remoteShippingRate` (default `0.05`) | Order ships to Hawaii/Alaska/Puerto Rico; a real `$24.99` freight surcharge is added to `shipping` and `total` (financial consistency still holds) |
| **Contradictory review** | `contradictoryReturnRate` (default `0.01`) | A return filed for a clearly negative reason ("Item damaged in transit", etc.) is given a perfect `csatScore: 5` — inconsistent signal for naive sentiment models |

Anomalous records are **tagged, not hidden** — check `record.anomaly?.type` and `record.anomaly?.note` on any `Cart`, `Order`, or `ReturnRequest`.

```bash
my-eco-gen generate --users 500 --bot-cart-rate 0.05 --remote-shipping-rate 0.1 --contradictory-return-rate 0.03
my-eco-gen generate --users 500 --no-anomalies   # disable entirely
```

## Fraud simulation engine

Anomaly injection above produces rare *edge cases*. This produces the *output of a fraud-detection system* -- a risk score and evidence signals attached to a subset of orders, in the shape an ML pipeline, fraud-review dashboard, or analytics demo would actually expect:

```bash
my-eco-gen generate --users 500 --fraud-rate 0.03
```

```json
{
  "id": "6a8e50e0-...",
  "status": "delivered",
  "fraud": {
    "fraudType": "account_farming",
    "riskScore": 69,
    "signals": ["shared_address_with_3_other_accounts", "new_account"]
  }
}
```

Six fraud types, each with a `riskScore` (0-100) and evidence `signals`. Some are **structurally grounded** -- the pattern is actually detectable in the dataset, not just an asserted label:

| Type | What's actually true in the data |
|---|---|
| `account_farming` | Several *other* real user accounts really do get their `address` overwritten to exactly match the flagged order's address -- `shared_address_with_N_other_accounts` is a number you can verify with a query, not a made-up string |
| `reseller_behavior` | A line item's `quantity` really is bumped to an implausible-for-retail amount (50-300), with `lineTotal`/`subtotal`/`total` correctly recomputed -- a believable behavioral pattern, not broken data (unlike `fuzz`'s deliberately-inconsistent mutations) |
| `refund_abuse`, `friendly_chargeback` | Only ever assigned to orders that already have a real linked `ReturnRequest` in the dataset -- a chargeback without an underlying return wouldn't be coherent |
| `stolen_card` | Order timestamp is shifted to within hours of the account's own signup (`new_account` + immediate high-value purchase) |
| `coupon_abuse_ring` | Evidence-label only (`reused_coupon:CODE`) -- this dataset model doesn't have a coupon field on `Order` itself, documented rather than silently implied |

```bash
my-eco-gen generate --fraud-rate 0.05 --fraud-types stolen_card,account_farming --fraud-seed 42
```

`--fraud-rate` is a per-order consideration probability, not a guaranteed final count -- return-linked types only apply to orders that actually have a return, so the realized flagged rate can land slightly below the requested rate. Fraud tags are JSON-only metadata (same as `anomaly` tags) -- they don't appear in SQL/CSV output. Also available as an MCP tool (`fraud_simulate`) and, like `fuzz`, pairs naturally with `lint` -- `reseller_behavior` orders stay lint-clean by design, since the point is a believable pattern rather than corrupted data.

## Schema introspection & auto-mapping

Point `my-eco-gen` at an existing **Prisma, Drizzle, SQLAlchemy schema, or a live/local OpenAPI spec** and it maps its own canonical columns onto yours -- no manual `faker.name() -> user_full_nm` mapping by hand. The schema type is auto-detected from the file extension (`.prisma`, `.ts`/`.js`, `.py`, `.json`) or a URL, or set explicitly with `--schema-type`.

```bash
my-eco-gen init --schema ./prisma/schema.prisma --output ./mapping.json          # Prisma
my-eco-gen init --schema ./db/schema.ts --schema-type drizzle -o ./mapping.json # Drizzle
my-eco-gen init --schema ./models.py --schema-type sqlalchemy -o ./mapping.json # SQLAlchemy
my-eco-gen init --schema https://api.example.com/openapi.json -o ./mapping.json # live OpenAPI spec
```

```
Parsed 2 model(s) from ./prisma/schema.prisma (prisma).
  users -> User: 6/7 columns confidently mapped
  orders -> CustomerOrder: 12/12 columns confidently mapped
  carts: no matching model found -- left unmapped (canonical names kept).
  ...
Review and edit ./mapping.json, then run:
  my-eco-gen generate --mapping ./mapping.json --format sql --output ./seed.sql
```

**Schema-from-live-API inference** -- the OpenAPI mode fetches a real API's published spec (`components.schemas` for OpenAPI 3.x, `definitions` for Swagger 2.0) over HTTP and maps eco-faker's canonical columns onto *its* field names, so generated data matches your actual API contract instead of a hand-maintained mapping. This works against any API that publishes an OpenAPI spec -- including eco-faker's own `serve --openapi`, which is a genuinely useful self-check:

```bash
my-eco-gen serve --users 100 &
my-eco-gen init --schema http://localhost:4000/openapi.json -o ./mapping.json
```
```
Parsed 11 model(s)/schema(s) from http://localhost:4000/openapi.json (openapi).
  users -> Users: 7/7 columns confidently mapped
  carts -> Carts: 8/8 columns confidently mapped
  orders -> Orders: 12/12 columns confidently mapped
  ...
```

`mapping.json` is a plain, human-editable file -- review the low-confidence entries before trusting them:

```json
{
  "users": {
    "targetModel": "User",
    "columns": {
      "last_name": { "targetColumn": "last_nm", "confidence": 0.5 },
      "email": { "targetColumn": "email_addr", "confidence": 0.5 }
    }
  }
}
```

Then generate SQL/CSV targeting your real table and column names (no `CREATE TABLE` is emitted when a mapping is supplied, since the schema already exists):

```bash
my-eco-gen generate --users 200 --format sql --mapping ./mapping.json --output ./seed.sql
```

This is a lightweight, regex-based parser (one per schema dialect, plus a JSON walker for OpenAPI) and a token-overlap fuzzy matcher -- not a full AST/type-checker for any of the ecosystems, and not a JSON Schema `$ref` resolver for OpenAPI (it reads `properties` directly on each schema plus one level of `allOf` merging, not deep `$ref` chains). It's meant to get you 80% of the way and surface confidence scores for the rest, not to be a silent black box.

## High-volume stream mode

`generate()` normally returns a fully-materialized `Dataset`. For load-testing or bulk ingestion, `--stream` emits one NDJSON line per record **the instant it's produced**, honoring stdout backpressure (`awaiting 'drain'`) instead of buffering everything in memory first:


```bash
my-eco-gen generate --users 100000 --stream > eco.ndjson
my-eco-gen generate --users 100000 --stream | kafka-console-producer --topic eco-events --bootstrap-server localhost:9092
```

Each line looks like `{"table": "orders", "id": "...", ...}` -- pipe it anywhere that speaks NDJSON: a bulk-insert script, a data lake ingester, `jq`, etc.

Programmatically, the underlying generator is exported directly:

```ts
import { generateRecords } from "eco-faker";

for (const { table, record } of generateRecords({ scaleFactor: 100000 })) {
  // handle one record at a time, no full dataset ever in memory
}
```

## Time-travel debug mode (snapshots)

`generate()` is deterministic given `(config, referenceNow)` -- so a "snapshot" doesn't need to store the whole dataset, just the recipe that reproduces it exactly.

```bash
# Generate normally, and also save the exact recipe used:
my-eco-gen generate --users 100 --seed 42 --format json --output ./run1.json --snapshot ./bug-42.snapshot.json

# ...days later, in a bug report or a test suite...
my-eco-gen replay --input ./bug-42.snapshot.json --format json --output ./replay.json
diff ./run1.json ./replay.json   # byte-identical, guaranteed
```

`bug-42.snapshot.json` is a few lines of JSON (`seed`, resolved config overrides, `referenceNow`) -- lightweight enough to commit alongside a failing test case, so "user 42's cart abandoned at exactly 2:31pm" becomes a one-line fixture instead of a multi-megabyte data dump.

---

## Docker: seed a real Postgres database in one command

```bash
docker compose up --build
```

This brings up two services:
- `postgres` -- a real Postgres 16 instance (`localhost:5432`, db `eco_faker`, user/password `eco`/`eco`)
- `seed` -- builds the CLI, generates a `black-friday` scenario as SQL, and loads it straight into Postgres via `psql`, then exits (an "exited with code 0" status for `seed` is expected and means it worked)

```bash
psql -h localhost -U eco -d eco_faker -c "select status, count(*) from orders group by status;"
```

Edit `docker-compose.yml`'s `seed.command` to change the scenario, user count, or format. `Dockerfile` is a standard multi-stage build (compile TypeScript, then a slim runtime image with `psql` baked in) -- no dependency on anything outside this repo.

## Hosted playground API

`Dockerfile.serve`, `render.yaml`, and `fly.toml` in the repo root are a ready-to-go deploy config for running `serve` as a public, no-install-required demo instance -- the kind of thing you can link directly in a README or a tweet and have someone see real JSON come back with zero setup on their end. **This isn't deployed anywhere yet** -- deploying it means connecting your own Render or Fly account, since that's not something that can be done from a repo alone. Once you do:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Hung1510/Eco-Faker)

```bash
# or, with the Fly CLI:
fly launch --dockerfile Dockerfile.serve --copy-config --now
```

Either config builds `Dockerfile.serve` (a dedicated image, separate from the root `Dockerfile` used by the Postgres-seed demo above -- this one stays running and binds to the platform-assigned `$PORT`) and starts `serve --scenario black-friday --users 300 --chaos --postman --live`, regenerating a fresh dataset on every restart (no persistence -- it's a public demo, not meant to hold real state). Once it's live at whatever URL your host gives you:

```bash
curl https://<your-deployed-url>/api/orders?status=delivered&pageSize=5
```

is the whole onboarding experience -- real JSON, no `npm install`, no clone.

## Continuous integration

`.github/workflows/ci.yml` runs on every push, PR, and nightly (`workflow_dispatch` also available), across three jobs:

- **`test`** -- typecheck + unit tests + build on Node 18.x and 20.x, `npm run smoke-test` (every scenario preset against compiled `dist/`, asserting relational/financial invariants independent of the vitest suite), and a static-bundle check (`npm run build:static` + `scripts/smoke-test-static.cjs` against a fake DOM)
- **`cli-e2e`** -- generate in all three formats, snapshot+replay byte-identical diff, `--stream` produces valid NDJSON, every scenario preset runs, `diff` reports zero drift comparing a run to itself, `--stores` generates N independent stores
- **`mock-api-e2e`** -- `serve` answers on `/`, `/api/orders`, and `/openapi.json`; `--chaos --chaos-error-rate 1` reliably returns `500`; `--api-key` rejects unauthenticated requests and accepts the correct key; `/openapi.json`'s `$ref` pointers all resolve; `webhook --dry-run` produces a valid chronological event list; `--postman`'s output file and its `/postman.json` endpoint are byte-identical and carry the right auth block

`.github/workflows/pages.yml` is a separate, focused workflow that builds and deploys `web-static/` to GitHub Pages whenever `main` changes anything under `web-static/` or `src/`.

**Status:** the GitHub Pages deployment (`pages.yml`) has run successfully on real GitHub Actions runners. `ci.yml` triggers on the same pushes and its commands were all dry-run locally before being committed, but hasn't been independently confirmed green on a runner as of this writing -- the badge at the top of this README is the live source of truth for that.

## Publishing to npm

**Live:** [`eco-faker` is published on npm](https://www.npmjs.com/package/eco-faker).

```bash
npm install -g eco-faker
my-eco-gen generate --users 50 --format sql --output ./seed.sql
```

or as a library:

```bash
npm install eco-faker
```

To cut a new version and publish an update:

```bash
npm version patch   # or minor / major
npm publish --access public
```

`prepublishOnly` runs build + full test suite + smoke-test automatically before anything gets uploaded, so a broken build can't ship. Publishing itself requires npm account 2FA (npm now enforces this for all publishes) -- the first-time setup is a one-time hurdle (WebAuthn/Windows Hello or a hardware key; TOTP apps like Authy are no longer offered for new enrollments), but every publish after that just prompts for the same fingerprint/PIN/security key confirmation you already have configured.

---

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

Key rules enforced by the generator (and covered by the test suite):

1. **Relational integrity** — every `Cart` belongs to a `User`; every `Order` traces back to a converted `Cart` with identical line items; every `Shipment` belongs to a real `Order`; a cart never produces both an `Order` and an `AbandonedCheckout`.
2. **Abandonment timing** — a cart can only be marked `abandoned` if it's old enough for the ">3h inactive" rule to be satisfiable, and `lastActivityDate` always falls strictly between `now - abandonmentTimeoutHours` and `now - 3h`.
3. **Tracking realism** — event timestamps strictly increase and follow a valid stage order; a shipment created "today" may legitimately have zero scans yet (`status: "Label Created"`, empty `events`) rather than being forced into a future event.
4. **Financial exactness** — `subtotal` is the exact sum of rounded line totals; `tax` and `shipping` are rounded independently; `total` is their sum — no floating-point drift (even the remote-shipping anomaly recomputes this exactly).
5. **Return eligibility** — a `ReturnRequest` only exists for an `Order` whose every `Shipment` reached `Delivered`.
6. **Determinism** — the same `seed` **and** the same reference time produce an identical dataset. `generate()` accepts an optional second `referenceNow` argument for pinned reproducibility in tests/CI/snapshots; without it, it defaults to the current time (so the "last N days" window naturally shifts run to run, same as a real store).

## Configurable behavioral parameters

See [`config.schema.json`](./config.schema.json) for the full, documented list. Highlights:

| Field | Meaning | Default |
|---|---|---|
| `abandonmentRate` | chance a cart is abandoned instead of converted | `0.35` |
| `returnRate` | chance a delivered order gets a return request | `0.08` |
| `delayProbability` | chance a shipment hits `Delayed` | `0.15` |
| `maxDelayDays` | max extra days added when delayed | `3` |
| `historicalDays` | span of history to generate | `90` |
| `scaleFactor` | number of core users | `100` |
| `multiPackageRate` | chance an order ships as 2–3 separate packages | `0.1` |
| `missingAddressRate` | chance an order has no shipping address (never ships) | `0.05` |
| `anomalies.botCartRate` | chance of a bot-activity cart anomaly | `0.02` |
| `anomalies.remoteShippingRate` | chance of a remote-region shipping surcharge anomaly | `0.05` |
| `anomalies.contradictoryReturnRate` | chance of a negative-reason return with a perfect CSAT score | `0.01` |

Config is validated against `config.schema.json` via [ajv](https://ajv.js.org/) — invalid values throw with every violation listed, not just the first.

## Project layout

```
src/
  rng.ts                seeded PRNG (mulberry32) — every probabilistic decision runs through this
  config.ts              defaults, merging (mergeOverrides), ajv schema validation
  config-schema-object.ts  the schema as a plain TS object (no node:fs), mirrors config.schema.json
  scenarios.ts            named business-scenario config presets (black-friday, etc.)
  types.ts                shared TypeScript types
  generator.ts            orchestrates the full pipeline (generate() and the streaming generateRecords())
  multi-store.ts           generateStores(): N independently-seeded stores in one call
  serve.ts                 mock REST API (json-server style): chaos mode, API-key auth, /openapi.json, /postman.json
  openapi.ts                hand-written OpenAPI 3.0 spec builder for the mock API
  postman.ts                 Postman Collection v2.1 export, derived from the same route table
  live.ts                   WebSocket /live feed, broadcasts webhook-shaped events at an interval
  webhook.ts                webhook event builder + paced replay, browser-safe
  diff.ts                   dataset/snapshot structural diffing, reads files via node:fs
  index.ts                  full public API (Node)
  browser.ts                 browser-safe subset of the public API (excludes serve.ts and diff.ts)
  modules/
    user/                  users + addresses
    cart/                   carts, line items, abandoned checkouts
    order/                  cart → order conversion, financial math, formatted currency
    tracking/               shipments, tracking event timelines, delays
    return/                  return request eligibility + generation
    anomaly/                 bot carts, remote-shipping surcharges, contradictory reviews
  introspect/
    prisma.ts                lightweight .prisma schema parser
    drizzle.ts                lightweight Drizzle (pgTable/mysqlTable/sqliteTable) parser
    sqlalchemy.ts              lightweight SQLAlchemy declarative-model parser
    mapper.ts                 fuzzy canonical-column -> schema-column matcher (shared by all three)
  output/
    json.ts / sql.ts / csv.ts   (sql.ts and csv.ts accept an optional SchemaMapping)
  cli.ts                   `my-eco-gen` entrypoint (generate / serve / webhook / diff / replay / init / scenarios)
web/
  server.mjs               Express API for the interactive playground (+ /api/rfm, /api/compare, /api/scenarios)
  public/index.html        sliders + Chart.js frontend: RFM panel + side-by-side scenario comparison
web-static/
  index.html               static demo UI, no server
  src/app.ts                imports src/browser.ts directly, calls generate() client-side
  dist/bundle.js            esbuild output (git-ignored, built by `npm run build:static`)
scripts/
  smoke-test.mjs           CI structural smoke test against compiled dist/
  smoke-test-static.cjs     runs the static bundle against a fake DOM to catch bundling regressions
tests/
  relational-integrity.test.ts
  timeline.test.ts
  financial-and-determinism.test.ts
  anomaly.test.ts
  scenarios.test.ts
  serve-webhook-diff.test.ts
  chaos-auth-openapi-live.test.ts
.github/workflows/
  ci.yml                   3 jobs: typecheck/build/test/smoke-tests, CLI e2e, mock-API e2e (chaos/auth/openapi)
  pages.yml                 builds + deploys web-static/ to GitHub Pages on push to main
Dockerfile                 multi-stage build: compile -> slim runtime with psql baked in
docker-compose.yml         postgres + one-shot seed service
```

## Testing

```bash
npm test                    # vitest unit suite
npm run smoke-test          # structural smoke test against compiled dist/ (run after npm run build)
npm run build:static && node scripts/smoke-test-static.cjs   # static bundle, fake-DOM check
```

299 vitest tests cover event sourcing (chronological ordering across the full stream, every `eventId` unique, real per-table event counts checked against the source dataset rather than "some events exist" -- `cart.item_added` count matching the real total line-item count across every cart, `replenishment.received`/`stockout.resolved` only firing for records that actually have a real `receivedAt`/`endedAt`, cart-item timestamp interpolation staying within the cart's own real `[createdAt, lastActivityDate]` bounds and internally ordered, and a degenerate zero-width window handled without crashing), benchmark export (the shared `datasetToCanonicalRows` extractor producing exactly the tables and columns `CANONICAL_COLUMNS` declares, in order, with snake_case fields spot-checked back against the real camelCase source values; every Elasticsearch mapping's `id`/`*_id` columns as `keyword` and `*_at` columns as `date`; every ClickHouse `CREATE TABLE` statement syntactically balanced with matching `ENGINE = MergeTree()` and `ORDER BY (id)`; a nullable column like `received_at` correctly wrapped in ClickHouse's `Nullable(...)`; one real bug caught here -- Elasticsearch's numeric type inference originally sampled a single value per column, so `orders.shipping` (mostly `$0`, sometimes a real decimal) could get mapped integer-only `long` depending on which row got sampled first, silently truncating real decimal values on ingestion; fixed to check every value in the column, verified across five seeds with zero violations against every real value in every column mapped `long`), the analytics dashboard (daily revenue summing to the cent against a direct sum of order totals, the conversion funnel's stage-by-stage user counts never exceeding the previous stage's across eight seeds, the `viewed` stage omitted entirely -- not zeroed -- when recommendation data doesn't exist, retention cohorts' month-0 rate always exactly 1.0 and cohort sizes matching a real recomputation from order history, customer LTV summing exactly to each customer's real order totals, and CAC's assumed-spend figure staying a plain configurable input rather than disguised computed data; two real bugs were caught building this: the conversion funnel could show a >100% "conversion rate" from viewed to added_to_cart because recommendation data's noise-browsing pass didn't guarantee every cart-active user had at least one recorded view -- fixed as a genuine realism improvement to `generateRecommendationData` itself, not a funnel-side patch -- and `computeAnalytics` crashed outright on a dataset reloaded via `--input`, since `generate --format json` deliberately omits `config` and the funnel computation read `dataset.config.recommendationData.enabled` directly; fixed by checking the `productViews` array's own content instead, which is strictly more correct regardless of how the dataset arrived), inventory simulation (replenishment `expectedDeliveryAt` always equals `orderedAt + supplier.leadTimeDays` exactly, status/date consistency -- a "received" order never has a future delivery date, a stockout's `resolvedByReplenishmentId` always points to a real received order for the same product -- low-current-stock products are measurably more likely to have a stockout/replenishment history than well-stocked ones, and toggling it changes nothing about recommendation data's output or vice versa, since both run on independent decoupled RNG streams), synthetic recommendation data (every purchased product was actually viewed beforehand, every search-sourced view has a real matching query, ratings only ever exist on delivered orders and postdate the shipment's real "Delivered" event, wishlist items are never backdated to before a purchase already happened, and -- verified directly, not assumed -- enabling/disabling the feature changes nothing about any other table's output, since it runs on a fully decoupled RNG stream; two real bugs were caught building this: noise-browsing views could claim a "search" source with no backing query record, and the test verifying that invariant had its own bug, grabbing an arbitrary matching query via `.find()` instead of checking that *some* qualifying query preceded the specific view under test), the product catalog (category-tree parent linkage, per-subcategory price bands, deterministic generation, and -- the important part -- that every cart/order/shipment line item's `productId` resolves to a real product, with the same product genuinely reused across many orders rather than independently invented per line; includes a regression test for a real bug where bot-activity carts generated their own fake, catalog-disconnected productIds, silently producing hundreds of referential-integrity failures on an otherwise normal dataset), relational integrity (no orphaned records), timeline realism (valid event ordering, no future timestamps), financial exactness, determinism, edge cases (missing address, multi-package), anomaly injection (bot carts, remote-shipping surcharges, contradictory returns, the master `anomalies.enabled` switch), scenario presets (resolution, unknown-scenario errors, and `mergeOverrides` precedence -- including a regression test for a real bug where explicit CLI flags could silently clobber a scenario's nested `anomalies` config instead of merging with it), the mock REST API server (filtering, sorting, pagination, 404s, the `X-Eco-Faker-Meaning` response header on success/item/404 responses, and `--graphql` mounting), the MSW/tRPC/GraphQL adapters (identical filter/sort/paginate/meaning behavior across all three plus `serve`, verified via a real `setupServer`, a real `createCallerFactory` caller, and real `graphql()` execution respectively), the MCP server (all nine tools exercised via the SDK's real `Client` over both an in-memory transport and an actual spawned stdio subprocess), the OpenAPI-based schema inference (including a self-referential dogfood test -- eco-faker mapping its own generated OpenAPI spec back onto its own canonical tables -- and a real HTTP-fetched-URL test), the semantic fuzzing engine (32 regression tests across 8 seeds x 4 mutation types independently re-verifying each mutation's claimed "after" value against final dataset state -- this caught two real bugs: the same record could be targeted twice by one mutation type across multiple attempts, silently invalidating an earlier claim, and mutated line items were identified by SKU, which stopped being a safe unique identifier once the catalog made duplicate SKUs within one order possible; both fixed) and the fraud simulation engine (six fraud types, with `account_farming`'s claimed shared-address count and `reseller_behavior`'s bumped quantity independently re-verified against the final mutated dataset -- the same double-targeting bug class, caught and fixed here first), chaos mode (forced error/rate-limit rates actually produce the expected status codes and meaning header, and chaos never touches `/` or `/openapi.json`), API-key auth (rejects missing/wrong keys, accepts the right one, never gates the docs routes), the OpenAPI spec (every resource has list+item paths, every `$ref` resolves to a real schema), the Postman collection export (correct v2.1 structure, one folder per resource, the file and `/postman.json` endpoint stay byte-identical, the auth block matches `--api-key`), the live WebSocket feed (chronologically-shaped events broadcast to a real connected client), the webhook simulator (chronological ordering, event-type filtering, granular shipment lifecycle events), dataset diffing (including a regression test for a real false-positive bug where an empty table was flagged as "schema drift" just because it happened to sample zero rows), the offline linter (catches orphaned foreign keys -- including catalog FKs and line-item productIds -- duplicate ids/emails, financial mismatches, temporal paradoxes -- including a fuzz-then-lint integration test), the journey timeline builder (chronological ordering, per-user event isolation, richest-user selection, HTML-escaping in the rendered output, and confirmed offline-rendering via an actual headless-browser screenshot after an earlier CDN-based version silently failed), multi-store determinism, and locale-aware currency formatting (including on anomaly-adjusted totals).

## Performance

Batch generation is O(n) in `scaleFactor` with no repeated I/O. ~800 orders (and their shipments, checkouts, and returns) generate in well under 300ms on a typical dev machine — 1,000 orders comfortably clears the 500ms target. `--stream` mode keeps memory flat regardless of `scaleFactor` by never materializing the full dataset.

The `records/sec` and `relational integrity` badges above read live from [`benchmark-results.json`](./benchmark-results.json), which CI regenerates and commits back to `main` on every push (`.github/workflows/ci.yml`'s `benchmark` job) -- they're real numbers from `scripts/benchmark.mjs` running against the *compiled* `dist/` output, not hand-typed, and not compared against Faker.js or any other library (a fake-value generator and a stateful, relationally-consistent multi-table generator don't produce a fair apples-to-apples "records/sec" number against each other, so this deliberately doesn't claim one). The record count includes all 14 tables `generate()` produces by default (the original 6, the product catalog, and recommendation data) -- it was recalibrated when the catalog and recommendation-data features shipped, since counting only the original 6 tables would have quietly understated real throughput once `generate()` started doing substantially more work per call by default. Run it yourself:

```bash
npm run build && npm run benchmark
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for what's next: an MSW adapter, a framework scaffolding CLI (`npx eco-faker init`), property-based contract testing against live APIs, and the content/promotion plan tying it together.