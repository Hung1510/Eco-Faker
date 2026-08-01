---
layout: home

hero:
  name: eco-faker
  text: Stateful, relational fake e-commerce data
  tagline: Every Cart, Order, Shipment, and ReturnRequest is derived from the same underlying state machine — so the dataset reads like a real store's history, not unrelated fixtures.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: CLI Reference
      link: /cli/
    - theme: alt
      text: View on GitHub
      link: https://github.com/Hung1510/Eco-Faker

features:
  - title: It's a database, not a pile of JSON
    details: Every order references a real cart, every shipment a real order, every return a real shipment — financials balance and referential integrity holds by construction.
  - title: It's an API, not just a file
    details: "`serve` turns any dataset into a live REST endpoint in one command — pagination, filtering, chaos testing, auth, and adapters for MSW, tRPC, GraphQL, Apollo Client, and React Query."
  - title: It tests real systems, not just itself
    details: "`test --contract`/`--mutate` fire real requests at a live API against an OpenAPI contract. `lint --sql --db-url` dry-runs real SQL against real Postgres."
---

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

## The data model

```
Users → Carts → (AbandonedCheckouts | Orders → Shipments → ReturnRequests)
```

Head to [Getting Started](/getting-started/) for the full installation and quick-start walkthrough, or jump straight to the [CLI Reference](/cli/) if you already know what you're looking for.
