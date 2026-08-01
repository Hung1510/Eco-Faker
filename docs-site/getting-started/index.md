# Introduction

**eco-faker** is a stateful, relationally-consistent fake-data generator for e-commerce apps. Every `Cart`, `Order`, `Shipment`, and `ReturnRequest` is derived from the same underlying state machine, so the dataset reads like a real store's history instead of unrelated fixtures.

```
Users → Carts → (AbandonedCheckouts | Orders → Shipments → ReturnRequests)
```

## Why eco-faker

- **It's a database, not a pile of JSON.** Every order references a real cart, every shipment a real order, every return a real shipment — financials balance and referential integrity holds by construction. [`lint`](/cli/data-quality#lint)/[`fuzz`](/cli/data-quality#fuzz) exist specifically to break that on purpose so you can test what happens when it doesn't.
- **It's an API, not just a file.** [`serve`](/cli/serve) turns any dataset into a live REST endpoint in one command, with pagination, filtering, chaos testing, auth, and [adapters](/adapters/) for MSW, tRPC, GraphQL, Apollo Client, and React Query.
- **It tests real systems, not just itself.** [`test --contract`/`--mutate`](/testing/) fire real requests at a live API and check it against an OpenAPI contract. `lint --sql --db-url` dry-runs real SQL against a real Postgres. [`warp`](/cli/data-lifecycle#time-travel-regression-warp) replays a fixed scenario at a different point in time.

<p align="center">
  <a href="https://hung1510.github.io/Eco-Faker/">Live browser demo</a> (no install) · <a href="https://github.com/Hung1510/Eco-Faker">GitHub</a> · <a href="https://www.npmjs.com/package/eco-faker">npm</a>
</p>

## Try it in 30 seconds

```bash
npm install -g eco-faker
my-eco-gen generate --scenario black-friday --users 100 --format sql --output ./seed.sql
```

No Node? No problem:

```bash
docker compose up --build
# Postgres @ localhost:5432 (eco/eco/eco_faker) seeded with a Black Friday dataset
```

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

1. **Relational integrity** — every `Cart` belongs to a `User`; every `Order` traces back to a converted `Cart`; a cart never produces both an `Order` and an `AbandonedCheckout`.
2. **Abandonment timing** — `lastActivityDate` falls strictly between `now - abandonmentTimeoutHours` and `now - 3h`.
3. **Tracking realism** — event timestamps strictly increase, valid stage order.
4. **Financial exactness** — `subtotal + tax + shipping === total`, no floating-point drift.
5. **Return eligibility** — only for orders whose every `Shipment` reached `Delivered`.
6. **Determinism** — same `seed` + same `referenceNow` → byte-identical dataset.

## Next

- [Installation](/getting-started/installation) — CLI, library, or from source
- [Quick Start](/getting-started/quick-start) — your first dataset in code
- [Run from Source](/getting-started/run-from-source) — clone, build, test, generate (~2 minutes)
