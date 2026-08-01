# Scenario Testing (`test --scenario`)

The cross-resource half `--mutate` doesn't cover: a strict, ordered sequence of real requests across multiple resources, with real ids captured from each response threaded into the next step — and the actual business-logic outcome checked at every stage, not just the last request's HTTP code.

```bash
my-eco-gen generate --users 300 --output ./eco-data.json
my-eco-gen test --url https://api.example.com --contract ./your-openapi.json \
  --scenario ./examples/scenarios/full-lifecycle.yaml --seed ./eco-data.json
# ok:   createCart (POST /carts) -> 201
# ok:   checkout (POST /carts/26d26082.../checkout) -> 201
# ok:   ship (POST /orders/f64639df.../ship) -> 200
# ok:   illegalCancel (POST /orders/f64639df.../cancel) -> 409
# ok:   requestReturn (POST /orders/f64639df.../return) -> 200
#
# 5 passed, 0 failed (--scenario).
```

A scenario file (YAML or JSON, see [`examples/scenarios/full-lifecycle.yaml`](https://github.com/Hung1510/Eco-Faker/blob/main/examples/scenarios/full-lifecycle.yaml)) is a `name` plus an ordered `steps` list. Each step:

- `method`/`path` — `path` can reference <code v-pre>{{stepName.field}}</code> (a value an earlier step captured) or <code v-pre>{{seed.field}}</code> (a real value from the dataset passed via `--seed`, e.g. <code v-pre>{{seed.users.0.id}}</code> for a real user id).
- `body` — same placeholder substitution, at any depth.
- `expectStatus` — accepted status code(s). A step that's *supposed* to be rejected (cancelling a shipped order, say) declares its real expected rejection code here — that's a pass, not a failure.
- `expectBody` — shallow dot-path field checks against the real response body. This is the actual business-logic assertion: a step can return the "right" status with the wrong resulting state, and `expectStatus` alone would miss that.
- `capture` — `{ localName: "dot.path.into.response" }`, available to later steps as <code v-pre>{{stepName.localName}}</code>.

The scenario stops at the first failed step — a later step referencing a value the failed step should have produced has nothing real to inject, so continuing wouldn't test anything meaningful. An unresolved placeholder (a typo'd step name, a reference to a step that never ran) is reported as its own specific failure, not silently left as a literal <code v-pre>{{...}}</code> in the request or swallowed into a confusing downstream 404.

::: tip Scope
Deliberately doesn't also validate each step's response against the OpenAPI contract's declared schema the way `test --contract`'s read-path checks do — `expectStatus`/`expectBody` already cover the actual point of this feature (the business-logic outcome at each stage). A stated future enhancement, not attempted this round.
:::

## Related

- [Gherkin/BDD Testing](/testing/gherkin-testing) — the same engine, authored in `.feature` syntax
- [Contract Testing](/testing/contract-testing) — the read-path, single-request counterpart
