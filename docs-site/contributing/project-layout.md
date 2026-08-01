# Project Layout

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
  db-snapshot.ts               live-Postgres snapshot + anonymization (`db-snapshot`)
  anonymize.ts                 shared anonymization primitives + CSV parser + file loader (`anonymize`, and db-snapshot.ts's Postgres path)
  k6-export.ts                 real k6 load-test script generation (`k6-export`)
  scaffold.ts                 templates for `init next` / `init msw`
  orm-scaffold.ts              real ORM seed scripts for `init prisma`/`init drizzle`/`init sqlalchemy`
  score.ts                   realism-score engine (`score`)
  docs.ts                     documentation heading parsing (`docs`)
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
  index.html / explorer.html / mapping-designer.html   static demos, no server
  src/app.ts / explorer.ts     import src/browser.ts directly
examples/
  scenarios/full-lifecycle.yaml   real, runnable example for `test --scenario`
  express-shopify-backend/, nextjs-app-router/, graphql-apollo/, msw-vitest/,
  playwright-e2e/, react-query/, cli-serve-contract-test/    full example projects, see Testing -> Example Projects
scripts/
  smoke-test.mjs           CI structural smoke test against compiled dist/
  perf-regression.mjs       generation-time/memory regression check against a stored baseline
docs-site/
  full VitePress documentation site (this site) -- see docs-site/README.md if contributing to docs
.github/workflows/
  ci.yml                   typecheck/build/test/smoke-tests, CLI e2e, mock-API e2e, all example projects
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

## Related

- [Library API](/api/) — the public exports from `index.ts`/`browser.ts`
- [Continuous Integration](/contributing/ci) — what each CI job actually runs
