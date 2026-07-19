# eco-faker roadmap: growth-focused features

Scoped 2026-07-18. Ordered by effort-to-reach ratio, not necessarily build order.
Each entry: what it is, why it should move adoption, and a concrete first slice.

---

## 1. MSW (Mock Service Worker) adapter -- lowest effort, widest reach -- SHIPPED 2026-07-18

**What:** `import { toMswHandlers } from "eco-faker/msw"` -- takes a `Dataset` (or
the same options `generate()` takes) and returns an array of MSW `http.get(...)`
request handlers, one per table, with the same filtering/pagination/sort
behavior `serve` already has.

**Why:** MSW is the default mocking layer for a large share of the
React/Next.js/Vue testing world. Nothing about eco-faker's actual data model
changes -- this is a second transport for data that's already generated, so
it's mostly plumbing, not new product surface. It puts eco-faker in front of
people who'd never spin up a standalone server but already have
`setupServer()` in their test setup.

**Shipped as built:** `src/msw.ts`, reusing `applyFiltersToRecords`/
`applySortToRecords`/`paginateRecords`/`resolveMeaning` exported from
`serve.ts` -- one implementation, two adapters, verified identical by a test
that asserts the same query behaves the same way through both. One thing the
original scope missed: MSW's relative-path patterns only resolve against
`window.location`, which doesn't exist in plain Node -- handlers use the
wildcard-origin form (`*/api/orders`) instead, which is also strictly more
correct for a reusable library (consumers fetch against all kinds of
origins, not just bare `localhost`). See README's "MSW adapter" section for
usage; `tests/msw.test.ts` for coverage.

**Effort:** ~1-2 days including tests. **Risk:** low -- pure addition, no
changes to existing exports.

---

## 2. Property-based contract testing (`my-eco-gen test --contract`)

**What:** already speced in a prior session -- fires generated stateful
scenarios at a live API and asserts response shape/values against a
contract file:
```
my-eco-gen test --url https://api.example.com --contract ./contract.yaml
```
Paired with the time-travel companion feature:
```
my-eco-gen warp --snapshot ./snap.json --days +30
```
for replaying/regression-testing a dataset's evolution over time.

**Why:** this is the one capability nothing else in the fake-data-generator
space has. Faker.js and its clones are static generators; none of them
assert live API behavior against generated, stateful scenarios. This is the
feature that's actually worth a "Show HN" / blog post, because it's a new
category, not a nicer version of an existing one.

**Status:** intentionally on hold per prior discussion -- full design doc
exists from that session. Recommend reviving this first if the goal is
differentiation/press over raw reach, since #1 and #4 compound whatever
this generates.

**Effort:** multi-week -- this is a real feature, not a bolt-on. Scope it as
its own milestone rather than folding into a patch release.

---

## 3. Framework scaffolding CLI (`npx eco-faker init`)

**What:** an interactive or flag-driven scaffold command that wires
generated data straight into a target project's existing setup instead of
leaving the user to glue it in by hand:
```
npx eco-faker init next        # writes a seed script + API route using generated data
npx eco-faker init prisma      # generates a seed.ts that inserts via an existing Prisma schema
npx eco-faker init drizzle
npx eco-faker init msw         # writes a setupServer() file using #1's adapter
```

**Why:** most npm package abandonment happens in the first couple of
minutes after install, right at the "now what" moment. `--schema` mapping
already exists for Prisma/Drizzle/SQLAlchemy -- this just turns that mapping
into a zero-thought starting file instead of requiring the user to write
the seed script themselves.

**First slice:** start with `init next` and `init msw` only (msw depends on
#1 shipping first) -- those two cover the largest share of likely users
without building out every framework's template up front.

**Effort:** ~2-3 days for two templates + the `init` command scaffolding
itself (template copy + `{{placeholders}}` substitution, no need for a full
template engine).

---

## 4. Content & promotion push

**What:** not code. Concretely:
- A comparison writeup: eco-faker vs. Faker.js on relational consistency
  (the core differentiator -- carts reference real users, shipments
  reference real orders, financials balance exactly).
- Submission to `awesome-nodejs`, `awesome-testing`, and similar curated
  lists -- cheap, durable discovery channel.
- A Show HN / dev.to post timed to coincide with whichever of #1-#3 ships
  next, not published in isolation -- "look what's new" performs better
  than "look what exists."

**Why:** a good chunk of adoption for tools like this comes from content
surfacing the tool to people already searching for the problem it solves,
not from the tool itself getting better. This is the cheapest lever on the
list and compounds with any of the above.

**Effort:** ~1 day for the writeup + list submissions; timing is the main
constraint, not effort.

---

## Suggested order

1. **Response meaning / request logging** -- shipped 2026-07-18.
2. **MSW adapter** -- shipped 2026-07-18.
3. **Semantic fuzzing, offline lint, journey visualizer** -- shipped 2026-07-18 (external proposal, see below); the live-firing halves of fuzzing and lint (contract assertions, real Postgres dry runs) remain scoped but not built.
4. **Content push** -- write the comparison post now that there are three fresh "what's new" hooks to draw on.
5. **Framework scaffolding CLI** -- `init next` + `init msw`.
6. **Contract testing** -- the multi-week investment. This also unblocks the deferred half of semantic fuzzing (`fuzz --contract`, firing mutated payloads at a live API), so it's worth prioritizing once there's a dedicated block of time.

---

## Shipped: response meaning + request logging (2026-07-18)

Small, immediate version of "add more information" -- every `/api/*`
response now carries an `X-Eco-Faker-Meaning` header with a plain-English
description (`"order fetched -- purchase confirmed"`, `"rate limit hit
(simulated chaos)"`, etc.), and `serve` prints a colored, human-readable
line per request by default:

```
GET /orders 200 -- orders fetched successfully (3ms)
GET /orders/ord_a1b2 200 -- order fetched -- purchase confirmed (1ms)
GET /orders 429 -- rate limit hit (simulated chaos) (2ms)
GET /users 500 -- internal server error (simulated chaos) (7ms)
```

Disable with `--quiet` (the header is still sent either way). This also
makes `serve --chaos` demos/GIFs read better at a glance -- the terminal
output is legible without needing to decode bare status codes.

---

## Shipped: MSW adapter (2026-07-18)

See item #1 above -- `eco-faker/msw`, `toMswHandlers(dataset, { basePath? })`.

---

## Shipped: semantic fuzzing, offline lint, journey visualizer (2026-07-18)

Externally proposed as a ranked three-item list (semantic fuzzing, an
"interactive journey canvas," a pre-flight database linter). All three had
a genuinely buildable core; each also had a piece that depends on
infrastructure this project doesn't have yet, which is called out honestly
below rather than faked.

### Semantic fuzzing (`my-eco-gen fuzz`) -- built

`src/fuzz.ts`, `applySemanticFuzzing(dataset, options)`. Four mutation
types -- `address_mismatch`, `price_inversion`, `time_paradox`,
`inventory_oversell` -- each producing a record that's still schema-valid
but logically impossible (see README's "Semantic fuzzing" section for the
exact mechanics of each). Deterministic per `--fuzz-seed`, restrictable via
`--types`, scales via `--intensity low|medium|extreme`. 9 tests in
`tests/fuzz.test.ts`, including a fuzz→lint integration test proving the
mutations are actually detectable.

**Deferred, and why:** the original proposal's exact syntax
(`my-eco-gen fuzz --contract ./contract.yaml`) implies firing mutated
payloads at a live API and asserting against a contract -- that assertion
substrate is the contract-testing engine from item #2 above, which isn't
built. `fuzz` today mutates data and writes it to disk; wiring it into a
live-HTTP-assertion pipeline is a natural extension once #2 exists, not a
separate feature.

### Pre-flight lint (`my-eco-gen lint`) -- built, in two tiers

`src/lint.ts`. **Offline tier (default, fully built and tested):**
`lintDataset(dataset)` checks referential integrity (orphaned foreign
keys), uniqueness (duplicate ids, duplicate emails), and financial/temporal
consistency (line items summing to order totals, no return predating its
order) entirely in memory -- no database needed, so it runs in any CI
without provisioning anything. 8 tests in `tests/lint.test.ts`.

**Live-Postgres tier (built, not exercised by tests):**
`lintSqlAgainstDatabase(sql, databaseUrl)` runs a real `.sql` file inside
`BEGIN; ...; ROLLBACK;` against a real Postgres instance, via the `--sql
--db-url` CLI flags. This is real, correct code -- but it requires the
optional `pg` package and a reachable database, which this sandbox/CI
doesn't have, so it's genuinely untested end-to-end. Treat it as
implemented-but-unverified until it's run against a real instance.

### Journey visualizer (`my-eco-gen visualize`) -- built, fully verified

`src/visualize.ts`. `buildUserJourney` assembles one user's full lifecycle
(signup → carts → checkout recovery → orders → shipment tracking events →
returns) into a chronological timeline; `renderJourneyHtml` draws it as an
animated D3 swimlane. One real bug caught and fixed during build: the
original design loaded D3 from a CDN (`cdnjs.cloudflare.com`), which
silently fails (blank chart, no error surfaced to the user) anywhere
without outbound network access -- verified via an actual headless-browser
screenshot, not just a passing unit test. Fixed by vendoring D3's
ISC-licensed bundle into `assets/d3.v7.min.js` and inlining it directly
into the generated HTML, so the output is genuinely self-contained and
renders correctly from a plain `file://` URL with zero network access.
9 tests in `tests/visualize.test.ts`.

---

## Shipped: MCP server, tRPC/GraphQL adapters, live OpenAPI inference, benchmark badges, hosted-playground deploy config (2026-07-18)

Five more items, in priority order (MCP first as the single highest-leverage
addition; the rest rounding out the "adapter" story and discovery surface).

### MCP server (`my-eco-gen mcp`) -- built, fully verified

`src/mcp.ts`. Six tools (`generate_dataset`, `query_table`, `fuzz_dataset`,
`lint_dataset`, `visualize_journey`, `list_scenarios`) over stdio, the
standard local-MCP-client transport. Datasets are kept server-side in an
in-memory store (capped at 20, oldest evicted) and referenced by a UUID
across calls, so an agent never needs the full dataset to round-trip
through its context -- it generates once, then queries/fuzzes/lints/
visualizes against that id. Verified two ways: 9 tests in `tests/mcp.test.ts`
using the SDK's real `Client` against a real `McpServer` over
`InMemoryTransport`, *and* a real stdio subprocess smoke test (spawning
`node dist/cli.js mcp` and talking to it exactly like Claude Desktop would)
-- both pass. This is also now a CI job (`adapters-e2e`), not just a local
check.

### tRPC adapter (`eco-faker/trpc`) -- built, fully verified

`src/trpc.ts`. One sub-router per table (camelCased route names), `list`/
`byId` procedures, reusing the same `applyFiltersToRecords`/
`applySortToRecords`/`paginateRecords` helpers as `serve` and the MSW
adapter -- three adapters now share one filter/sort/paginate
implementation. 8 tests in `tests/trpc.test.ts` using a real
`createCallerFactory` server-side caller (executes actual resolvers, no
HTTP layer needed to verify it).

### GraphQL adapter (`eco-faker/graphql`) -- built, fully verified

`src/graphql.ts`. One `<table>(filters, sort, order, page, pageSize)` field
and one `<table>ById(id)` field per table, built with raw `graphql-js`
(no `@graphql-tools` dependency). Records and filters use a `JSON` scalar
rather than six hand-typed resource shapes -- documented as a deliberate
simplification, not an oversight, with the equivalent SDL also exported as
a starting point for anyone who wants concrete types. 8 tests in
`tests/graphql.test.ts` executing real queries via `graphql()`.

### Schema-from-live-API inference -- built, verified over a real HTTP round trip

`src/introspect/openapi.ts`, wired into the existing `my-eco-gen init`
command (`--schema-type openapi`, auto-detected from a `.json` extension or
an `http(s)://` URL). Reuses the *existing* `ParsedSchema` shape and
`buildSchemaMapping` engine the Prisma/Drizzle/SQLAlchemy parsers already
used -- this was a new parser plugged into existing infrastructure, not a
parallel system. Supports OpenAPI 3.x (`components.schemas`) and Swagger
2.0 (`definitions`). 6 unit tests plus a genuinely useful self-referential
dogfood test: generate a dataset, build its own OpenAPI spec, feed that
spec back into the parser, and confirm every canonical table finds a
confident match against its own schema. Also verified for real over an
actual HTTP round trip -- ran `my-eco-gen serve`, then pointed
`my-eco-gen init --schema http://localhost:.../openapi.json` at the live
running instance: **100% confident matches across all six tables**. That
exact flow is now a CI step (`adapters-e2e`), not just a manual check.

### Benchmark badges -- built, real numbers, live-updating

`scripts/benchmark.mjs` measures generation speed and relational integrity
(via `lintDataset`) against the *compiled* `dist/` output, writes
`benchmark-results.json`, and a new CI job (`benchmark`, main-branch pushes
only) runs it and commits the result back. Two README badges read that
file live via shields.io's dynamic-JSON badge endpoint, so they track real
numbers instead of being hand-typed and going stale. Deliberately does
*not* compare against Faker.js or any other library -- a fake-value
generator and a stateful relational-dataset generator don't have a fair
apples-to-apples "records/sec" number, and a benchmark implying otherwise
would be misleading rather than honest marketing. Real first measurement:
13,842 records/sec, 100% relational integrity, 0 lint issues, at
`scaleFactor: 1000` on the machine this was built on.

**One thing not independently verifiable from here:** the shields.io badge
URLs follow their documented dynamic-JSON pattern but weren't rendered and
visually confirmed (this sandbox can't reach `img.shields.io`) -- check
they actually render once pushed.

### Hosted playground API -- deploy config built, not deployed

`Dockerfile.serve` (separate from the root `Dockerfile`, which is built for
the one-shot Postgres-seed demo and exits after seeding), `render.yaml`,
and `fly.toml`. The shell command the container runs
(`node dist/cli.js serve --port ${PORT:-4000} ...`) was verified directly
against a real `$PORT` env var outside Docker -- binds and serves
correctly. **What's not done, and can't be done from here:** actually
deploying it. That requires connecting a real Render or Fly account, which
needs the repo owner's credentials -- config-as-code is the honest limit of
what's buildable without that.

---

## Shipped: fraud simulation engine, `serve --graphql` (2026-07-18)

From an externally proposed 14-item list. Most of that list (Product
Catalog, Recommendation Data, Analytics Dashboard, Event Sourcing Mode, AI
Dataset Mode, Inventory Simulation, Temporal Scenario Engine, Scenario
Composer, OpenTelemetry, Benchmark Dataset Generator, Interactive
Relationship Explorer) was explicitly *not* attempted in this pass --
several are genuinely multi-day-to-multi-week efforts each, several depend
on each other (a real Product Catalog needs to exist before Recommendation
Data or an Analytics Dashboard can honestly reference real products), and
attempting all of them in one pass would have meant either blowing up
scope uncontrollably or shipping shallow, unverified stubs -- which would
have undermined the tested-and-verified standard every other feature in
this repo has held. See "Remaining items from the 14-item list" below for
the honest, dependency-ordered scope of what's left.

### Fraud simulation engine (`generate --fraud-rate`) -- built, fully verified, one real bug caught and fixed

`src/fraud.ts`. Six fraud types (`stolen_card`, `account_farming`,
`reseller_behavior`, `refund_abuse`, `friendly_chargeback`,
`coupon_abuse_ring`), each producing a `riskScore` + evidence `signals` on
a subset of orders -- in the shape a real fraud-detection system's output
would take, per the original request's own example. Deliberately grounded
in real structure where it matters rather than being label-only everywhere:
`account_farming` genuinely overwrites other users' addresses to match
(queryable, not just asserted), `reseller_behavior` genuinely bumps a line
item's quantity while keeping `lineTotal`/`subtotal`/`total` correctly
recomputed, and `refund_abuse`/`friendly_chargeback` are only ever assigned
to orders with a real linked `ReturnRequest`.

**A real bug, caught by the test suite doing its job:** the first version
of `account_farming` recorded its "shared with N accounts" claim at the
moment each order was tagged, but with a high fraud rate, a *later*
`account_farming` event could re-target a user that an *earlier* signal's
claim depended on -- silently invalidating that earlier signal's evidence.
A test that independently re-verified the claimed count against final
dataset state (rather than trusting the number the code itself produced)
caught this. Fixed by tracking already-farmed user ids across the whole
run so no account gets double-assigned. 11 tests in `tests/fraud.test.ts`,
plus a `fraud_simulate` MCP tool (bringing the server to seven tools) and
real end-to-end CLI verification (`generate --users 500 --fraud-rate 0.03
--scenario black-friday` on a live run, output inspected directly).

### `serve --graphql` -- built, fully verified over a real HTTP round trip

Mounts the exact same `toGraphQLSchema` adapter directly on `serve` as
`POST /graphql` (`GET /graphql` returns a usage hint), so trying the
GraphQL adapter doesn't require wiring it into your own server first.
Dynamically imports both `./graphql.js` and the optional `graphql` package
so `serve` still works with zero GraphQL-related dependencies installed
when `--graphql` isn't passed. Verified with a real running server and
real `curl` POST requests (filters, pagination, and an intentionally
invalid query to confirm GraphQL errors surface in the response body
rather than crashing the server), plus 4 new tests in
`tests/serve-webhook-diff.test.ts`.

---

## Remaining items from the 14-item list -- dependency-ordered scope

Ordered by what has to exist before what, not by the original ranking --
several of the "⭐⭐⭐⭐⭐" items are blocked on a foundational piece that
wasn't ranked as highly.

**Tier 0 -- foundational, unblocks the most -- SHIPPED 2026-07-18:**
1. **Product Catalog Generator** -- see "Shipped: Product Catalog
   Generator" below for the full writeup. Categories (2-level tree),
   brands, suppliers, products with variants, and -- the part that
   actually matters -- every cart/order/shipment line item now resolves
   to a real, shared product instead of an independently invented one.
   Unblocks #2, #4 (renumbered #3 below), #7, and #12.

**Tier 1 -- real efforts, buildable now that Tier 0 exists -- ALL FOUR ITEMS SHIPPED 2026-07-18/19. Tier 1 is complete.**
2. ~~**Synthetic Recommendation Data**~~ -- see "Shipped: Synthetic
   Recommendation Data" below for the full writeup.
3. ~~**Analytics Dataset Generator**~~ -- see "Shipped: Analytics
   Dataset Generator" below for the full writeup.
7. ~~**Inventory Simulation**~~ -- see "Shipped: Inventory Simulation"
   below for the full writeup.
12. ~~**Benchmark Dataset Generator**~~ -- see "Shipped: Benchmark
    Export" below for the full writeup.

**Tier 2 -- independent, no dependency on Tier 0 -- item #5 SHIPPED 2026-07-19:**
5. ~~**Event Sourcing Mode**~~ -- see "Shipped: Event Sourcing Mode"
   below for the full writeup.
6. **AI Dataset Mode** (support tickets, chat messages, reviews, emails as
   free text) -- independent of the catalog, but a different kind of work
   entirely: this is about generating plausible *prose*, not structured
   records, which the rest of this codebase doesn't currently do at all.
9. **Temporal Scenario Engine** (revenue arcs for Christmas spikes, supply
   chain crises, recessions over real calendar time) -- partially
   overlaps with existing scenario presets (`black-friday`,
   `supply-chain-crisis`) but wants time-varying behavior *within* a
   single generate call rather than a fixed config; a real extension to
   the generator's core loop, not additive like `fuzz`/`fraud` were.
10. **Scenario Composer** (`inherits: [...]` + `overrides: {...}` YAML,
    user-authored scenario files) -- independent and genuinely useful;
    `mergeOverrides` already exists and does most of the hard part, this
    is mainly a YAML-parsing + inheritance-resolution CLI command on top
    of it. Best remaining Tier-2 pick.
11. **OpenTelemetry Integration** (fake traces across API/payment/
    inventory/shipping services) -- independent, but a different domain
    (distributed tracing) from anything else in this repo; would need a
    real OTel SDK dependency and its own data model (traceId/spanId/
    latency trees), not an extension of the existing `Dataset` shape.
14. **Interactive Relationship Explorer** (clickable web UI for User →
    Orders → Shipment → Returns) -- a genuine web UI project, similar
    scope to the existing playground but for entity relationships instead
    of aggregate stats; independent of everything else on this list.

**Not on this list because already shipped:** #8 GraphQL Server
(`eco-faker/graphql` + `serve --graphql`, both above), Tier 0's Product
Catalog Generator (below), and the Prisma/Drizzle/SQLAlchemy/OpenAPI half
of #13 SQL Seeder Generator (`my-eco-gen init`) -- TypeORM and Laravel
specifically aren't covered by `init` yet, which is a real, small gap if
#13 comes up again.

---

## Shipped: Product Catalog Generator (2026-07-18)

Tier 0 from the list above. Categories, Brands, Suppliers, and Products
(with Variants) as four new top-level `Dataset` tables, and -- the part
that actually matters, not just adding tables nobody reads from --
`LineItem` generation across carts, orders, and shipments now draws from
this shared pool instead of inventing an independent fake product per
line item. Verified: the same product genuinely recurs across many
different orders (100+ products referenced by more than one line item in
a typical run), and `lint`'s new referential check confirms every single
line item's `productId` resolves to a real product.

**Design choice worth knowing:** `LineItem`'s own type didn't change at
all -- `productId`/`sku`/`name`/`unitPrice` are now *populated from* a
real product/variant instead of being independently faked, but every
existing consumer of `LineItem` (shipment package-splitting, `fuzz`,
`fraud`, `lint`, the OpenAPI `LineItem` schema, every adapter) needed zero
changes. The four adapters (`serve`, MSW, tRPC, GraphQL) and both
structured output formats (SQL, CSV) also needed zero *logic* changes --
they're generic over `TABLE_ROUTES`/`CANONICAL_COLUMNS`, so the new tables
just showed up once added to those two lists. The real, necessary ripple
was: `types.ts` (new interfaces + config field), a new `modules/catalog/`
generator module, `mapper.ts` (canonical columns), `output/sql.ts` +
`output/csv.ts` (hand-written per-table blocks, following the existing
pattern), `openapi.ts` (hand-written per-table schema definitions -- this
one *doesn't* auto-generate from `TABLE_ROUTES`, see below), and `lint.ts`
(new referential checks).

**Three real bugs found and fixed while building this**, all caught by
tests that either independently re-verified a claim or exercised the full
pipeline end-to-end rather than checking that code merely ran without
throwing:

1. **`openapi.ts` silently omitted the new routes.** Unlike `serve`,
   `msw.ts`, `trpc.ts`, `graphql.ts`, and `postman.ts` -- which are all
   generic over `TABLE_ROUTES` -- `buildOpenApiSpec` iterates its own
   separately-maintained `RESOURCE_SCHEMAS` object. Adding the catalog
   tables to `TABLE_ROUTES` alone made them live and servable via `serve`,
   but they were completely absent from `/openapi.json` with no error or
   warning -- caught by manually walking the generated spec's `$ref`
   graph, not by the test suite (a gap now closed: schema definitions for
   all four new tables, plus the previously-missing `fraud` field on the
   `orders` schema, found while already in the file).
2. **Bot-activity cart injection generated its own fake, catalog-
   disconnected product ids.** `maybeInjectBotCart` predates the catalog
   and had its own inline `faker.string.uuid()` per line item. This
   silently produced ~1,200 referential-integrity lint failures on an
   otherwise completely normal generated dataset -- caught immediately by
   `lint.test.ts`'s "a freshly generated dataset has no lint issues"
   test. Fixed by having bot carts draw from the same shared catalog via
   the same `pickLineItem` helper (exported from `modules/cart/index.ts`
   for reuse) -- which is also more realistic: a real bot/scraping cart
   references real product ids at abnormal *volume*, it doesn't invent
   fake SKUs.
3. **`fuzz.ts`'s mutations could silently invalidate each other, and
   `price_inversion`/`inventory_oversell` identified line items by SKU --
   which stopped being a safe unique identifier once the catalog made
   duplicate SKUs within one order possible.** Two related bugs, both in
   code that predates the catalog and was never exercised hard enough to
   surface them: (a) at "extreme" intensity (8 attempts per type), the
   same order/return could be picked as a target more than once by the
   same mutation type, so a later attempt could overwrite a field an
   earlier mutation's `after` value had already claimed a specific value
   for; (b) `price_inversion`/`inventory_oversell` recorded which line
   item they mutated via `items[sku].field`, which was safe when every
   SKU was independently random but became ambiguous once two line items
   in the same order could share a SKU. Caught by 32 new regression tests
   (8 seeds x 4 mutation types) that independently re-derive each
   mutation's claim from final dataset state instead of trusting the
   value the code itself produced -- the same verification pattern that
   caught `fraud.ts`'s `account_farming` bug in the previous round,
   applied systematically this time instead of after the fact. Fixed with
   per-type "already targeted" exclusion sets (same pattern as
   `account_farming`'s fix) and by identifying mutated line items by
   array index instead of SKU.

All three were genuinely latent bugs in *existing* code, unmasked (not
caused) by the catalog change shifting RNG draw sequences and making
previously-astronomically-unlikely collisions (duplicate SKUs in one
order, bot-cart line items existing at all in a referential-integrity
check that didn't exist before) actually occur in test runs. 14 new tests
in `tests/catalog.test.ts`, 32 new regression tests in `tests/fuzz.test.ts`
(bringing that file to 42), plus updates to `tests/lint.test.ts`'s
coverage and `tests/chaos-auth-openapi-live.test.ts`'s Postman
folder-count assertion (14 → 22, since Postman generation is
`TABLE_ROUTES`-generic and picked up the four new tables automatically).

---

## Shipped: Synthetic Recommendation Data (2026-07-18)

Tier 1 item #2. Four new tables (`productViews`, `searchQueries`,
`wishlistItems`, `productRatings`) implementing the requested
`User -> View Product -> Add Wishlist -> Purchase -> Review` flow,
grounded in the rest of the dataset rather than independently random:
every purchased product was actually viewed beforehand, every
search-sourced view has a real matching query, ratings only exist on
delivered orders and are timestamped after the shipment's real
"Delivered" event, wishlist items are never backdated to before a
purchase already happened.

**A deliberate architecture choice, made because of what happened last
time:** Tier 0's product catalog was woven into the core per-user
generation loop, which shifted RNG draw sequences enough to unmask three
latent bugs elsewhere in the codebase that weren't caused by the catalog
change but had never been exercised hard enough to surface before it.
Recommendation data runs instead as a fully separate post-processing pass
over the *completed* dataset, with its own `Faker`/`Rng` instances seeded
from an XOR-offset of the run's seed -- so enabling or disabling it has
*zero* effect on every other table's output, verified by a dedicated
test (`enabling/disabling recommendationData does not change any other
table's output`). This was the direct lesson from Tier 0's three bugs,
applied proactively instead of discovered the hard way again.

**Two real bugs, still found despite that precaution -- both in the new
module itself, not unmasked elsewhere:**

1. **Noise-browsing views could get `source: "search"` with no backing
   `SearchQuery` record.** The "pure noise browsing" pass (views of
   products a user never bought, added so "viewed" doesn't trivially
   equal "purchased") originally picked a random source including
   `"search"` from a flat list, but only the purchase-path loop generated
   the matching query. Caught by a test that checks the invariant
   directly ("every search-sourced view has a matching query") rather
   than assuming it holds because the purchase-path loop got it right.
   Fixed by generating a real matching `SearchQuery` for noise views too
   when `source` is `"search"` -- the same requirement, applied
   consistently rather than only where it was obviously needed.
2. **The test verifying that invariant had its own bug** once the fix
   above was in place: for a user/product pair with more than one
   view+query (purchase-path browsing and later noise browsing both
   touching the same product), `Array.find()` on `searchQueries` grabs an
   *arbitrary* matching query, not necessarily the one causally tied to
   the specific view under test -- so the test could still fail even when
   the underlying data was correct, if the arbitrarily-found query
   happened to postdate that particular view. Fixed by checking whether
   *some* qualifying query precedes the view, not asserting on whichever
   one `.find()` happens to return first. (A third, unrelated test bug in
   the same file -- two tests that generated two independent datasets and
   compared them for exact equality without pinning a shared
   `referenceNow` -- caused spurious sub-millisecond timestamp diffs from
   wall-clock drift between the two `generate()` calls; fixed by passing
   an explicit shared `referenceNow` to both.)

14 new tests in `tests/recommendations.test.ts`. Verified end-to-end
against a live `serve` instance over real HTTP (`/api/product-views`
returning real paginated data with the `X-Eco-Faker-Meaning` header
correctly set) and confirmed zero broken `$ref`s in the resulting
OpenAPI spec after adding hand-written schema definitions for the four
new tables to `openapi.ts` (same `RESOURCE_SCHEMAS`-isn't-`TABLE_ROUTES`-
generic gap as Tier 0, closed the same way). New CLI flag
`--no-recommendation-data` to disable, and catalog/recommendation counts
now print in `generate`'s console summary.

---

## Shipped: Inventory Simulation (2026-07-19)

Tier 1 item #7. Four new tables (`warehouses`, `replenishmentOrders`,
`stockoutPeriods`, `warehouseTransfers`), built on the same
decoupled-post-processing-pass architecture as recommendation data --
with its own *independently offset* RNG seed, specifically so that
toggling this feature and toggling recommendation data can never shift
each other's output. Verified directly, not just by construction: a real
CLI run with and without `--no-inventory-simulation` produces
byte-identical recommendation-data counts and content in both cases.

**Grounded in fields the product catalog already generates, not a second,
disconnected inventory concept:**
- `ReplenishmentOrder.expectedDeliveryAt` is exactly `orderedAt +
  supplier.leadTimeDays` -- the same `leadTimeDays` field already on
  every `Supplier`, verified with a test that recomputes the expected
  value from the real supplier record rather than trusting the module's
  own arithmetic.
- Products/variants whose *current* `stockLevel` is low are measurably
  more likely to get a recent stockout period and/or pending
  replenishment order than well-stocked ones -- a real, checkable
  correlation (verified by comparing stockout rates between low-stock and
  well-stocked product cohorts in the same generated dataset), not two
  independently random numbers that happen to coexist.
- Status/date consistency is enforced rather than left to chance: a
  `received` replenishment order never has a future
  `expectedDeliveryAt`; an order `ordered` weeks in the past is nudged
  toward `delayed` or `received` instead of staying implausibly
  `ordered`; a stockout's `resolvedByReplenishmentId` (when set) always
  points to a real, `received` order for the *same* product with a
  matching `endedAt`.

No new bugs to report from this one -- the lessons from the two previous
rounds (decoupled RNG for optional post-processing features; verify
real generated output before writing the test suite, not after) were
applied from the start, and 13 new tests in `tests/inventory.test.ts`
passed on the first run. That's worth stating plainly rather than
inventing a bug to report for the sake of a "lessons learned" section:
sometimes the fix from the previous round is exactly what prevents the
next one.

Verified end-to-end against a live `serve` instance over real HTTP
(`/api/replenishment-orders` returning real paginated data with the
correct `X-Eco-Faker-Meaning` header) and confirmed zero broken `$ref`s
across all 18 tables' worth of OpenAPI schema after adding the four new
`RESOURCE_SCHEMAS` entries (same manual step Tier 0 and recommendation
data both needed, since `openapi.ts` isn't `TABLE_ROUTES`-generic). New
CLI flag `--no-inventory-simulation`, and warehouse/replenishment/
stockout/transfer counts now print in `generate`'s console summary.

---

## Shipped: Analytics Dataset Generator (2026-07-19)

Tier 1 item #3, the last one that was queued up. Architecturally
different from every other item shipped in this series: this isn't new
synthetic data added to `Dataset`, it's a pure, deterministic aggregation
*over* a dataset that already exists (`computeAnalytics(dataset,
options)` in `src/analytics.ts`) -- no RNG, no new referential-integrity
surface, no decoupling concerns of the kind the last three features all
had to solve for. Five outputs: daily revenue, a conversion funnel
(`viewed -> added_to_cart -> checkout_started -> purchased`), monthly
retention cohorts, per-customer LTV, and a CAC estimate. Exposed via a
new `my-eco-gen dashboard` CLI command, a `compute_analytics` MCP tool,
and three export formats (`--format csv|sql|json`).

**On "PowerBI CSV / Metabase seed / Superset demo," the original framing
for this item:** neither Metabase nor Superset has a native static seed
format -- both connect to a real database and build questions/dashboards
against whatever's there. Rather than inventing a fictional
tool-specific export to satisfy that framing literally, the shipped
version is honest about what each tool actually needs: `--format csv`
produces one file per table for PowerBI's Get Data > Text/CSV (and Excel,
and Google Sheets, which *do* import flat files natively), and
`--format sql` is what actually seeds a real Postgres database for
Metabase or Superset to connect to. Documented as such in the README
rather than left implicit.

**The one figure this dataset has nothing else to derive from:** CAC
needs a marketing-spend number, and there's no marketing-spend concept
anywhere else in eco-faker to compute one from -- every other feature
shipped so far has been about grounding new numbers in *existing*
fields (supplier lead times, current stock levels, purchase history);
this is the first case where no such field exists to ground against.
Handled as a plain, clearly-labeled assumption (`--marketing-spend
<number>`, defaulting to a flat, explicitly-arbitrary `$5000`) rather
than disguising a made-up number as computed data. `newCustomersAcquired`
and the resulting `cac` itself are real, computed figures once that one
input is supplied.

**Two real bugs, both caught by verifying real generated output before
writing the test suite -- the habit from the last two rounds paying off
again:**

1. **The conversion funnel could show a >100% "conversion rate" from
   `viewed` to `added_to_cart`.** `added_to_cart` always covers every
   user (the default `cartsPerUser.min` is 1), but `viewed` didn't --
   recommendation data's noise-browsing pass rolls `0-8` extra views per
   user independent of purchase activity, so a small fraction of users
   could end up with zero recorded views despite having a cart. This
   surfaced immediately on the very first real dataset checked, before
   any test was even written. Fixed as a genuine realism improvement to
   `generateRecommendationData` itself -- not a funnel-side patch --
   since realistically you view something before adding it to a cart
   even when that view isn't tied to a specific purchase: any user with
   cart activity and zero recorded views now gets one. Verified across
   eight seeds after the fix, all clean.
2. **`computeAnalytics` crashed outright** with a real `TypeError` when
   run against a dataset loaded back in via `dashboard --input`, because
   `generate --format json`'s output (`output/json.ts`) deliberately
   excludes `config` from what it writes, and the funnel computation
   read `dataset.config.recommendationData.enabled` directly to decide
   whether to include the `viewed` stage. Every other CLI command that
   accepts `--input` (`lint`, `visualize`, `fuzz`) happened to never read
   `dataset.config`, so this gap had been latent since `toJson()` was
   written and nothing had exercised it until analytics became the first
   consumer that needed it. Fixed by checking whether the `productViews`
   array itself has content instead of trusting config metadata that
   isn't guaranteed to survive a round trip -- a strictly better design
   even setting the crash aside, since the array's presence is the real
   signal regardless of how the dataset arrived. Locked in with a
   dedicated regression test that strips `config` from a real generated
   dataset and confirms `computeAnalytics` still works correctly on it.

23 new tests in `tests/analytics.test.ts` plus 10 in
`tests/dashboard-export.test.ts` (32 total across both files after
account for one merged report-fixture describe block), an 8th MCP tool
(`compute_analytics`, with `tests/mcp.test.ts` updated to expect and
exercise it), and every daily-revenue/LTV/retention/funnel figure
verified against an independent manual recomputation from the same
dataset, not just checked for "some value exists."

---

## Shipped: Benchmark Export (2026-07-19)

Tier 1 item #12, the last item on the original 14-item list. Also the
item most reshaped by honest scoping: "Postgres/Elasticsearch/ClickHouse-
specific formats" implied three roughly-equal parallel exports, but
Postgres was already fully covered (`generate --format sql` /
`--format csv` + `\copy`) and ClickHouse ingests that same CSV output
natively via `FORMAT CSVWithNames` -- reimplementing either as a fourth
or fifth copy of the same row data would have been pure duplication with
no new capability behind it. Elasticsearch was the one genuine gap: it
has no CSV/SQL ingestion path at all, so its Bulk API's NDJSON format
(alternating action-metadata and document lines) needed real new
serialization code that nothing else in this repo produced. Shipped
scope, accordingly: `--target elasticsearch` (real Bulk API NDJSON + one
inferred index mapping per table) and `--target clickhouse` (DDL only --
`ENGINE = MergeTree()`, `ORDER BY (id)`, and ClickHouse's own type
system, with the CSV you already have as the actual data payload).

**A real piece of infrastructure work came out of this, not just the two
exporters:** both needed the same thing -- every table's rows, flattened
to snake_case, matching `CANONICAL_COLUMNS` exactly -- and that had
already been hand-written twice before (once in `output/sql.ts`, once in
`output/csv.ts`), each listing all 18 tables' field mappings out
individually. A third and fourth hand-written copy for the two new
exporters would have meant the same gap class Tier 0's `openapi.ts`
already demonstrated once (a table added to `types.ts` silently missing
from a manually-maintained list somewhere else). Instead, a new shared
`datasetToCanonicalRows` (`src/introspect/canonical-rows.ts`) derives the
field mapping generically from the column names themselves (`user_id` ->
`userId`) against `CANONICAL_COLUMNS`, so both new exporters -- and any
future one -- get every table for free rather than needing to be kept in
sync by hand. (This doesn't retroactively deduplicate `sql.ts`/`csv.ts`
themselves, which still have their own hand-written mappings; that
consolidation is real but out of scope for this round -- noted here so
it doesn't get lost.)

**One real bug, caught the same way the last three rounds' bugs were --
checking real generated output before trusting the test suite to find
it:** Elasticsearch's numeric field-type inference (`long` vs `double`)
originally sampled a single value per column. `orders.shipping` is `$0`
for most orders but a genuine decimal surcharge for some -- so depending
on which row happened to get sampled, the field could be mapped
integer-only `long`, which would silently truncate or reject the real
decimal values on actual Elasticsearch ingestion. Fixed to check *every*
sampled value in the column, not just the first (the ClickHouse exporter
already did this correctly from the start, since its inference function
was written with an explicit `.every()` check). Verified across five
seeds with a test that cross-references every field mapped `long`
against every real value that ever appeared in that column across the
whole dataset -- zero violations.

New `my-eco-gen benchmark-export --target elasticsearch|clickhouse`
CLI command. 11 tests in `tests/benchmark-elasticsearch.test.ts`, 8 in
`tests/benchmark-clickhouse.test.ts`, 7 in `tests/canonical-rows.test.ts`
for the shared extractor itself -- 26 new tests, all passing.

With this, Tier 1 (all four items from the original 14-item list judged
buildable once Tier 0's product catalog existed) is complete. What
remains is Tier 2 -- items with no dependency on Tier 0: Event Sourcing
Mode, Scenario Composer, AI Dataset Mode, Temporal Scenario Engine,
OpenTelemetry Integration, and the Interactive Relationship Explorer (see
the dependency-ordered list below for what each actually involves).

---

## Shipped: Event Sourcing Mode (2026-07-19)

Tier 2 item #5, the first Tier-2 item and the one flagged as the best
starting point since it was closest in spirit to work already in the
repo. New `my-eco-gen events` CLI command plus a `build_event_stream`
MCP tool, both backed by a new `src/events.ts`.

**Positioned deliberately as a different artifact from the existing
webhook simulator (`webhook.ts`/`my-eco-gen webhook`), not a
duplicate of it.** The two genuinely overlap -- both know that an order
becomes `order.created`, a shipment's tracking history becomes
`shipment.<status>` events, and so on, because that's real domain logic
that doesn't change based on which tool is asking for it. But they exist
for different purposes and operate on different input shapes:
`webhook.ts` paces a stream of events out to an HTTP endpoint in
simulated real time, built directly on the streaming `generateRecords`
generator for memory efficiency, and covers the original 6 tables it
predates everything else by. `events.ts` builds the dataset's complete
event-sourced *representation* -- every event carries `aggregateId` and
`aggregateType`, the fields an actual event-sourced system needs to
group events into per-entity streams and replay them into current state,
which `webhook.ts`'s flatter `WebhookEvent` doesn't need for its own
purpose -- and it operates on a fully materialized `Dataset` so it can
cover all 18 tables, including recommendation data and inventory
simulation, both of which postdate `webhook.ts` and were never retrofitted
into it. This is stated as an explicit, disclosed design tradeoff (not
merged into one shared implementation) rather than left for someone to
notice as unexplained duplication later.

**A real question this format forced that the final-state tables never
had to answer:** `Cart.items[]` has no timestamp of its own -- nothing
records exactly when each item was added, only the cart's own
`createdAt` and `lastActivityDate` bound the window it could plausibly
have happened in. Rather than either omitting `cart.item_added` entirely
or fabricating an independent random timestamp per item (which would
have been the first departure from this whole session's pattern of never
generating a number that isn't grounded in something real), item-added
events are evenly interpolated between those two real bounds. Tested
directly: every item-added event's timestamp falls within
`[cart.createdAt, cart.lastActivityDate]`, multiple items in one cart
stay chronologically ordered relative to each other, and a degenerate
zero-width window (a cart with no activity beyond its own creation)
doesn't crash and falls back sensibly to `createdAt` for every item.

No bugs to report finding this time -- 17 tests in `tests/events.test.ts`
passed on first run, including the per-table exact-count checks
(`cart.item_added` against the real total line-item count across every
cart, `replenishment.received`/`stockout.resolved` only firing for
records with a real `receivedAt`/`endedAt`, and so on) that would have
caught the kind of off-by-something count mismatch that's shown up
elsewhere in this series. The MCP tool follows `generate_dataset`'s
existing pattern of returning counts and a small sample rather than the
full result -- a real dataset's event stream can run into the thousands
of events, and dumping that directly into an agent's context the way
`generate_dataset` deliberately avoids doing with full datasets would
have been the same mistake in a new place.
