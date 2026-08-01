# Exports

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

`elasticsearch` writes real Bulk API NDJSON + inferred index mappings per table. `clickhouse` writes real DDL (`ENGINE = MergeTree()`); the data payload reuses the existing CSV output. Postgres isn't a target here — `generate --format sql`/`csv` already cover it.

## Great Expectations export (`ge-export`)

```bash
my-eco-gen generate --users 500 --output ./eco-data.json
my-eco-gen ge-export --input ./eco-data.json --output ./ge-export/
cp ./ge-export/orders.json great_expectations/expectations/orders.json
```

Writes one real [Great Expectations](https://greatexpectations.io/) expectation suite per table, every expectation derived from this exact dataset's actual generated values — column existence and order from the real columns present, not-null only where every real row genuinely has one, uniqueness only for non-float columns where it's actually true (a money/measurement value being unique in a small sample is chance, not a business rule), inferred type, numeric range from the real observed min/max, and an enum-style `value_set` for string columns with few enough distinct values relative to row count. This is a starting baseline meant to be reviewed and loosened, not a finished production suite; `expect_table_row_count_to_be_between` in particular pins the exact row count of this one export and will need widening for anything but revalidating this same data.

## k6 load-test export (`k6-export`)

```bash
my-eco-gen serve --users 500 --port 4000 &
my-eco-gen k6-export --output ./load-test.js --target-url http://localhost:4000
k6 run ./load-test.js
```

Writes a real, runnable [k6](https://k6.io/) load-test script. Two modes: default targets eco-faker's own mock API using its real, current route list; `--contract <openapi.json>` instead derives routes from a real OpenAPI contract, for load-testing an arbitrary real API matching that contract (the same contract [`test --contract`](/testing/contract-testing) validates against). Every route gets a list-endpoint check, plus a get-by-id check using a real id discovered *live* from the list response at k6 run time.

Scope, stated plainly for contract mode: only paths with zero path parameters are treated as list entry points, and a detail sibling is only picked up if that same path plus a single trailing `/{param}` also declares a GET. `--api-key <key>` sends `Authorization: Bearer <key>` on every request, matching `serve --api-key`.

## OpenTelemetry export (`otel-export`)

```bash
my-eco-gen generate --users 200 --output ./eco-data.json
my-eco-gen otel-export --input ./eco-data.json --output ./traces.json
```

Real OTLP/JSON traces: a `checkout` trace per order (spanning `checkout-service`/`payment-service`), a `fulfill_shipment` trace per shipment with spans matching its real tracking-event timeline. `--seed <n>` for reproducible span/trace IDs. Also an MCP tool (`generate_otel_traces`, counts + sample only — use the CLI for the full export).

## AI dataset export (`ai-export`)

Text2SQL pairs, RAG corpus, agent-testing scenarios, and an LLM eval set derived from a real generated dataset. Also an MCP tool (`generate_ai_dataset`).

## Related

- [Data Quality](/cli/data-quality) — `score`, `lint`, `fuzz`, `diff`
- [Database Tools](/cli/db-tools) — `db-snapshot`, `anonymize`
