# eco-faker

Stateful, relationally-consistent fake-data generator for e-commerce apps. Not just a pile of random JSON — every `Cart`, `Order`, `Shipment`, and `ReturnRequest` is derived from the same underlying state machine, so the dataset reads like a real store's history instead of unrelated fixtures.

```
Users → Carts → (AbandonedCheckouts | Orders → Shipments → ReturnRequests)
```

## Features

- **Shopping carts** — line items, quantities, status (`active` / `abandoned` / `converted`)
- **Abandoned checkouts** — recovery email timing, coupon offers, recovery outcome
- **Orders** — financially exact (`subtotal + tax + shipping === total`), free-shipping threshold, missing-address edge case
- **Shipment tracking** — realistic multi-stage event histories (`Label Created → Picked Up → In Transit → [Delayed] → Out for Delivery → Delivered`), multi-package orders
- **Return requests** — only for delivered orders, weighted approve/reject/pending, partial or full refunds
- **Anomaly injection** — rare, high-value edge cases that stress-test downstream systems (see below)
- **Deterministic** — same seed + same reference time → byte-identical dataset; snapshot/replay for exact reproducibility
- **Three output formats** — JSON, SQL (Postgres-flavored `CREATE TABLE` + `INSERT`), CSV
- **Schema-aware output** — point it at an existing Prisma schema and it maps its own columns onto yours
- **High-volume streaming** — NDJSON straight to stdout, no dataset ever held fully in memory
- **Interactive web playground** — sliders + live charts, backed by a small Express API
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

## Interactive visual playground

A small full-stack demo: an Express API wrapping the real `generate()` call, and a vanilla-JS + Chart.js frontend with live sliders.

```bash
npm run build
npm run web
# open http://localhost:4173
```

Adjust **Abandonment rate** or **Delay probability** and the cart-status pie chart, shipment-status bar chart (with `Delayed` highlighted), and revenue-by-day chart all regenerate in real time from the same generator that powers the CLI — same code, same guarantees, just visualized.

```
web/
  server.mjs        Express API: GET /api/generate?scaleFactor=&abandonmentRate=&...
  public/index.html sliders + Chart.js, fetches /api/generate and re-renders
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

Point `my-eco-gen` at an existing Prisma schema and it maps its own canonical columns onto yours -- no manual `faker.name() -> user_full_nm` mapping by hand.

```bash
my-eco-gen init --schema ./prisma/schema.prisma --output ./mapping.json
```

```
Parsed 2 model(s) from ./prisma/schema.prisma.
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

This is a lightweight, regex-based Prisma parser and token-overlap fuzzy matcher -- not a full AST/type-checker. It's meant to get you 80% of the way and surface confidence scores for the rest, not to be a silent black box.

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
  config.ts           defaults, merging, ajv schema validation
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
    mapper.ts             fuzzy canonical-column -> schema-column matcher
  output/
    json.ts / sql.ts / csv.ts   (sql.ts and csv.ts accept an optional SchemaMapping)
  cli.ts               `my-eco-gen` entrypoint (generate / replay / init)
web/
  server.mjs           Express API for the interactive playground
  public/index.html    sliders + Chart.js frontend
tests/
  relational-integrity.test.ts
  timeline.test.ts
  financial-and-determinism.test.ts
  anomaly.test.ts
```

## Testing

```bash
npm test
```

29 tests cover relational integrity (no orphaned records), timeline realism (valid event ordering, no future timestamps), financial exactness, determinism, edge cases (missing address, multi-package), and anomaly injection (bot carts, remote-shipping surcharges, contradictory returns, and the master `anomalies.enabled` switch).

## Performance

Batch generation is O(n) in `scaleFactor` with no repeated I/O. ~800 orders (and their shipments, checkouts, and returns) generate in well under 300ms on a typical dev machine — 1,000 orders comfortably clears the 500ms target. `--stream` mode keeps memory flat regardless of `scaleFactor` by never materializing the full dataset.

