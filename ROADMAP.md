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
