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

**Tier 2 -- independent, no dependency on Tier 0 -- items #5, #6, #9, #10, #11, and #14 SHIPPED 2026-07-18/19. Every item on the original 14-item list is now shipped.**
5. ~~**Event Sourcing Mode**~~ -- see "Shipped: Event Sourcing Mode"
   below for the full writeup.
6. ~~**AI Dataset Mode**~~ -- shipped as **Support Tickets**, later
   extended with **Transactional Emails** (see "Shipped: Transactional
   Emails & Review Text" below). "Chat messages" specifically (the one
   remaining piece of this item's original scope) was deliberately not
   built as its own table -- see that writeup for why.
9. ~~**Temporal Scenario Engine**~~ -- see "Shipped: Temporal Scenario
   Engine" below for the full writeup. Shipped *without* the "real
   extension to the generator's core loop" this item's own original
   scope note assumed it would need -- see that writeup for why avoiding
   exactly that turned out to be both safer and sufficient.
10. ~~**Scenario Composer**~~ -- see "Shipped: Scenario Composer" below
    for the full writeup.
11. ~~**OpenTelemetry Integration**~~ -- shipped as **OpenTelemetry
    Export**; see "Shipped: OpenTelemetry Export" below for the full
    writeup. Shipped *without* the real OTel SDK dependency this item's
    own scope note assumed it would need, for a concrete reason -- see
    that writeup.
14. ~~**Interactive Relationship Explorer**~~ -- see "Shipped:
    Interactive Relationship Explorer" below for the full writeup. The
    last item anywhere on the original 14-item list.

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

---

## Shipped: Scenario Composer (2026-07-19)

Tier 2 item #10. New `--scenario-file` flag on `generate`, a `my-eco-gen
scenario resolve <file>` command for authoring/debugging, a
`resolve_scenario_file` MCP tool, and the core `src/scenario-composer.ts`
module underneath all three.

**Built to be genuinely testable without touching a real filesystem, not
just as an afterthought.** The core resolution logic
(`composeScenarioFile`) takes an injectable `ScenarioFileLoader`
interface rather than calling `readFileSync` directly, so the entire
inheritance-resolution algorithm -- multi-file chains, built-in-scenario
mixing, precedence ordering, cycle detection -- gets tested against a
plain in-memory fake with no temp files and no real disk I/O at all.
The real filesystem-backed loader (YAML or JSON, paths resolved relative
to the referencing file's own directory so a scenario file's `inherits`
stay portable) is a thin wrapper wired in only at the CLI/MCP boundary.
17 tests against the fake loader, then a handful more written against
real files on disk specifically to confirm the real loader's YAML
parsing and path resolution actually work end-to-end -- both layers
verified, neither one trusted blind.

**Reused rather than rebuilt:** the actual merge semantics
(`inherits` entries applied left-to-right, a file's own `overrides`
applied last, nested objects like `anomalies` deep-merged instead of
clobbered) is just `mergeOverrides`, which already existed and already
had this exact behavior from layering `--scenario` presets under
explicit CLI flags. And validation of the final composed config is just
`resolveConfig`, the same AJV validator `generate()` itself always runs
-- an authoring mistake in a scenario file (`abandonmentRate: 5`, out of
the schema's valid `[0, 1]` range) surfaces the identical error message
someone would get from `generate()` directly, not a separate, differently-worded
validation path that could drift out of sync with the real schema over
time.

**One real bug, found by actually running the CLI against real files
instead of stopping once the fake-loader tests passed:**
`import yaml from "js-yaml"` compiled cleanly and typechecked fine, but
crashed at runtime with `SyntaxError: The requested module 'js-yaml'
does not provide an export named 'default'`. js-yaml 5.x (the version
that resolved from the `^5.2.1` semver range) is a pure ESM-native
package with no default export -- `load` is a named export only. This
is exactly the class of bug that only a real dependency + a real runtime
invocation catches; the fake-loader tests never exercised the actual
`js-yaml` import at all, since they inject their own loader and never
call the real one. Fixed by switching to `import { load as loadYaml }
from "js-yaml"`. Worth remembering for any future dependency added to
this project: check its real export shape under Node's ESM loader before
assuming a default import works, especially for a library on a major
version freshly bumped past 4.x -- `npm install` and `tsc` both stayed
silent about this; only `node dist/cli.js` actually running the command
surfaced it.

Verified end-to-end, not just unit-tested: a real three-layer
`custom.yaml` (inheriting `black-friday` and a `base.yaml` with its own
tax/shipping tuning) resolved correctly via `scenario resolve`, generated
a real dataset via `--scenario-file` with the right `scaleFactor`, a
real two-file circular-inheritance case was rejected with a clear
message naming the exact chain, a real invalid override surfaced the
real AJV error, and an explicit `--users` flag was confirmed to still
override the scenario file's `scaleFactor`, matching the documented
precedence exactly.

---

## Shipped: Support Tickets (2026-07-19)

Tier 2 item #6, shipped as a scoped-down slice of the original "AI
Dataset Mode" item. New `supportTickets`/`supportMessages` tables, with
`--no-support-tickets` to disable, driven by a new
`src/modules/support/index.ts` -- same decoupled-post-processing-pass
architecture as recommendation data, inventory simulation, and (now) this,
each with its own independent RNG seed offset so toggling any one never
shifts another's output.

**Deliberately scoped down from "support tickets, chat messages, reviews,
emails" to just support tickets (with full threaded conversations) this
round**, rather than building four separate prose subsystems in one pass
the way earlier rounds each built one focused feature. Chat/reviews/
emails remain a natural next increment on the same module, not lost --
noted above in the Tier 2 list rather than silently dropped.

**Every ticket grounded in a real signal already tracked elsewhere in the
dataset, continuing the pattern from every content-generating module this
session:** `Shipment.delayed` (a real boolean, not inferred), a real
`ReturnRequest.reason`/refund amount, a real `ProductRating.rating <= 2`,
a real order with a null `shippingAddress` (an existing anomaly signal),
and -- only when recommendation data actually exists -- a real
`ProductView` for a product the user never purchased, for pre-sales
questions. Message bodies are combinatorial (opener/detail/closer slots,
multiple variants each, combined via `rng.pick`) with real interpolated
specifics -- order id, tracking number, refund amount, product name --
not one fixed string repeated across every ticket of a category.

**Two real bugs, both caught before or immediately after writing the test
suite:**

1. **A ticket could carry `status: "resolved"` with `resolvedAt: null`.**
   `resolvedAt` was only ever set inside the branch that fires a
   category's dedicated resolution message -- but pre-sales and generic
   account tickets deliberately have no dedicated resolution message (a
   single agent reply legitimately resolves a simple question), so those
   categories could roll `status: "resolved"` from the weighted random
   draw while `resolvedAt` silently stayed `null`. The exact same
   status/date-consistency bug class already caught and fixed once in the
   inventory simulation module (`ReplenishmentOrder`/`StockoutPeriod`),
   surfacing here in a new place for the same underlying reason: a status
   field and a timestamp field that are supposed to agree, set in two
   different code paths that didn't always both run. Fixed so a
   resolved/closed ticket always has a real `resolvedAt`, falling back to
   the agent's acknowledgment timestamp when there's no dedicated
   resolution message.
2. **Found only by checking how the data actually looks once exported
   for Elasticsearch** -- the benchmark-export target this feature makes
   most directly relevant, since "data for training/testing NLP systems"
   is the whole point of a support-ticket dataset. `support_messages.body`,
   `product_ratings.review_text`, and `search_queries.query` all happened
   to stay under the Elasticsearch mapper's 256-character length
   threshold in typical generated data, so they were all getting mapped
   exact-match `keyword` instead of full-text-searchable `text` --
   exactly backwards for free-text fields whose entire purpose is search/
   NLP training, and a real, pre-existing gap in the mapper that this
   round's new `body` field happened to make obvious rather than
   introduce. Fixed by recognizing known free-text column names directly
   (`body`, `review_text`, `query`, `subject`) rather than relying on
   sampled length alone; verified that enum-shaped fields (`category`,
   `status`, `priority`, `sender`) correctly stayed `keyword` throughout.

19 new tests in `tests/support-tickets.test.ts`, 2 new regression tests
added to the existing Elasticsearch benchmark suite for the free-text
fix, and one new test confirming `query_table` (the MCP tool) already
worked against the new tables with zero dedicated wiring, since it's
generic over the same `TABLE_ROUTES` registry every other feature already
populates.

---

## Shipped: Temporal Scenario Engine (2026-07-19)

Tier 2 item #9. New `my-eco-gen temporal --profile <name-or-file>` CLI
command, three built-in profiles (`holiday-arc`, `supply-chain-decline`,
`flash-sale-week`, each built from existing scenario presets), a
`generate_temporal_dataset` MCP tool, and `src/temporal.ts` underneath.

**Shipped without the "real extension to the generator's core loop"
this item's own scope note originally assumed it would need.** The
alternative: generate N ordinary, fully-normal `generate()` calls (one
per time segment, each with its own bounded `historicalDays` and shifted
`referenceNow`), then concatenate every table into one dataset. Every
segment runs through exactly the same code path this project's entire
test suite already covers, so the feature itself adds no new risk to
anything else `generate()` produces -- a deliberate, direct application
of the lesson this whole project has been building on since Tier 0's
product catalog first demonstrated the alternative's cost (three latent
bugs unmasked elsewhere when a new feature was integrated into the core
loop instead of layered alongside it). The trade-off this buys, stated
plainly: each segment gets its own independent product catalog and its
own independent user pool -- a repeat customer shopping across both the
quiet baseline and the spike isn't modeled. `mergeDatasets` is the one
new piece of general-purpose infrastructure here (concatenates all 20
tables from N datasets), and it's safe by construction: each input was
already internally referentially consistent on its own, so concatenation
can't introduce a dangling reference that didn't already exist --
verified directly against a real merged dataset with `lint`, not just
assumed.

**This is also the round where checking a genuinely new, stricter
invariant paid off far beyond the feature itself.** Verifying that no
order timestamp fell outside a temporal profile's full multi-segment
span surfaced two real, significant bugs in the *foundational*
`generate()` function -- not new bugs this feature introduced, bugs that
had been latent since long before this entire session's work began, in
the single most heavily-used code path in the whole project:

1. **`Order.createdAt` could land up to 30 minutes in the future**
   relative to `referenceNow`. It's computed as `cart.lastActivityDate +
   rng.int(1, 30) minutes`, and a *converting* cart's own
   `lastActivityDate` can legitimately be as recent as `referenceNow`
   itself (see `modules/cart/index.ts`'s "converted" branch) -- so adding
   minutes on top with no clamp could overshoot. Confirmed against plain,
   non-temporal `generate()` calls too, not just the new temporal path:
   16 violating orders across 10 arbitrary seeds before the fix, 0 across
   30 seeds after.
2. **`AbandonedCheckout.recoveryEmailSentAt` could land up to 9 hours in
   the future**, for the identical underlying reason -- `exitTimestamp +
   up to 12h`, and an abandoned cart's `exitTimestamp` can be as recent as
   `referenceNow - 3h`, so `(referenceNow - 3h) + 12h = referenceNow +
   9h` was a real, reachable upper bound.

Both fixed with the exact same `Math.min(computed, referenceNow)` clamp
this session has used consistently in every new module built since Tier
0 -- `convertCartToOrder` and `generateAbandonedCheckout` both now take
`referenceNow` as an explicit parameter and clamp against it, rather than
computing an unclamped forward offset and hoping it doesn't reach too
far.

**A real gap in test coverage, not just in the generator, is exactly why
both went undetected across many prior rounds of work:** a test named
`"no event timestamp is in the future"` had existed in
`tests/timeline.test.ts` this whole time -- but it only ever actually
checked `shipment.events`, never `orders`, `carts`,
`abandonedCheckouts`, `returnRequests`, or `users`. The name promised
comprehensive coverage; the implementation checked one table out of six
with timestamp fields. Expanded into an explicit battery of checks
across every timestamp field on every table, with a fixed `referenceNow`
rather than a fresh `Date.now()` call after generation so the check is
exact rather than merely "probably fine because some time passed since
generation." This is the kind of gap that's easy to miss precisely
*because* the test's name sounds thorough -- worth remembering as a
pattern for any future test in this project: a name isn't the same
thing as the assertion actually backing it.

16 new tests in `tests/temporal.test.ts` (profile validation, dataset
merging, a real measured revenue arc -- the spike segment's average
daily order volume more than 3x the baseline's, computed from
`computeAnalytics`'s own daily revenue on the actual generated dataset,
not just asserted), plus 6 new tests in the expanded
`tests/timeline.test.ts` regression block.

With this, only one item remains in Tier 2: OpenTelemetry Integration --
a genuinely different domain (distributed tracing) from anything else in
this repo, needing a real OTel SDK dependency and its own data model
(traceId/spanId/latency trees) rather than an extension of the existing
`Dataset` shape.

---

## Shipped: OpenTelemetry Export (2026-07-19)

Tier 2 item #11, the last item in Tier 2. New `my-eco-gen otel-export
--input <path>` CLI command, a `generate_otel_traces` MCP tool, and
`src/otel.ts` underneath -- a standalone derived-view module (no changes
to the `Dataset` type, no config toggle, nothing wired into `generate()`
at all), the same architectural family as `dashboard`/`events`/
`benchmark-export`: it computes something new from a dataset that
already exists rather than adding a new first-class table to it.

**Shipped without the real OTel SDK dependency this item's own original
scope note assumed it would need -- for a concrete, specific reason, not
just to avoid a dependency.** The OTel Node SDK (`@opentelemetry/sdk-
trace-node` and friends) is built around instrumenting *live* code in
real time: start a span now, do work, end it now. Coercing it into
backdating thousands of historical spans with arbitrary past timestamps
across a 90-day window isn't really what it's designed for, and forcing
it would have meant working against the grain of an unfamiliar API in
ways likely to introduce exactly the kind of fragile, unfamiliar-
territory bugs this project has tried to avoid. Instead: the real
OTLP/JSON wire format, constructed directly. **The exact schema was
verified with a live web search against `opentelemetry-proto`'s actual
`trace.proto` and real collector examples before writing a line of
code** -- span `kind` and `status.code` are plain integers (not string
enum names, which was the genuinely uncertain part going in), nanosecond
timestamps are string-encoded (a real uint64 nanosecond value exceeds
JS's safe integer range), trace/span IDs are 32/16 lowercase hex
characters. Getting a "real wire format" claim wrong would have
undermined the entire point, the same standard this project held the
Elasticsearch Bulk API format to.

**Two kinds of traces, grounded in real data rather than invented
wholesale:**
- **`fulfill_shipment`** -- one per shipment, and about as strongly
  grounded as any feature in this whole project: the root span's start
  and end are exactly the shipment's own real first and last
  tracking-event timestamps, and every child span corresponds to a real
  consecutive pair of tracking events, not a synthetic breakdown. A
  shipment's real `delayed` flag becomes a real `ERROR` status on the
  relevant span.
- **`checkout`** -- one per order, spanning two real OTLP resources
  (`checkout-service`, `payment-service`) that share a single `traceId`
  -- a genuine multi-service trace, the real, standard way OTel
  represents a request crossing service boundaries, not one flat
  service. Root span's end time is the order's real `createdAt`. What's
  disclosed rather than hidden: total checkout *duration* has no real
  per-order signal anywhere in this dataset to ground it against, so
  it's a plausible synthetic figure -- the same honesty this project
  applied to CAC's assumed marketing spend. What IS grounded: the
  payment span's `ERROR` status, which reflects the order's real
  `stolen_card` fraud tag specifically (the one fraud type that
  genuinely corresponds to a payment-declined scenario), not a
  fabricated failure rate.

**One real bug, caught immediately by checking actual generated output
before writing a single test -- the pattern that's paid off in every
round this session that used it.** The attribute-serialization helper
routed every numeric attribute through OTLP's `intValue` type,
rounding it -- which silently truncated the cents off every dollar-
amount attribute (`order.total`, `payment.amount`, `order.tax`,
`order.subtotal`). The very first dataset checked had 318 of 320 orders
with cents in their total. Fixed by routing non-integer values through
OTLP's real `doubleValue` type instead, reserving `intValue` for
genuinely whole numbers (item counts and the like) -- verified directly
against a real order's exact real total, not just "some double value
exists."

17 new tests in `tests/otel.test.ts`, covering both OTLP schema
conformance (ID formats, integer enums, string timestamps, parent/child
span linkage, end-after-start ordering) and the grounding claims above
against real generated data, not just structural shape.

With this, Tier 2 is complete except for the Interactive Relationship
Explorer -- a genuine web UI project (clickable User → Orders →
Shipment → Returns navigation), independent of everything else on the
original 14-item list, and the only item left on that list at all.

---

## Shipped: Interactive Relationship Explorer (2026-07-19)

Item #14 -- the last item anywhere on the original 14-item roadmap.
Every item on that list is now shipped. A second static browser page,
`web-static/explorer.html` + `src/explorer.ts`, alongside the existing
aggregate-stats playground: same architecture (client-side only, same
`src/browser.ts` entrypoint, esbuild-bundled), but for browsing real
*relationships* between entities -- a Miller-columns drill-down through
User → Orders → Shipment/Return Requests → full tracking or return
detail -- rather than aggregate charts.

**Verified with a real DOM this time, not a hand-rolled fake one --
and that choice is what actually caught something.** The existing
static-playground smoke test (`smoke-test-static.cjs`) had always used a
hand-built fake `document` object with ad-hoc `addEventListener`/
`appendChild`/`insertBefore` stubs -- good enough to confirm the bundle
runs without throwing, but with no real `<select>` element behind it.
For this new page, `jsdom` was used instead: the actual HTML, the actual
bundled JS, actual simulated clicks propagating through actual event
delegation and `.closest()` DOM traversal. That's what surfaced a real
bug immediately.

**The bug, present in *both* static pages:** the scenario `<select>`
dropdown was silently defaulting to whichever real scenario preset
(`black-friday`, the first one inserted) instead of the intended empty
"custom" option, in the new explorer page and in the original
aggregate-stats playground (`app.ts`) it was modeled on -- the two files
share the identical dropdown-population code, copied when the explorer
was built. The cause: `option.selected = true` was being set *before*
the `<option>` was attached to its `<select>`, which doesn't reliably
survive DOM insertion -- a real, general DOM gotcha, not specific to
this project. This had been silently wrong in `app.ts` this whole time:
its own smoke test's fake DOM implemented `insertBefore` as a plain
array `unshift()`, with no actual `<select>` selection semantics to ever
catch it. In a real browser, this meant the aggregate-stats playground's
dropdown visually showed "black-friday" selected on page load instead of
"custom (sliders below)" -- confusing, wrong UI state that had shipped
undetected. (The generated *numbers* were unaffected in `app.ts`
specifically, since its sliders explicitly override every scenario field
after the fact -- but the dropdown itself lied about what was selected.)
In the new explorer page, which has no such override, the bug also
meaningfully reduced generated order/return counts by silently applying
`black-friday`'s tuning instead of default config.

Fixed in both files by explicitly forcing `scenarioSelect.value = ""`
after every option exists, rather than trusting property-set-before-
insertion timing. `smoke-test-static.cjs` was rewritten to use `jsdom`
too (dropping the old hand-rolled fake DOM entirely), with an explicit
regression check that the dropdown's value is genuinely `""` on load --
the exact assertion that would have caught this the first time. Both
smoke tests are now wired into CI (`.github/workflows/ci.yml`) alongside
the existing bundle-build step.

New devDependency: `jsdom`. `npm run build:static` now bundles two entry
points (`bundle.js` for the aggregate-stats playground,
`explorer-bundle.js` for the new page) via a single extended script.

---

## Shipped: Transactional Emails & Review Text (2026-07-25)

The "not done this round" leftover explicitly flagged when Support
Tickets shipped: "chat messages/reviews/emails as free text" was the
rest of the original AI Dataset Mode scope. This round picked up two of
those three -- emails and reviews -- and deliberately left the third out,
with a reason rather than a silent omission.

**New `emailMessages` table**, same decoupled-post-processing-pass
architecture as recommendation data, inventory simulation, and support
tickets -- its own independent RNG seed offset, so toggling it never
shifts any of the other three. Five real email types, all grounded in a
timestamp (and often the exact content) that already existed elsewhere
in the dataset: `order_confirmation` off the order's own real
`createdAt`; `shipping_notification`/`delivery_confirmation` off the
shipment's own real tracking-event timestamps; `return_confirmation`
quoting the return's real reason and exact real refund amount; and
`cart_abandonment_recovery` -- the strongest grounding of the five,
since `AbandonedCheckout.recoveryEmailSentAt` has existed as a bare
timestamp with no email content behind it since the very first version
of this project, long before this session's work began. This fills that
gap in with real content at the exact same real timestamp.

**Review text enrichment**, in the same round since it's a small,
self-contained fix to an already-identified weak spot:
`productRatings[].reviewText` used to be a fixed template of 2-3 strings
per rating value -- roughly 10-15 distinct reviews total, however many
thousand ratings existed in a given dataset. Replaced with a
combinatorial opener/detail generator, the real product name
interpolated into every review. In one 300-order dataset checked: 254
distinct texts out of 263 reviews with text.

**One real bug, caught by a test that checked the actual claim instead
of just the field types:** `opened` and `clicked` on `EmailMessage` were
originally two independent random rolls, which allowed the logically
impossible state of `clicked: true` while `opened: false` -- clicking a
link inside an email you never opened. 174 violations in the first
dataset checked. Fixed so `clicked` is only ever rolled, and can only
ever be true, conditional on `opened` already being true -- the same
status/date-consistency bug class this project has now hit and fixed in
the inventory simulation module (`ReplenishmentOrder`/`StockoutPeriod`)
and the support ticket module (`resolvedAt`) before this.

**"Chat messages" deliberately left out, not silently dropped.** A
live-chat concept would have meant a new table whose content mostly
duplicates support tickets' existing "general" (pre-sales) category --
a real customer question about a product they viewed but didn't buy,
grounded in the same `ProductView` data either way. Building it as its
own separate thing would have been scope for the sake of covering every
word in the original item's description, not real, differentiated
value, so it was left out and said so here rather than forced in for
completeness.

14 new tests in `tests/email.test.ts`, 2 new tests added to the existing
recommendation-data suite for the review-text improvement, and one new
test confirming the new `email-messages` table was already queryable via
MCP's generic `query_table` tool with zero dedicated wiring -- the same
`TABLE_ROUTES`-driven genericness every table added since the benchmark-
export round has gotten for free.

With this, the leftovers explicitly flagged along the way during this
whole extended session are cleared out as far as they're going to be --
what remains unbuilt (a live-chat table) has a stated reason for staying
that way rather than an open question.

---

## Shipped: React Query adapter (2026-07-25)

External review of the project (not from ROADMAP.md) flagged several
gaps. Most turned out not to be gaps: the "TypeORM/Drizzle adapter"
suggestion is already covered by `init` (schema introspection into
`mapping.json`) plus `generate --format sql` (ready-to-run INSERT
statements against that mapping), and the "schema-as-code" suggestion
is the same feature by another name. `test --contract` is the
property-based contract testing item already sitting in the intentional
backlog per an earlier explicit decision -- not re-opened here. Apollo/
Relay client adapter, mailhog/maildev SMTP replay, funnel-targeted
scenario composition, and NL-prompt-driven generation are real,
heavier asks that were left alone this round.

The one genuine, self-contained gap: no client-side data-fetching
adapter existed alongside the MSW/tRPC/GraphQL server-side adapters.
Added `eco-faker/react-query`, exporting `createEcoFakerQueryHooks` --
one `{ useList, useById }` pair per table, generated generically off
the same `TABLE_ROUTES` the MSW and tRPC adapters already share, so a
new table shows up here with zero dedicated wiring, the same property
those two adapters already have. `useList` returns `serve`'s exact
`{ data, pagination }` body; `useById` returns the raw record, matching
`serve`'s body over the wire exactly (the `X-Eco-Faker-Meaning` header
isn't reachable from a plain `fetch`-based hook, so it's simply not
exposed here, unlike the tRPC adapter which folds it into the payload).

**One real bug, caught by writing the test before assuming the
implementation was right:** the hooks factory defaulted to `fetch`
as a plain expression (`options.fetchImpl ?? fetch`), which captures
whatever `fetch` was bound to once, at the moment
`createEcoFakerQueryHooks()` is called -- not on every request. In the
test, that moment was before MSW's `server.listen()` had patched the
global, so every request silently fell through to a real network call
and failed. Real consumers hit the identical bug any time they call
the factory before their own mocking/interception is wired up, which
is a very ordinary ordering. Fixed by wrapping the fallback in a
closure (`(...args) => fetch(...args)`) so the global is resolved fresh
on every call instead of captured once.

6 new tests in `tests/react-query.test.tsx`, exercising the hooks
against the existing MSW adapter's intercepted routes (a manually
assembled JSDOM document, rather than switching the whole file to
vitest's `jsdom` environment, since that environment's own `fetch`
replacement turned out to be a second, unrelated way to break MSW
interception -- worth remembering if this pattern gets reused).

---

## Shipped: `mail` -- local email inbox replay (2026-07-25)

The second item picked up from that same external review, after the
React Query adapter: "add a command that starts a local SMTP server
(like MailHog or MailDev) and replays your generated emails into it,"
explicitly flagged as high priority since transactional emails already
existed as data but had no way to actually be read.

Added `my-eco-gen mail`, backed by a real [MailDev](https://github.com/maildev/maildev)
instance (bundled as a dependency, not an optional peer -- unlike the
MSW/tRPC/GraphQL/React-Query adapters, this command has nothing useful
to do without it) and [nodemailer](https://nodemailer.com/) for the
actual SMTP delivery. `buildMailReplayItems` resolves each
`EmailMessage`'s real recipient off `dataset.users` and sorts
chronologically by `sentAt`; `replayMail` paces delivery through the
exact same `replayEvents` helper `webhook` already used, generalized
from `WebhookEvent[]` to any `{ type, timestamp }` shape rather than
duplicating the pacing loop a second time.

**Two real decisions worth recording, not just the happy path:**

- `npm install maildev` resolves to `3.0.0-rc.1` -- the `latest` dist-tag
  points at an unreleased rewrite (Node 20+, all-new async/await API),
  not the stable 2.x line. Shipping a published package with a
  pre-release dependency, and silently raising this project's own
  stated `>=18` Node engine floor in the process, would have been a
  quiet trap for anyone who ran `npm install`. Pinned to `2.2.1`
  explicitly instead -- the old callback-style API, `>=18.0.0` engine,
  matching this project's own floor.
- MailDev's default bind address (IPv6 wildcard) failed outright in
  this sandbox (`EAFNOSUPPORT`). Rather than treating that as
  sandbox-only noise, it's a real question for a dev tool: binding to
  every interface by default isn't the right default for a local
  inbox regardless of environment. Explicitly bound both the SMTP and
  web servers to `127.0.0.1`.

4 new tests in `tests/mail.test.ts`: three on `buildMailReplayItems`
(type namespacing, real-recipient resolution, chronological order) and
one true end-to-end check -- start a real MailDev instance, replay real
items through real SMTP, then fetch MailDev's own REST API and assert
the delivered subject/body/recipient match the generated content
exactly, not just that the send call didn't throw.

---

## Shipped: Apollo Client adapter, funnel-targeted generation, natural-language generation (2026-07-25)

The remaining three items from that same external review, after the
React Query adapter and `mail`.

**Apollo Client adapter.** Added `eco-faker/apollo`, exporting
`createEcoFakerApolloClient(dataset)`. Wraps the same executable schema
`toGraphQLSchema`/`serve --graphql` already build in Apollo's own
`SchemaLink` -- the officially-documented SSR/mocking pattern
(`@apollo/client/link/schema`), not a custom transport reimplementing
what Apollo already does well. 3 tests, all passing, using a real
`ApolloClient` + `SchemaLink` against a real generated dataset -- no
mocking. One thing worth recording: the first version of the byId test
failed with a cache-normalization error that looked like an Apollo
Client v4 `InMemoryCache` bug at first glance. It wasn't -- the actual
field name is `ordersById` (plural table name + `ById`, matching the
tRPC/GraphQL adapters' own convention), not the singular `orderById` the
test had guessed. The adapter was correct the whole time; the lesson was
in the debugging, not the implementation -- isolate with the raw
`graphql-js` `execute()` call before suspecting the client library.

**Deliberately no Relay adapter** -- written up in the README's Apollo
section rather than here, since the reasoning is the kind of thing a
future reader looking at the adapter list needs right there: Relay
expects `relay-compiler`-generated query artifacts, not raw GraphQL
documents executed ad hoc, so a hand-rolled Network layer would only
work with an unusual slice of real Relay usage. Shipping something that
looks supported but mostly isn't felt worse than not shipping it.

**Funnel-targeted generation.** Added `src/funnel-target.ts` --
`generateWithTargetFunnel({ target, overrides })`, wired into `generate`
as `--target-funnel-rate`/`--target-funnel-tolerance`. Binary-searches
`abandonmentRate` across repeated, ordinary `generate()` calls until the
dataset's own `computeAnalytics().funnel` (the exact same numbers the
dashboard reports, not a separate calculation) lands within tolerance of
the target -- the generation loop itself is never touched, same
discipline every other post-processing feature here follows, just
applied to config search instead of a new table. Full writeup of *why*
`abandonmentRate` is the one real lever (and why `viewed -> added_to_cart`
isn't targetable without a core-loop change) is in the README and in
the module's own doc comment, not duplicated here.

An unreachable target (extreme value, tight tolerance, small scale)
terminates cleanly and reports the closest rate actually found rather
than silently returning a dataset that misses -- covered by a dedicated
test asserting `withinTolerance: false` on a target of `1.0`.

**Natural-language generation.** Added `src/nl-generate.ts` --
`translatePromptToConfig({ prompt })`, wired into `generate` as
`--prompt`/`--api-key`/`--model`. Calls the Anthropic Messages API
directly via `fetch` (no SDK dependency -- one well-documented REST
call didn't justify a new dependency plus its own version churn), sends
the real `config.schema.json` so there's no separate, driftable copy of
"what fields exist," and validates every candidate response through
`resolveConfig` -- the exact same validator a real dataset generation
uses. An invalid first attempt gets one corrective follow-up turn with
the *real* validation error before giving up.

Two real bugs, both caught by writing the test before trusting the
happy path:

- ajv's default `additionalProperties` message doesn't name the
  offending key ("must NOT have additional properties" -- which one?),
  which is useless as feedback to hand back to the model on retry. Added
  a dedicated error formatter (using `error.params.additionalProperty`)
  specifically for this feedback loop, separate from `resolveConfig`'s
  general-purpose error message.
- A test using `vi.fn().mockResolvedValue(response)` across multiple
  calls failed on the second call with "Body is unusable: Body has
  already been read" -- a real `Response` body can only be consumed
  once, and `mockResolvedValue` (vs. `mockResolvedValueOnce`) hands back
  the identical object every time. Fixed by building a fresh `Response`
  per call.

8 tests, all using an injected fake `fetch` -- no real API key or
network call required to verify the parsing/validation/retry logic,
which is where the actual risk lives.

**One more bug, found by accident while writing the funnel-target
tests, unrelated to any of the three features above but real and worth
fixing while it was isolated:** a test using `locale: "en-GB"` threw
`The locale data for 'person.first_name' are missing in this locale`.
`localeToFakerModule` was constructing `new Faker({ locale: en_GB })`
with no fallback chain -- per faker-js's own docs, only the *prebuilt*
faker instances (`fakerDE`, `fakerFR`, ...) get an automatic English
fallback; a custom `new Faker({ locale: X })` needs it stated
explicitly (`[X, en, base]`), or any field that locale's data doesn't
fully cover throws instead of falling back. This affected every
non-`en-US` locale (`en-GB`, `es-ES`, `de-DE`, `fr-FR`, `vi-VN`) and
every command that accepts `--locale`, not just the new funnel-search
code that happened to surface it. Fixed with the documented
`[locale, en, base]` fallback chain, plus a new `tests/locale.test.ts`
running `generate()` end-to-end for all six configured locales -- there
was no test coverage exercising a non-default locale before this.

CI: added a `cli-e2e` step verifying `--prompt` fails cleanly (not a
crash) when no `ANTHROPIC_API_KEY` is set -- the one CLI-observable
behavior of the NL-generate wiring that doesn't require a live API key
as a CI secret.

---

## Shipped: contract testing (`test --contract`) and time-travel regression (`warp`) (2026-07-25)

The two items that were explicitly on hold -- with the important caveat
recorded here plainly: this ROADMAP itself scoped full contract testing
as **multi-week, its own milestone, not a bolt-on**. What shipped today
is a real, working, honestly-scoped slice of that -- the read-path --
not the full stateful-scenario-replay vision from that earlier design
pass. Worth remembering next time this gets picked back up: the
mutation/multi-step half is still genuinely unbuilt, not just polished
further.

**Contract testing.** Added `src/contract-test.ts` (`runContractTest`),
wired into the CLI as `test --url --contract`, plus a small companion
command `openapi-export` (dump the OpenAPI contract `serve --openapi`
would expose, without starting a server -- otherwise there was no way
to get a contract file to test against without spinning one up first).
Fires real GET requests at a live API for every read operation in an
OpenAPI 3.0 contract, validates status + body against the declared
schema (`$ref`-resolved via ajv, formats via `ajv-formats`), and sources
`{id}` path params from real ids harvested off each resource's own list
response rather than a fabricated dataset -- which means a server
returning 404 for an id it just listed gets caught for free, without
any dedicated "consistency check" logic.

Two real, separate bugs surfaced while building this against eco-faker's
*own* `openapi-export` output -- not edge cases invented for the test
suite, the very first real contract this ran against:

- `{ $ref: X, nullable: true }` is common OpenAPI 3.0 shorthand, but
  it isn't valid JSON Schema draft-07: `nullable` requires a sibling
  `type` keyword, which a bare `$ref` doesn't have, and `$ref` siblings
  are ignored by draft-07 tooling anyway. ajv refused to *compile* any
  schema reachable from one of these (`anomaly`, `shippingAddress`,
  `fraud` -- five sites total), which is a hard failure, not a
  warning -- every single contract check failed with the same opaque
  error until this was traced back to `openapi.ts`. Fixed with a
  `nullableRef()` helper using `oneOf: [{$ref}, {type: "null"}]`,
  which is both valid draft-07 and OpenAPI 3.1's own recommended
  replacement for `nullable` (which 3.1 dropped entirely).
- Separately: none of `RESOURCE_SCHEMAS`/`SHARED_SCHEMAS` declared
  `required` fields at all. An empty `{}` response trivially
  "validated" against almost every resource schema, since JSON Schema's
  `properties` doesn't imply presence without an explicit `required`
  list. This wasn't contract-test-specific either -- it made the whole
  exported OpenAPI contract far weaker than a contract should be, for
  anyone consuming it, not just this new command. Fixed by deriving
  `required` mechanically from each schema's own `properties` (every
  field required unless it's `nullable`/a null-union), so it can never
  drift out of sync with a hand-maintained list the way a manually
  authored `required` array would.

Both fixes were verified the same way: rerun the "compliant server"
test using real generated data across every table, confirm zero
failures now that the contract itself compiles and actually asserts
something. 7 tests in `tests/contract-test.test.ts`, including one that
specifically proves `ajv-formats` is doing real work (a non-UUID `id`
gets caught), not just silencing the "unknown format" warning it
otherwise prints.

Manually verified end-to-end, more than once, before trusting it:
`openapi-export` -> `serve` -> `test --contract` round-trip against a
real running server (42/42 real HTTP requests passing), plus the
`--api-key`/`--header` auth path specifically (401s without a header,
all-pass with the right one -- confirming the byId-id-sourcing chain
degrades correctly when upstream requests are blocked, rather than
crashing).

**Time-travel regression.** Added `warp --snapshot --days` to the CLI
(no new module -- it's a thin, deliberately thin, composition of
`generate()`, `serialize()`, and the existing `diffDatasets`/
`formatDiffReport` engine `diff` already uses). Shifts a snapshot's
`referenceNow` by N days and regenerates -- verified empirically, not
assumed, that `generate(config, referenceNow)` is fully deterministic
in both arguments: the warped dataset has identical ids, statuses,
totals, and relationships to the original, with every date field
shifted by exactly N days and nothing else differing. `--diff` reuses
`diffDatasets` to compare the two structurally.

Stated as plainly in the README as here: `--diff` will almost always
report zero drift right now, because nothing in eco-faker's generation
logic reads the actual calendar (month, day-of-week, real "today") --
every date is a pure offset from `referenceNow`. That's not a weak
result, it's the useful one -- proof the scenario is genuinely
time-shift-stable -- and `--diff` becomes an active regression guard
the moment any future feature *does* introduce calendar-dependent
behavior (a holiday date-range check, a day-of-week rule), catching it
as real row-count/status-distribution drift instead of passing
silently. No dedicated unit tests for `warp` itself -- every piece it
composes (`generate`, `diffDatasets`, snapshot loading) already has its
own coverage, so the CLI e2e suite (`.github/workflows/ci.yml`) covers
the composition: a base run vs. its `--days +30` warp, asserting every
field on `orders[0]` matches except `createdAt`, which must differ by
exactly 30.0 days -- verified locally before trusting it to CI, same as
every other e2e step added this session.

---

## Shipped: AI dataset export (`ai-export`) (2026-07-26)

A reframing, not a new generation module: `src/output/ai-dataset.ts`
takes an already-generated dataset and reprojects it into four artifacts
aimed at testing AI systems specifically -- Text2SQL question/SQL/
groundTruth pairs, a RAG-ready document corpus, agent-testing scenarios,
and an LLM eval set. No new tables added to `Dataset`, nothing here
changes what `generate()` itself produces. Wired in three places: the
`ai-export` CLI command, a `generate_ai_dataset` MCP tool (writes to disk
and returns counts + a small sample, same pattern as
`visualize_journey`), and `tests/ai-dataset.test.ts` (18 tests).

Distinct scope from **Support Tickets** and **Transactional Emails &
Review Text** above: those modeled *what a real e-commerce backend looks
like*. This reframes the same underlying data one more time for
*evaluating an LLM or agent against it* -- the original "AI Dataset Mode"
roadmap item's RAG/agent-testing/Text2SQL/LLM-eval half that neither of
those two rounds actually covered.

**Text2SQL pairs are the one artifact here making a falsifiable claim --
that a piece of real, executable SQL returns a specific real answer --
so unlike prose generation, this was actually checked against a real SQL
engine, not just asserted from types.** No SQL engine ships as a
dependency, so verification used Node 22's built-in `node:sqlite`
(experimental, absent on the Node 20.x line this project's own CI matrix
also runs) as a one-time check before writing any pair, loading each
generated dataset via this project's own `generate --format sql` output.
`tests/ai-dataset.test.ts` re-runs this same check but skips gracefully
if `node:sqlite` isn't available on the running Node version, rather than
failing CI on a runtime that doesn't have it.

**Three real bugs, all caught by that verification, before any pair was
trusted:**

1. Two pairs ("orders with no shipment", "top 5 low-rated products") had
   no `ORDER BY` in the SQL at all. Their JS-computed groundTruth arrays
   matched the real SQL result *as sets* but not *as sequences* -- exactly
   the kind of thing that passes a naive equality check on small data and
   fails silently (or non-deterministically) on a real run. Fixed by
   adding an explicit `ORDER BY` to the SQL and sorting the JS groundTruth
   the same way, with an explicit tie-break (`p.name ASC`) where the
   primary sort key alone doesn't uniquely order the rows.
2. `SUM(refund_amount)` over zero matching rows is SQL `NULL`, not `0`.
   The groundTruth for "total refund from rejected returns" defaulted to
   `0` via a JS `reduce`'s initial value, disagreeing with the real
   answer the instant a dataset had zero rejected returns (which a
   smaller `scaleFactor` run hits often). Fixed to `null` when there are
   no matching rows, mirroring real SQL semantics instead of masking them.
3. Floating-point summation isn't associative: SQLite's accumulation
   order and this module's own `reduce` order can disagree in the last
   few bits of a large sum. A larger dataset (`scaleFactor: 800`) produced
   `4013266.9899999998` from the raw SQL sum against a groundTruth of
   `4013266.99`. Fixed by wrapping the SQL in `ROUND(..., 2)` to match the
   JS-rounded groundTruth -- both sides now genuinely agree instead of
   agreeing "close enough for a human reading the number."

**A fourth bug, unrelated to the text2sql pairs themselves, surfaced
while wiring the CLI command:** `generateAiDataset` read
`dataset.config.seed` directly for its RNG offset, but `dataset.config` is
deliberately excluded from `generate --format json` output (see
`output/json.ts`) -- exactly the same gotcha `analytics.ts`'s own doc
comment already flags for its funnel computation. A dataset round-tripped
through `generate -o file.json` then `ai-export --input file.json` (the
single most common way this command will actually get used) crashed
immediately on `Cannot read properties of undefined (reading 'seed')`.
Fixed with `dataset.config?.seed ?? 0` -- this only affects *which* real
records get sampled into pairs/scenarios, every value inside a pair is
still a real, directly-computed fact regardless of which seed picked it.
A regression test for this exact round trip is in the test suite now.

**Agent scenarios use `query_table` -- the real generic MCP tool this
project's own server already exposes** (`src/mcp.ts`), not an invented
tool surface, so a real agent-testing harness can replay these
`expectedToolCalls` against a real MCP session and compare, not just
against documentation of what a tool call should look like.

**"Chat messages" scope note carries over unchanged from Support
Tickets:** the RAG corpus draws from support messages, emails, and
reviews -- the same three real free-text sources, no live-chat table
invented here either, for the same reason stated when Support Tickets
shipped.

## Shipped: stateful/mutation contract testing (`test --mutate`) (2026-07-26)

The half of contract testing explicitly left unbuilt when the read-path
engine shipped (see "Shipped: contract testing... and time-travel
regression" above, which states plainly: "the mutation/multi-step half is
still genuinely unbuilt, not just polished further"). New
`src/mutation-test.ts` (`runMutationTest`, `buildSeedBodiesFromDataset`),
wired into the existing `test` CLI command as a `--mutate` flag (plus
`--seed <dataset.json>`, `--concurrency`, `--idempotency-header`) rather
than a new command -- it's the same contract, the same base URL, just a
different slice of operations against it.

Five checks, matching exactly what this was scoped to cover:
`not_found`, `unauthorized`, `duplicate_submission`, `race_condition`,
`invalid_transition`. The `OpenApiDocument`/`OpenApiOperation` types in
`contract-test.ts` gained an additive `requestBody` field for this --
the read-path engine still never reads it.

**`invalid_transition` is the one genuinely automatic check here, not a
configured one.** Any schema in `contract.components.schemas` with an
ordered `enum` on its status field -- exactly how this project's own
`openapi.ts` already declares `orders.status: [processing, shipped,
delivered]` -- is enough to attempt a real backward transition (PATCH the
byId resource back to the enum's first value) and assert it's rejected
with a 4xx. No separate state-machine description has to be hand-authored
for this to work, because the contract's own enum ordering already
carries that information for any OpenAPI document that declares one this
way. The trade-off, stated plainly: a contract whose status enum isn't
declared in real forward order, or that doesn't use an enum at all for
its state field, gets no invalid_transition coverage at all -- there's no
fallback heuristic for that case, and adding one that guesses at
state-machine order from field names would risk asserting something the
contract never actually promised.

**`duplicate_submission`/`race_condition` need a real POST body to fire,
so there's no way to run either without one.** `buildSeedBodiesFromDataset`
matches a contract's collection path to a real eco-faker dataset table by
its last path segment (`/api/orders` -> `orders`), best-effort and
explicitly named as such -- a path with no matching table is left out
of the returned map entirely, not filled with a fabricated placeholder.
`runMutationTest` itself extends the same principle
`runContractTest` already established for a byId path with no sample id:
a POST path with no seed body is skipped with a clear `error` naming the
exact reason, never silently ignored.

**Duplicate/race detection works by comparing the `id` a server's own
response returns, not by re-listing and counting.** Fire the same POST
twice (or `N` concurrently) with an identical `Idempotency-Key`; a
correctly-implemented server returns the same real id both times, a
buggy one returns two different ids. This is simpler and more direct
than a list-count-delta approach, and sidesteps needing to know how a
given backend's list endpoint paginates or filters.

**Verified against a real, hand-built HTTP server, not just
`fetchImpl`-injected fakes -- both matter and both were used.**
`tests/mutation-test.test.ts` uses the same in-memory `fetchImpl`
injection technique `contract-test.test.ts` already established, with
one compliant server and three intentionally-buggy variants (no
idempotency handling, allows a backward status transition, skips the
401 check), proving each real bug gets caught, not just that a
compliant server passes. Separately, a real `node:http` server on a
real port was run and torn down manually, and `my-eco-gen test --url
--contract --mutate --seed` was fired at it end-to-end -- 8/8 write-path
checks passing against the compliant version, including watching
`race_condition` actually resolve 5 concurrent real HTTP requests to one
resource. Both are necessary: the fake-`fetchImpl` suite is what CI
actually runs and is what proves each specific bug class gets caught;
the one real-server run is what confirms the whole CLI wiring (option
parsing, header formatting, real network I/O, real concurrency) works
outside of a mocked fetch, the same reasoning the Scenario Composer's own
"both layers verified, neither one trusted blind" note gave for its
fake-loader-vs-real-file split.

**What's still open, stated the same way the read-path engine's own scope
note was:** no cross-resource stateful scenario replay (create an order,
then attempt to cancel it after a shipment already exists, spanning two
resources in sequence) -- every check here is a single mutating request
against a single resource, not a multi-step scenario. That's a genuinely
larger undertaking, not a polish pass on what shipped today.

---

## Shipped: framework scaffolding CLI (`init next` / `init msw`) (2026-07-26)

The last item from the original "Remaining items" list above -- `npx eco-faker init` for Next.js/Prisma/Drizzle/MSW. Shipped as `init next` and `init msw`, exactly the "first slice" scoping an external review of this roadmap recommended: the two frameworks covering the largest share of likely users, not all four up front. New `src/scaffold.ts` (`buildScaffold`, pure template functions, no CLI coupling), wired into the existing `init` command as an optional positional `[target]` argument, plus `tests/scaffold.test.ts` and `tests/cli-init.test.ts` (18 tests total).

**A real naming collision had to be resolved, not glossed over.** `init` already existed -- `init --schema <path>` introspects an existing Prisma/Drizzle/SQLAlchemy/OpenAPI schema and writes a `mapping.json`. The word "prisma" already means something in that flow (`--schema-type prisma`). Adding a *third*, different meaning for "prisma" as a scaffold target (`init prisma` -> write a new seed.ts) would've put two unrelated meanings of the same word two lines apart in one `--help` output. Resolved by keeping `init prisma` out of scope entirely rather than disambiguating around it -- `init --schema ./schema.prisma` already covers Prisma seeding end to end, so this was never actually a gap, just a name that was already taken for something else. `init <target>` and `init --schema` are mutually exclusive and error with an explicit explanation if both are given in the same call, rather than one silently winning.

**Two real bugs, both caught by actually running the generated files, not just reading the template strings:**

1. The `next` scaffold's seed script used raw `JSON.stringify(dataset)` instead of this project's own `serialize(dataset, "json")` -- leaking the internal `config` field that `output/json.ts` deliberately excludes everywhere else `generate --format json` is used. A generated `eco-data.json` from the scaffold looked subtly different from every other JSON export this project produces. Caught by actually running the generated script and diffing its output's keys, not by reasoning about what it should do.
2. The `msw` scaffold's generated handlers paginate with `?page=&pageSize=` (`toMswHandlers` reuses `serve`'s own query semantics), not the more common `?limit=&offset=`. Nothing errors on the wrong param name -- `serve`'s query API treats any unrecognized param as an exact-match filter on that field, so a request with `?limit=2` silently filters on a field named `limit` that doesn't exist and returns zero rows. Caught by firing a real `fetch()` at the generated MSW server with `?limit=` first (got an empty, statusless-looking 200) before trying `?pageSize=` (worked) -- an easy one to miss by inspecting `toMswHandlers`'s types alone, since nothing in the type signature signals this. Fixed by documenting the real convention directly in the generated `mocks/eco-handlers.ts` file, not just in this project's own README.

**Verified two ways:** `tests/scaffold.test.ts` checks the template strings and actually executes the generated `next` seed script end to end against this project's own real `generate`/`serialize`, comparing its output to a directly-computed reference. `tests/cli-init.test.ts` spawns the real CLI (`npx tsx src/cli.ts init ...`) against a fresh temp directory for every branch: `init next`, `init msw`, `--seed`, an unknown target, both a target and `--schema` together, neither given, refusing to overwrite without `--force`, `--force` actually overwriting, and -- critically -- confirming the pre-existing `init --schema` e2e path this project's own CI already exercises (`.github/workflows/ci.yml`'s `init --schema http://localhost:4600/openapi.json`) still works completely unchanged.

**What's still open:** `init prisma`/`init drizzle`/`init sqlalchemy` as scaffold targets (writing a real `seed.ts` that inserts through an existing ORM, distinct from the mapping.json `--schema` flow) -- genuinely useful, deliberately deferred rather than rushed into the same naming slot `--schema-type` already occupies. Any future scaffold target reusing an ORM's name needs its own resolution of the same naming tension this round resolved for "prisma," not a repeat of the collision.

## Shipped: dev container + Showcase section (2026-07-26)

The two "nice-to-have, low-effort" items from the same external review that recommended the scaffolding CLI above.

**`.devcontainer/`** -- `Dockerfile` (Node 22, git, `psql`; distinct from the repo-root `Dockerfile`, which is a slim multi-stage *production* build that deliberately omits devDependencies), `docker-compose.yml`, `devcontainer.json`, `post-create.sh`. Deliberately **not** sharing the root `docker-compose.yml`'s `postgres` service via a merged compose file (`devcontainer.json`'s `dockerComposeFile` array supports this) -- worked through and rejected, not just skipped: the root file also defines a one-shot `seed` service using plain, non-idempotent `INSERT INTO` statements, correct for its own documented one-time workflow (`docker compose up` from the repo root) but would restart and re-insert into already-seeded data on every dev-container rebuild if merged in, hitting real primary-key violations. `.devcontainer/docker-compose.yml` is self-contained instead (`postgres` + `app` only), and the one-time seed itself checks `to_regclass('public.orders')` and row count before generating or inserting anything, so rebuilding just the `app` service doesn't reseed on top of data a previous rebuild already loaded.

**Honestly flagged, not glossed over: this hasn't been run against a real Docker daemon.** This sandbox has neither Docker nor a reachable Postgres apt mirror (`apt-get install postgresql` failed on a genuine 404 from the mirror, not a permissions issue) to actually build and start the container end to end. What *was* checked: JSON/YAML/bash syntax on every file, and that every command the seed script runs (`npm install`, `npm run build`, `generate --format sql`, `psql -f`) is the same one the root `docker-compose.yml`'s own `seed` service already runs successfully in this project's own CI. The `to_regclass`-based skip-if-seeded guard and the container build itself are unverified. This is stated plainly rather than left implicit, the same way any other real limitation in this project gets called out.

**Showcase section** -- filled with this project's own real, live artifacts (the two GitHub Pages demos, the npm package, the one-command Postgres seed, this same dev container) rather than left empty or padded with invented external projects, per the same review's own suggestion to "start by featuring your own examples." A second table for genuine community submissions stays separate and empty, with a clear call to action -- keeping "things eco-faker itself ships" and "things other people built with it" from being conflated in one list.

## README trim: removed Testing and Showcase sections, cut narrative prose (2026-07-26)

Per direct request, not a feature round. The README's `## Testing` section had grown into one single, enormous paragraph -- effectively a condensed duplicate of this file's own "Shipped" history, crammed into one run-on block rather than the numbered list it started as. Removed entirely; this file (`ROADMAP.md`) is the actual detailed history and always has been the stated source of truth for it. `## Showcase` (added just one round ago, directly above) was also removed per the same request -- noted here so this file's own history stays honest: that section shipped, then was removed, rather than pretending it was never added.

Beyond the two full-section removals, every feature section's "one real bug found and fixed" / "verified N ways" narrative paragraphs were cut throughout -- that content isn't gone, it lives here, in each feature's own "Shipped" entry above, which is where it was always duplicated from. What's left in the README per feature is deliberately just: what it does, the command, and the one or two caveats that actually change how you'd use it correctly (a real footgun, a real scope boundary) -- not the story of how each one got built. 1609 lines -> 838.

## Shipped: realism score (`score`), performance regression check, and a reusable GitHub Action (2026-07-26)

Three of the smaller, more tractable items from the same kind of external "what's missing" review that suggested the scaffolding CLI and dev container in earlier rounds -- picked specifically because they were the cheapest/most tractable of a much longer list (a VS Code extension, an interactive schema-designer GUI, BDD/Gherkin integration, an AI-text-fill mode, data versioning/lineage, Great Expectations export, DB snapshot/restore with anonymization, OpenAPI-examples-based mocking, and CLI shell completion were all in that same list and are **not** built -- several are explicitly multi-week efforts even by that review's own estimates, and building a thin, unconvincing slice of each felt worse than doing a few properly).

**`my-eco-gen score`** (`src/score.ts`) -- a composite 0-100 realism score across five dimensions. Four of them (`referential_integrity`, `financial_consistency`, `temporal_plausibility`, `uniqueness`) are deliberately not a second, parallel implementation of "is this data internally consistent" -- they reuse `lintDataset`'s own existing rules directly, just reframed as a continuous rate instead of a pass/fail list, so the two checks can never drift apart from each other. `distribution_shape` is the one genuinely new dimension: whether `orders.total` looks like a real right-skewed retail order-value distribution (coefficient of variation + skewness), stated plainly as a heuristic rather than a validated statistical test. `overall` is a simple unweighted mean of the five -- also stated plainly, not a tuned/validated weighting.

**One real bug, caught by a test before it shipped:** the rate-based dimensions originally *rounded* a score like `100 * (1 - 1/13877)` to the nearest integer, which produces exactly `100` -- indistinguishable from zero real issues, on any table large enough that a single violation rounds away. A test that introduced exactly one real orphaned foreign key against ~14k total records got back a 100 and failed as intended. Fixed by flooring instead of rounding, so any nonzero issue count always registers below 100. 12 dedicated tests (`tests/score.test.ts`) plus 2 MCP tests; also exported as `computeRealismScore` and a `score_dataset` MCP tool.

**`scripts/perf-regression.mjs`** -- generation-time/memory regression guard, same "run against compiled `dist/`, not `src/`" convention `benchmark.mjs` already established. Takes the median of 5 runs (a single run's timing is noisy enough on a shared CI runner to produce false failures unrelated to any real regression) and compares against a committed `perf-baseline.json`, failing if generation time regresses beyond 35% or heap delta beyond 50% (memory gets a more generous threshold since it's measured without a forced GC unless the caller passes `--expose-gc`, stated plainly as a noisier measurement). Deliberately does **not** auto-commit an updated baseline the way `benchmark.mjs` auto-commits `benchmark-results.json` -- doing that here would let a real, gradual regression quietly become the new accepted baseline on every push, which defeats the entire point of the check. Wired into `ci.yml` as its own job; `--update-baseline` to accept an expected regression deliberately, locally, by hand.

**`.github/actions/seed-database/`** -- a reusable composite GitHub Action wrapping the "generate a dataset, lint it, seed a real Postgres" workflow, for other repos to consume in their own CI (`uses: Hung1510/Eco-Faker/.github/actions/seed-database@main`) instead of hand-copying shell steps. Scoped to Postgres only, stated plainly -- eco-faker's own SQL output is Postgres-flavored, so claiming MySQL/other-database support here would be broader than what's actually true. **Every shell command the action's steps run was verified for real** (installed the CLI via `npm link`, ran the exact `generate --format json` / `generate --format sql` / `lint --input` commands the action scripts, confirmed row counts and a clean lint result) -- but the action's YAML plumbing itself (composite-action schema, `$GITHUB_OUTPUT` interpolation, the whole thing running inside an actual GitHub Actions runner against a real `services: postgres:` block) has not been exercised end-to-end on real GitHub infrastructure, which this file and the action's own README both say plainly rather than implying it's been fully proven out.

## Shipped: CLI docs command + shell completion (`docs`, `completion`) (2026-07-26)

The last of the smaller, tractable items from the same external review, picked specifically because it was the cheapest of what was left (~1 day by that review's own estimate). Commander 12 (this project's CLI framework) has no built-in shell-completion generator, unlike oclif -- so both of these are hand-built, not a thin wrapper around something the framework already provided.

**`my-eco-gen docs [topic]`** (`src/docs.ts`) -- parses the real README's own `##`/`###` headings at runtime and matches `topic` case-insensitively against them, rather than a hand-maintained topic->section table that would drift the moment a heading changes (exactly the class of bug this project has fixed more than once elsewhere -- a hand-maintained `required` list, a hand-maintained field list -- solved the same way again here: derive it from the real source). `githubSlug()` replicates github-slugger's actual algorithm (lowercase, strip non-word/hyphen/space characters, convert every space to a hyphen one-for-one, never collapsed) -- verified against this project's own real README headings, including a heading with parens/backticks/a double-dashed flag name (`Contract testing (\`test --contract\`)` -> `contract-testing-test---contract`, three hyphens, not one), not just asserted from a description of the algorithm. The repo URL itself is derived from `package.json`'s own `repository.url` rather than a second hand-typed copy of it.

**`my-eco-gen completion <bash|zsh|fish>`** (`src/completion.ts`) -- every generated script is built from the real, live list of registered subcommands and their real flags, introspected off the actual Commander `program` at the moment `completion` runs, for the same "don't hand-maintain something that can drift" reason as `docs` above.

**Verified three different ways, appropriate to what each shell actually allows:**
- **bash** -- actually sourced the generated script in a real bash process and simulated real tab-completion (`COMP_WORDS`/`COMP_CWORD`/`compgen`), confirming `sc` really completes to `scenarios score` and `generate --fo` really completes to `--format` and nothing else.
- **fish** -- fish supports genuine non-interactive completion testing (`complete -C 'my-eco-gen sc'`), so this one was actually exercised the same way bash was, not just syntax-checked.
- **zsh** -- `zsh -n` confirms real syntax validity, but `compadd` (the function zsh's completion scripts call) can only run from inside a real interactive Tab-press dispatch, which nothing short of a real terminal session can exercise -- stated plainly as the one part of this that's syntax-verified but not behavior-verified, the same category as this project's own devcontainer/GitHub-Action disclosures.

**Two real bugs, both caught by actually running the generated scripts, not just reading them:**
1. **Fish also completes real filesystem paths at the subcommand position.** A real `scripts/` directory in the working tree showed up alongside the intended `scenarios`/`score` completions for the prefix "sc" -- fish's default behavior offers path completion everywhere unless a `complete` rule is marked exclusive. Fixed by adding `-x` to the subcommand-name completions specifically (flag-name completions were left as-is, since a value after a flag like `--input` may legitimately want real path completion).
2. **The browser-opener hung the whole process indefinitely in any non-TTY context.** `docs` originally used `exec()` and called `.unref()` on the returned `ChildProcess` -- but `exec()`'s own internal stdout/stderr pipes kept the Node event loop alive regardless, since `.unref()` only detaches the child-process handle itself, not the streams `exec()` sets up around it. A CLI-spawning test (a `my-eco-gen docs score` subprocess launched from the test suite, no TTY attached) hung until forcibly killed. Fixed by switching to `spawn(command, args, { detached: true, stdio: "ignore" })` -- no piped stdio to keep anything open, a genuinely detached child, `.unref()` now actually sufficient on top of that. Re-verified the hang was gone both by hand (a direct, timeout-guarded run) and via the previously-hanging test suite.

31 new tests across `tests/docs.test.ts`, `tests/completion.test.ts`, and `tests/cli-docs-completion.test.ts` (which spawns the real CLI, the same way `tests/cli-init.test.ts` already does for the `init` command).

## Shipped: VS Code extension (`vscode-extension/`) (2026-07-26)

The one item from the original external review that was explicitly flagged as its own, different kind of undertaking -- "a different tech stack/packaging entirely" -- rather than a slice of the same CLI codebase. Built as the review's own suggested "first slice": a **Generate Dataset** command (prompts for users/scenario/format/output path) plus **Scaffold Next.js/MSW Integration** commands, all three shelling out to the real CLI (`my-eco-gen` if it's on `PATH`, `npx eco-faker` otherwise) rather than reimplementing any generation logic a second time. A table viewer / relationship explorer inside the editor -- the review's own suggested "later" -- is not built; the CLI's own `visualize`/static-demo browser tools already cover a version of that outside the editor.

Structured as a fully standalone package (`vscode-extension/`, its own `package.json`/`tsconfig.json`/`node_modules`), not folded into the root project's own build -- a VS Code extension is a genuinely different publishing target (the Marketplace, via `vsce`) from the `eco-faker` npm package the rest of this repo produces, and conflating the two package.json files would make neither one make sense on its own.

**Split deliberately into a pure, fully-tested layer and a thin, unverified UI layer, because only one of those two is actually testable here.** `src/cliRunner.ts` -- everything that builds a command-line invocation, resolves an output path, or decides between `my-eco-gen` and `npx eco-faker` -- has zero dependency on the `vscode` module, specifically so it's unit-testable with plain Node. `src/extension.ts` is deliberately kept as thin as possible on top of it: command registration, `QuickPick`/`InputBox` prompts, a progress notification, nothing more.

**15 tests, several of them real integration tests, not mocks:** beyond unit-testing every pure function in `cliRunner.ts`, `tests/cliRunner.integration.test.ts` actually spawns the real, compiled root-project CLI (`dist/cli.js`) through the exact same `runCli` function the extension itself calls -- generates a real 20-user dataset and asserts the real row count, runs a real `init msw` scaffold and asserts the real files it wrote, and confirms both a bad-flag failure and a spawn failure against a nonexistent binary come back as `{ ok: false }` results rather than a hang or a thrown exception.

**Three real bugs, all caught before or while getting this to a genuinely clean state:**
1. `vscode.window.showQuickPick` widens a typed literal array's selection back to plain `string | undefined` -- a real type error (`OutputFormat` expected, `string` given) that only shows up once the extension's own code is type-checked against real `@types/vscode`, not something a description of the API would predict.
2. **My own integration test miscounted directory levels.** `repoRoot` was resolved as two levels up from `__dirname`, correct for the *source* test file's location but not the *compiled* one (`dist-test/tests/`, one level deeper) -- both integration tests failed with a real `MODULE_NOT_FOUND` on first run, for a real reason, not a flaky one. Fixed by counting three levels up and leaving a comment explaining why the count isn't the "obvious" one.
3. **`vsce package` produced a real, valid `.vsix` on the very first attempt** -- but flagged two genuine, worth-fixing warnings: no `LICENSE` file reachable from the extension's own directory (the repo has one, one level up, which `vsce` doesn't look outside the package root for), and no `.vscodeignore`, which meant the packaged `.vsix` shipped `src/`, `tests/`, `dist-test/`, and every `tsconfig*.json` alongside the actual runtime bundle. Fixed by copying the license in and adding a `.vscodeignore` -- the resulting package went from 15 files down to the 6 that actually matter.

**Verified about as far as this environment allows, stated plainly where it stops.** `esbuild` bundling was run for real (`vscode` confirmed correctly externalized -- the bundle genuinely fails to `require("vscode")` outside a real Extension Host, exactly as it should), and `vsce package` was run for real, twice, producing an actual installable `.vsix` both times. The entire CI job this round added (`vscode-extension`: compile, test, build, package) was also simulated locally end-to-end from a clean `npm ci`, not just written and assumed correct. **What was not, and could not be, verified here: `extension.ts` itself, running inside a real VS Code Extension Host.** `@vscode/test-electron` needs to download the actual VS Code binary from `update.code.visualstudio.com`, a host this environment's network restrictions don't reach -- so the command-registration/QuickPick/progress-notification flow is untested UI glue sitting on top of a fully tested core, not a fully proven-out feature. Both this file and the extension's own README say so directly, the same disclosure pattern already established for the dev container and the GitHub Action.

## Shipped: VS Code extension table viewer (`eco-faker: View Dataset Tables`) (2026-07-26)

The natural next slice on top of the VS Code extension shipped just before this -- a webview that browses any generated `dataset.json`: switch tables, search across every column, click a header to sort, page through results. Entirely client-side once the file is loaded, same "no server" approach the root project's own `web-static/explorer.html` already uses.

**Structured to avoid a specific drift risk this project has hit before in different forms:** the table viewer's entire client-side behavior (`src/tableViewer.ts`) is one template string, embedded exactly once into the generated HTML. There's deliberately no second, TypeScript-native copy of that same filter/sort/paginate logic written separately "for testing" -- writing one real version and one near-identical test-only version would have been exactly the kind of two-copies-that-can-disagree problem already fixed elsewhere in this project (a hand-maintained required-fields list, a hand-typed docs URL). Instead, `tests/tableViewer.test.ts` loads the *exact* generated HTML via [jsdom](https://github.com/jsdom/jsdom) -- the same technique the root repo's own `scripts/smoke-test-static.cjs` already established for its static demo -- and actually fires real DOM events at it: dispatching a real `change` event on the table `<select>`, a real `input` event in the search box, a real `click` on a column header, real clicks on Prev/Next. What's tested is the literal thing that ships, not a stand-in for it.

**A real, meaningful bug, not a cosmetic one, caught directly by that jsdom execution:** the dataset was embedded as `JSON.stringify(dataset)` inside a `<script>` tag with no escaping. Any string value anywhere in the dataset containing a literal `</script>` -- a product review, a support-ticket body, any free text field -- causes the *HTML parser*, not the JS parser, to close the script tag early, corrupting everything after it. A test dataset with a `note` field containing `<script>alert(1)</script>` produced a real `ReferenceError: DATASET is not defined` when the generated page was actually loaded, not a hypothetical. This is a known, named class of bug (the same one React/Next.js guard against for exactly this reason), fixed the standard way: escaping `<` to `\u003c` in the embedded JSON, which JSON/JS parsers read identically to a literal `<` but which never gives the HTML parser a tag-opening character to react to.

**A second bug, this time in the test itself, also only surfaced by actually running it:** the sort test held a reference to a `<th>` element from before the first click, then reused that same stale reference for the second click (toggling ascending -> descending) -- but `render()` replaces `#table-head`'s entire `innerHTML` on every state change, so by the second click that reference was a detached node no longer part of the live document, and dispatching a click on it never reached the delegated listener. The descending-sort assertion failed for a real, specific reason (not a flaky one): a real user re-clicking a real, currently-rendered header always hits a live element, so this was a test artifact of holding a stale reference across a re-render, not a bug in what ships. Fixed by re-querying the live element immediately before each click.

25 tests total for the extension now (up from 15): 8 more directly exercising the table viewer's real, embedded behavior, including HTML-escaping of a dangerous cell value, an empty-table edge case, and genuine multi-page pagination across 30 rows.

**What's still open, the same "later" the original review itself proposed:** a Miller-columns relationship drill-down (User → Orders → Shipment/Returns) matching the CLI's own `web-static/explorer.html` -- a natural next layer on top of this table viewer, not attempted this round. The table viewer also embeds an entire table's rows client-side with no size limit, which is fine for the hundreds-to-low-thousands-of-rows datasets this tool targets for local dev, but stated plainly as a real scaling boundary, not a hidden one.

## Shipped: cross-resource, multi-step scenario testing (`test --scenario`) (2026-07-26)

The exact gap called out verbatim in this file's own "Shipped: stateful/mutation contract testing" entry above: "no cross-resource stateful scenario replay ... every check here is a single mutating request against a single resource, not a multi-step scenario." Closed with `src/scenario-test.ts` (`runScenarioTest`), wired into the existing `test` command as `--scenario <path>` rather than a new command -- same base URL, same auth headers, same seeding story as `--mutate`, just a different, sequential slice of what gets fired at it.

**A scenario is a strict, ordered sequence of real requests threading real captured values between steps** -- create a cart, convert it to an order, ship it, attempt an illegal cancel (expecting a real rejection, not a crash), request a return -- exactly the five-step example this feature was scoped against. Each step's `path`/`body` can reference `{{stepName.field}}` (a value an earlier step's `capture` pulled out of its response) or `{{seed.field}}` (a real value from a dataset passed via `--seed`, reusing the exact same `--seed <dataset.json>` convention `--mutate` already established -- a step needing a real user id doesn't need one hand-typed into the scenario file). `expectStatus` accepts a step's real expected rejection code as a pass, not a failure -- the whole point of testing an illegal transition is that a real 409 there is success. `expectBody` is the actual business-logic assertion: a shallow dot-path check against the real response body, since a step can return the "right" HTTP status while leaving the resource in the wrong state, and status-code checking alone would miss that entirely.

**Deliberately does not also validate each step's response against the OpenAPI contract's declared schema**, the way `test --contract`'s read-path engine does for GETs. Mapping a resolved request path with real ids substituted in back to the contract's own templated path (`/api/orders/{id}`) to look up the right schema is real, separate work, and `expectStatus`/`expectBody` already cover the actual point of this engine -- the business-logic outcome at each stage, which is what the original ask was actually about. Stated as a future enhancement, not silently left out.

**Verified three ways, escalating in realism, the same pattern established for `--mutate`:**
1. A quick, direct check against a hand-built in-memory server implementing the exact five-step lifecycle from the original spec, confirming the full sequence passes with real (not templated) ids threaded through every step, then confirming a deliberately-buggy variant (wrongly allows cancelling a shipped order) gets caught with the exact right diagnostic (`status 200, expected one of [409]`) and stops before the now-meaningless return step.
2. `tests/scenario-test.test.ts` (19 tests): the same lifecycle server and buggy variant as proper `fetchImpl`-injected vitest tests, plus dedicated coverage for template substitution, dot-path resolution, scenario-file structural validation (missing name/steps, duplicate step names), a business-logic mismatch that a "correct" status code alone would miss, real `{{seed.*}}` substitution from a fake dataset, an unresolved-placeholder (typo'd step reference) report, and a real network failure reported distinctly from a failed assertion.
3. **The real CLI, against a real `node:http` server on a real port, twice** -- once against a compliant implementation (5/5 steps passed, real ids visible in the printed output, not templated placeholders) and once against the buggy one (correctly failed at `illegalCancel` with exit code 1, and correctly skipped `requestReturn`). The shipped example file (`examples/scenarios/full-lifecycle.yaml`) was the exact file used for this, not a similar-but-different copy -- what a user would actually run is what got tested.

New: `examples/scenarios/full-lifecycle.yaml`, a real, runnable example scenario file matching the spec this feature was built against, referenced directly from the README's new "Scenario testing" section.

## Shipped: ORM scaffold targets (`init prisma` / `init drizzle` / `init sqlalchemy`) (2026-07-26)

The naming tension flagged and deliberately left unresolved in the framework-scaffolding entry above -- "prisma" already meaning something in `init --schema-type prisma" -- resolved this round, not deferred again, on direct request. Resolution: `init prisma --schema X` is a strict superset of `init --schema X --schema-type prisma`, not a competing meaning of the word. Same parser, same `buildSchemaMapping`, same reviewable `mapping.json` written to the same place -- just with a real seed script on top that actually uses it. `SCAFFOLD_TARGETS` split into `SIMPLE_SCAFFOLD_TARGETS` (`next`/`msw`, no schema needed) and `ORM_SCAFFOLD_TARGETS` (`prisma`/`drizzle`/`sqlalchemy`, `--schema` required) so the CLI can give a precise, specific error either way -- `init next --schema X` says plainly that `next` doesn't take a schema; `init prisma` with no `--schema` says plainly that it needs one.

**Scoped to the six core relational tables** (`users`/`carts`/`abandonedCheckouts`/`orders`/`shipments`/`returnRequests`) -- the ones `generate()` always produces regardless of which optional feature flags are on -- not all ~20 tables it can produce. New `src/orm-scaffold.ts`, and the FK-safe insert order this needed was verified against `output/sql.ts`'s *actual* emitted `CREATE TABLE` order in a real test, not asserted by inspection; same for every canonical-column-to-real-camelCase-field conversion, checked against a real generated dataset's actual field names for all six tables.

**A real, load-bearing discovery mid-design, not an incidental detail:** SQLAlchemy is Python, and eco-faker has no Python bindings -- it's an npm package only. A `seed.py` calling `generate()` directly was never actually possible. The SQLAlchemy target's generated script instead shells out to Node (`subprocess.run(["node", "scripts/eco-seed.mjs"])`, reusing the exact same seed-script generator `init next` already established) and reads the resulting JSON from Python. This shaped the Drizzle target's design too, by the same reasoning taken one step further: Drizzle's real runtime connection setup (which driver, which credentials) can't be inferred from schema field names alone any more than a Python interpreter can be, so that target is a clearly-marked template with the connection left as a `TODO`, not a script pretending to run unmodified. Only Prisma gets a fully drop-in `prisma/seed.ts` -- its connection setup is genuinely standardized enough (a `DATABASE_URL` env var, once `npx prisma generate` has run) to generate blind.

**The Prisma path got the most thorough verification of any feature so far, precisely because the obvious way to verify it -- a real database -- wasn't available.** `binaries.prisma.sh` (where Prisma's real query engine is downloaded from) is blocked by this environment's network restrictions, the same category of wall hit earlier for Docker and the Postgres apt mirror. Rather than skip verification, a real Prisma project was set up (real schema, real `npm install`), and when the engine download failed as expected, `@prisma/client` was replaced with a stub that records real `createMany` calls instead of hitting a database -- then the *actual generated `prisma/seed.ts`* (not a re-implementation of its logic) was run against it, against a real generated eco-faker dataset. The result: real fake names, a real address object (passed through as an actual JS object, matching a Prisma `Json` column, not stringified), correctly mapped field names, in the right order. `tests/orm-scaffold.test.ts` (10 tests) automates this exact same stub-and-record technique as a real, repeatable test, not just a one-off manual check.

**Verified end-to-end through the real CLI too:** `init prisma --schema ./schema.prisma` against a real six-model Prisma schema wrote the real seed script, the shared `eco-seed.mjs`, and `mapping.json` in one call; every error path (missing `--schema` on an ORM target, `--schema` given to a target that doesn't take one, an empty schema with no models, an overwrite without `--force`) was fired for real and produces the specific, correct message -- not a generic fallback. 15 new tests total across `tests/orm-scaffold.test.ts` and `tests/cli-init.test.ts`.

**What's still open:** Drizzle and SQLAlchemy remain templates, not drop-in scripts -- filling in a real connection for either requires knowing things about the target project (driver, credentials) this tool has no way to introspect, so that gap is inherent to the two ecosystems' own diversity of setup, not a shortcut taken here.

## Shipped: guaranteed-unique values, 73-locale support, and a `locales` command (2026-07-26)

Prompted by a direct comparison against faker-js and faker-ruby -- the two reference implementations eco-faker's own atomic-value layer depends on (faker-js directly) or takes inspiration from. Most of both libraries' surface area (70+ novelty/fandom modules -- DcComics, Kpop, ChuckNorris, Cosmere) is deliberately not chased: eco-faker is a deep, narrow relational/business-logic generator, not a broad atomic-value library, and it already gets faker-js's atomic layer for free as a dependency. Two things neither fact covers turned out to be real, demonstrable gaps.

**`createUniqueTracker()` (`src/unique.ts`)** -- the same guarantee faker-js's `faker.helpers.unique(...)` and faker-ruby's `Faker::X.unique.method` provide, built as a small, explicitly-scoped utility rather than assumed to come for free from depending on faker-js (that library's own `.unique` tracks a *global, implicit* registry on its shared instance -- not scoped to one field within one `generate()` call the way this project actually needs it). **A real, demonstrated bug, not a hypothetical one:** `faker.internet.email({ firstName, lastName })` had no uniqueness enforcement at all, and seeds 3, 4, and 8 at `scaleFactor: 5000` each produced 1-2 real duplicate emails, confirmed directly before any fix existed. Applied to `generateUsers`; zero duplicates confirmed at those same seeds afterward, and at 50,000 users. Also exported publicly from `index.ts` alongside `Rng` (also newly public) -- previously zero public surface existed for anyone extending eco-faker to reach the same deterministic primitives it uses internally.

**73 real locales (`src/locales.ts`, the `locales` command), up from 6 hand-typed ones.** The old `locale` config resolved through a hardcoded switch statement covering `en-US`/`en-GB`/`es-ES`/`de-DE`/`fr-FR`/`vi-VN` and nothing else, despite depending on a library that ships 70+. Replaced with dynamic resolution against faker-js's own `allLocales` export, filtered to exclude two genuine joke locales (`en_BORK`, the "Swedish Chef" parody; `en_AU_ocker`, an exaggerated-Australian-slang parody) and the internal `base` fallback layer. `config.schema.json`'s enum and `config-schema-object.ts`'s mirror of it are both cross-checked against this same computed list in `tests/locales.test.ts`, so the three can't drift out of sync the way the old hardcoded switch inevitably would have.

**Three real regressions, each caught by actually checking the full real set rather than a hand-picked sample -- the same discipline this project has applied to every other feature, applied here to a dependency's own data instead of eco-faker's own:**

1. **The dynamic resolution alone silently broke eco-faker's own four pre-existing config values.** `es-ES`/`de-DE`/`fr-FR`/`vi-VN` were always eco-faker's own display names for faker-js's bare `es`/`de`/`fr`/`vi` -- faker-js has no region-qualified key for any of the four. Confirmed by comparing `faker.person.firstName()` output directly: all four produced the exact same name as plain `en-US`, a silent fallback to English, not the German/Spanish/French/Vietnamese names those configs always produced before. Fixed with an explicit legacy-alias map; re-verified all four now match their real bare-locale equivalent exactly.
2. **Cross-segment email duplicates in the temporal engine.** `generateUsers`'s own uniqueness tracker is scoped to one `generate()` call, but `mergeDatasets` combines several independent segments' users into one final dataset -- and this project's own full test suite caught a real cross-segment duplicate email on an actual seed/profile combination, not a contrived one. `generateUsers`'s per-call guarantee has no visibility past its own segment by design (threading a shared tracker through every segment's otherwise-independent `generate()` call is exactly the core-loop coupling `temporal.ts`'s own docstring already says this module was built to avoid). Resolved at the actual merge boundary instead, with a deterministic `+2`/`+3`-style disambiguator -- a real, common email convention, not an invented one.
3. **Two address fields throw for real locales faker-js itself doesn't model the same way.** `location.state({ abbreviated: true })` throws for `cs-CZ`/`sk` (real state data, no abbreviated form) and `ro-MD` (no state/region concept at all); `location.zipCode()` throws for `en-HK` -- Hong Kong genuinely has no postal codes in real life, which is historically accurate locale data, not a faker-js gap. Neither was caught by a curated sample of "interesting" locales; only checking all 73 real ones surfaced them. Fixed with a resilient fallback chain (abbreviated -> plain -> empty string for state; zip code -> empty string), choosing an honest empty value over a fabricated one for the locales with no real data to draw from.

69 new/changed tests across `tests/unique.test.ts`, `tests/locales.test.ts`, and an expanded `tests/locale.test.ts` (now exercises all 73 real supported locales individually, not a hand-picked sample of 6-15 -- directly because a sample is exactly what would have missed the three real bugs above).

