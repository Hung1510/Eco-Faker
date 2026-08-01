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

## 📖 Full documentation

**This README is a landing page, not the reference.** The complete docs -- every command, every flag, every adapter, with worked examples -- live at the documentation site, built from [`docs-site/`](./docs-site) (VitePress):

| | |
|---|---|
| 🚀 [**Getting Started**](./docs-site/getting-started/) | Installation, quick start, run from source |
| 💻 [**CLI Reference**](./docs-site/cli/) | Every subcommand: `generate`, `serve`, data quality, exports, scaffolding, MCP |
| 📚 [**Library API**](./docs-site/api/) | `generate()`/`serialize()`, scenarios, configuration, unique values |
| 🔌 [**Adapters**](./docs-site/adapters/) | MSW, tRPC, GraphQL, React Query, Apollo Client |
| 🧪 [**Testing**](./docs-site/testing/) | Contract/mutation/scenario/Gherkin testing, plus 7 real example projects |
| 🤝 [**Contributing**](./docs-site/contributing/) | Dev setup, project layout, CI, publishing, VS Code extension |

Run it locally: `cd docs-site && npm install && npm run docs:dev`

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

## Run it from source (~2 minutes)

```bash
git clone https://github.com/Hung1510/Eco-Faker.git
cd Eco-Faker
npm install
npm run build
npm test
node dist/cli.js generate --users 50 --seed 1 --scenario black-friday --format json --output ./eco-data.json
node dist/cli.js serve --users 50 --seed 1 --port 4000 &
curl "http://localhost:4000/api/orders?status=delivered&pageSize=5"
```

See [Run from Source](./docs-site/getting-started/run-from-source.md) for the full walkthrough, including the exact verification pass CI runs.

## What's inside, at a glance

Full-fidelity e-commerce data generation (product catalog, recommendations, inventory, support tickets, transactional emails, fraud/anomaly injection, 73 locales) · a mock REST API (`serve`) with chaos mode, auth, live feeds, and OpenAPI/Postman export · adapters for MSW, tRPC, GraphQL, React Query, and Apollo Client -- no server required · contract/mutation/scenario/Gherkin testing against any live API · data-quality tooling (`lint`, `fuzz`, `score`, `diff`) · exports to SQL/CSV/Elasticsearch/ClickHouse/Great Expectations/k6/OpenTelemetry · framework scaffolding for Next.js, MSW, Prisma, Drizzle, and SQLAlchemy · an MCP server · a VS Code extension · and more.

See the [CLI Reference](./docs-site/cli/) for the complete, current list -- this README no longer tries to enumerate every feature itself.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for what's next and the full history of what's been built, why, and every real bug found along the way.
