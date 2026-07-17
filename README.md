# eco-faker

[![CI](https://github.com/Hung1510/Eco-Faker/actions/workflows/ci.yml/badge.svg)](https://github.com/Hung1510/Eco-Faker/actions/workflows/ci.yml)

Stateful, relationally-consistent fake-data generator for e-commerce apps. Not just a pile of random JSON — every `Cart`, `Order`, `Shipment`, and `ReturnRequest` is derived from the same underlying state machine, so the dataset reads like a real store's history instead of unrelated fixtures.

```
Users → Carts → (AbandonedCheckouts | Orders → Shipments → ReturnRequests)
```

**Try it in 30 seconds, no Node install required:**

```bash
docker compose up --build
# Postgres @ localhost:5432 (eco/eco/eco_faker) seeded with a Black Friday dataset
```

## Features

- **Shopping carts** — line items, quantities, status (`active` / `abandoned` / `converted`)
- **Abandoned checkouts** — recovery email timing, coupon offers, recovery outcome
- **Orders** — financially exact (`subtotal + tax + shipping === total`), free-shipping threshold, missing-address edge case
- **Shipment tracking** — realistic multi-stage event histories (`Label Created → Picked Up → In Transit → [Delayed] → Out for Delivery → Delivered`), multi-package orders
- **Return requests** — only for delivered orders, weighted approve/reject/pending, partial or full refunds
- **Scenario presets** — `--scenario black-friday` swaps in a whole tuned config bundle for a recognizable business situation
- **Anomaly injection** — rare, high-value edge cases that stress-test downstream systems (see below)
- **Deterministic** — same seed + same reference time → byte-identical dataset; snapshot/replay for exact reproducibility
- **Three output formats** — JSON, SQL (Postgres-flavored `CREATE TABLE` + `INSERT`), CSV
- **Schema-aware output** — point it at an existing Prisma, Drizzle, or SQLAlchemy schema and it maps its own columns onto yours
- **High-volume streaming** — NDJSON straight to stdout, no dataset ever held fully in memory
- **Interactive web playground** — sliders + live charts + RFM/cohort segmentation, backed by a small Express API
- **One-command Postgres demo** — `docker compose up` generates a scenario and seeds a real database
- **CI-tested** — GitHub Actions runs typecheck/tests/build/smoke-test/CLI e2e on every push, PR, and nightly
- **CLI** — `my-eco-gen generate --users 50 --format sql --output ./seed.sql`

## Install

```bash
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
npm link   # or: npm install -g .
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

## Interactive visual playground

A small full-stack demo: an Express API wrapping the real `generate()` call, and a vanilla-JS + Chart.js frontend with live sliders.

```bash
npm run build
npm run web
# open http://localhost:4173
```

Adjust **Abandonment rate** or **Delay probability** and the cart-status pie chart, shipment-status bar chart (with `Delayed` highlighted), revenue-by-day chart, and a **customer-segment (RFM) doughnut chart + top-10-spenders table** all regenerate in real time from the same generator that powers the CLI — same code, same guarantees, just visualized.

The RFM panel (`GET /api/rfm`) buckets customers into Recency/Frequency/Monetary quartiles and labels them with simple rule-based segments (Champions, Loyal, Big Spenders, At Risk, New/One-time, Hibernating) -- illustrative cohort analytics, not a trained clustering model, but a genuine demonstration of turning generated orders into a business-relevant view.

```
web/
  server.mjs        Express API: GET /api/generate?scaleFactor=&abandonmentRate=&...
                              and GET /api/rfm?scaleFactor=&... (cohort segmentation)
  public/index.html sliders + Chart.js, fetches both endpoints and re-renders
```

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

## Schema introspection & auto-mapping

Point `my-eco-gen` at an existing **Prisma, Drizzle, or SQLAlchemy** schema and it maps its own canonical columns onto yours -- no manual `faker.name() -> user_full_nm` mapping by hand. The schema type is auto-detected from the file extension (`.prisma`, `.ts`/`.js`, `.py`) or set explicitly with `--schema-type`.

```bash
my-eco-gen init --schema ./prisma/schema.prisma --output ./mapping.json          # Prisma
my-eco-gen init --schema ./db/schema.ts --schema-type drizzle -o ./mapping.json # Drizzle
my-eco-gen init --schema ./models.py --schema-type sqlalchemy -o ./mapping.json # SQLAlchemy
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

This is a lightweight, regex-based parser (one per schema dialect) and a token-overlap fuzzy matcher -- not a full AST/type-checker for any of the three ecosystems. It's meant to get you 80% of the way and surface confidence scores for the rest, not to be a silent black box.

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

## Continuous integration

`.github/workflows/ci.yml` runs on every push, PR, and nightly (`workflow_dispatch` also available):

- **Typecheck + unit tests + build** on Node 18.x and 20.x
- **`npm run smoke-test`** -- generates a dataset with every scenario preset against the compiled `dist/` and asserts relational/financial invariants, independent of the vitest suite (catches "the build still runs and produces a sane shape" regressions from dependency bumps)
- **CLI end-to-end** -- generate in all three formats, snapshot+replay byte-identical diff, `--stream` produces valid NDJSON, every scenario preset runs

## Publishing to npm

The package is publish-ready (author, repository, keywords, `LICENSE`, `files` allowlist, `prepublishOnly` running build+test+smoke-test). To publish:

```bash
npm login
npm publish --access public
```

After that, anyone can run `npx eco-faker` -- wait, the bin is `my-eco-gen`, so: `npx --package eco-faker my-eco-gen generate --users 50 --format sql --output ./seed.sql`, or `npm install -g eco-faker` for a plain `my-eco-gen` on `$PATH`.

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
  rng.ts             seeded PRNG (mulberry32) — every probabilistic decision runs through this
  config.ts           defaults, merging (mergeOverrides), ajv schema validation
  scenarios.ts         named business-scenario config presets (black-friday, etc.)
  types.ts             shared TypeScript types
  generator.ts        orchestrates the full pipeline (generate() and the streaming generateRecords())
  modules/
    user/              users + addresses
    cart/               carts, line items, abandoned checkouts
    order/              cart → order conversion, financial math
    tracking/           shipments, tracking event timelines, delays
    return/              return request eligibility + generation
    anomaly/             bot carts, remote-shipping surcharges, contradictory reviews
  introspect/
    prisma.ts            lightweight .prisma schema parser
    drizzle.ts            lightweight Drizzle (pgTable/mysqlTable/sqliteTable) parser
    sqlalchemy.ts          lightweight SQLAlchemy declarative-model parser
    mapper.ts             fuzzy canonical-column -> schema-column matcher (shared by all three)
  output/
    json.ts / sql.ts / csv.ts   (sql.ts and csv.ts accept an optional SchemaMapping)
  cli.ts               `my-eco-gen` entrypoint (generate / replay / init / scenarios)
web/
  server.mjs           Express API for the interactive playground (+ /api/rfm)
  public/index.html    sliders + Chart.js frontend, incl. RFM panel
scripts/
  smoke-test.mjs       CI structural smoke test against compiled dist/
tests/
  relational-integrity.test.ts
  timeline.test.ts
  financial-and-determinism.test.ts
  anomaly.test.ts
  scenarios.test.ts
.github/workflows/
  ci.yml               typecheck/test/build/smoke-test/CLI e2e on push, PR, and nightly
Dockerfile             multi-stage build: compile -> slim runtime with psql baked in
docker-compose.yml     postgres + one-shot seed service
```

## Testing

```bash
npm test              # vitest unit suite
npm run smoke-test    # structural smoke test against compiled dist/ (run after npm run build)
```

36 vitest tests cover relational integrity (no orphaned records), timeline realism (valid event ordering, no future timestamps), financial exactness, determinism, edge cases (missing address, multi-package), anomaly injection (bot carts, remote-shipping surcharges, contradictory returns, the master `anomalies.enabled` switch), and scenario presets (resolution, unknown-scenario errors, and `mergeOverrides` precedence -- including a regression test for a real bug caught during development where explicit CLI flags could silently clobber a scenario's nested `anomalies` config instead of merging with it).

## Performance

Batch generation is O(n) in `scaleFactor` with no repeated I/O. ~800 orders (and their shipments, checkouts, and returns) generate in well under 300ms on a typical dev machine — 1,000 orders comfortably clears the 500ms target. `--stream` mode keeps memory flat regardless of `scaleFactor` by never materializing the full dataset.

