# eco-faker roadmap: growth-focused features

Scoped 2026-07-18. Ordered by effort-to-reach ratio, not necessarily build order.
Each entry: what it is, why it should move adoption, and a concrete first slice.

---

## 1. MSW (Mock Service Worker) adapter -- lowest effort, widest reach

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

**First slice:**
```ts
// src/msw.ts
import { http, HttpResponse } from "msw";
import type { Dataset } from "./types.js";
import { TABLE_ROUTES } from "./serve.js"; // reuse the same route table

export function toMswHandlers(dataset: Dataset, opts?: { basePath?: string }) {
  const base = opts?.basePath ?? "/api";
  return Object.entries(TABLE_ROUTES).flatMap(([route, key]) => [
    http.get(`${base}/${route}`, () => HttpResponse.json(/* paginate+filter, reuse serve.ts helpers */)),
    http.get(`${base}/${route}/:id`, ({ params }) => /* lookup by id */),
  ]);
}
```
Reuse `applyFilters`/`applySort`/`paginate` from `serve.ts` (export them) so
behavior stays identical between `serve` and the MSW handlers -- one
implementation, two adapters.

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

1. **Response meaning / request logging** -- shipped 2026-07-18 (see below).
2. **MSW adapter** -- fastest to ship, immediately reaches an existing large
   audience, unblocks `init msw` in #3.
3. **Content push** -- write the comparison post once the MSW adapter gives
   it a fresh "what's new" hook.
4. **Framework scaffolding CLI** -- `init next` + `init msw`.
5. **Contract testing** -- the multi-week investment, scoped as its own
   milestone whenever there's a dedicated block of time for it.

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
