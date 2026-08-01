# generate

```bash
my-eco-gen generate --users 50 --format sql --output ./seed.sql

my-eco-gen generate \
  --users 100 --format json --output ./data/eco.json --seed 7 \
  --abandonment-rate 0.45 --delay-probability 0.25 --max-delay-days 5
```

`my-eco-gen generate --help` for the full flag list — every flag maps 1:1 to `config.schema.json` (see [Configuration](/api/configuration)).

## Product catalog

```bash
my-eco-gen generate --users 300 --catalog-size 200
```

A 2-level category tree, brands, suppliers, and products with variants (`storage`, `color`, own `sku`/`priceDelta`/`stockLevel`). `LineItem.productId` on every cart/order/shipment resolves to a real product. Available through `serve`, all [adapters](/adapters/), SQL/CSV output, and `init --schema`. `--catalog-size` controls product count (default 150).

## Synthetic recommendation data

```
User -> View Product -> Add Wishlist -> Purchase -> Review
```

```bash
my-eco-gen generate --users 300
my-eco-gen generate --users 300 --no-recommendation-data   # disable
```

Four tables (`productViews`, `searchQueries`, `wishlistItems`, `productRatings`), grounded in the rest of the dataset — every purchased product was viewed beforehand, ratings only exist on delivered orders, wishlist items never predate a purchase. Runs on its own decoupled RNG stream, so toggling it changes nothing else.

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

Five email types (order confirmation, shipping/delivery notification, return confirmation, cart-abandonment recovery), each grounded in a real timestamp elsewhere in the dataset. Also: varied, product-name-interpolated review text (`productRatings[].reviewText`). See [`mail`](/cli/mail-and-webhook) to replay these into a real local inbox.

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

Explicit flags win over the scenario (`--scenario black-friday --users 50` keeps Black Friday's tuning but only 50 users). See [Scenarios](/api/scenarios) for the library API (`SCENARIOS`, `resolveScenario`, `mergeOverrides`).

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

One dataset whose config varies over calendar time — three built-in profiles (`holiday-arc`, `supply-chain-decline`, `flash-sale-week`), or author your own:

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

Segments must be contiguous and the last must end at `toDaysAgo: 0`. Implemented as N merged `generate()` calls, not a core-loop change — each segment gets its own independent user pool and catalog (no cross-segment returning customers). Also an MCP tool (`generate_temporal_dataset`).

## Multi-store / multi-tenant mode

```bash
my-eco-gen generate --stores 5 --users 200 --format json --output ./marketplace.json
```

N independent, distinctly-seeded stores. JSON output only for now.

## Anomaly injection

`config.anomalies` injects realistic, rare edge cases:

| Anomaly | Trigger | What it does |
|---|---|---|
| Bot activity | `botCartRate` (0.02) | Cart gets 50-120 line items, 2-4am timestamp |
| Remote-shipping surcharge | `remoteShippingRate` (0.05) | Real $24.99 freight surcharge added to shipping/total |
| Contradictory review | `contradictoryReturnRate` (0.01) | Negative-reason return with a perfect `csatScore: 5` |

Tagged, not hidden — check `record.anomaly?.type`/`.note`.

```bash
my-eco-gen generate --users 500 --bot-cart-rate 0.05 --no-anomalies
```

## Fraud simulation engine

```bash
my-eco-gen generate --users 500 --fraud-rate 0.03
```

Six fraud types with a `riskScore` (0-100) and evidence `signals`: `account_farming`, `reseller_behavior`, `refund_abuse`, `friendly_chargeback`, `stolen_card`, `coupon_abuse_ring`. `--fraud-types`, `--fraud-seed`. JSON-only metadata (not in SQL/CSV). Also an MCP tool (`fraud_simulate`).

## High-volume stream mode

```bash
my-eco-gen generate --users 100000 --stream > eco.ndjson
```

One NDJSON line per record as it's produced, honoring stdout backpressure — no dataset ever fully materialized.

```ts
import { generateRecords } from "eco-faker";
for (const { table, record } of generateRecords({ scaleFactor: 100000 })) { /* ... */ }
```

## Locale support

```bash
my-eco-gen locales
# 73 supported locales (derived from the installed @faker-js/faker):
# af-ZA, ar, az, ..., zh-CN, zh-TW, zu-ZA

my-eco-gen generate --users 200 --locale ja --format json --output ./eco-data.json
```

Every real locale [@faker-js/faker](https://fakerjs.dev) ships (73 at time of writing) — names, addresses, and currency formatting all follow `--locale`/`config.locale`. Computed dynamically from the installed dependency's own real locale exports, not a hand-maintained list — a future `@faker-js/faker` version adding a locale means eco-faker gains it automatically. Joke locales (`en_BORK`, `en_AU_ocker`) are filtered out. Four legacy names (`es-ES`/`de-DE`/`fr-FR`/`vi-VN`) are kept working for backward compatibility.

A handful of locales genuinely lack certain address fields in faker-js's own data — `ro-MD` has no state/region concept at all, and `en-HK` has no postal codes. Those fields come back as an empty string rather than a fabricated value.

## Related

- [Configuration](/api/configuration) — the full `config.schema.json` reference
- [Scenarios](/api/scenarios) — library API for scenario presets
- [Unique Values](/api/unique-values) — `createUniqueTracker`, guaranteed-unique emails
