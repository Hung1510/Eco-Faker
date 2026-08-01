# Testing

eco-faker's testing tools split into two categories:

## Testing your generated data

Checks that a *dataset* — generated or fuzzed — is internally consistent (referential integrity, financial exactness, temporal ordering). See [Data Quality](/cli/data-quality) for `lint`, `fuzz`, `score`, and `diff`.

## Testing a live API against a contract

Fires real HTTP requests at a real, running API and validates the responses — this is the "contract testing" sense of the word, and what the rest of this section covers.

| Mode | What it checks |
|---|---|
| [Contract Testing](/testing/contract-testing) (`test --contract`) | Real GET requests, status codes + response shapes vs. an OpenAPI contract |
| [Mutation Testing](/testing/mutation-testing) (`test --mutate`) | Real POST/PATCH requests — idempotency, race conditions, invalid transitions, 401/404 |
| [Scenario Testing](/testing/scenario-testing) (`test --scenario`) | A strict, ordered, cross-resource sequence with real ids threaded between steps |
| [Gherkin/BDD Testing](/testing/gherkin-testing) (`test --gherkin`) | The same scenario engine, authored in real `.feature` syntax |

All four work against **any** live API matching an OpenAPI contract — not just one `eco-faker` generated. `openapi-export` (see [Exports](/cli/exports)) is the natural way to produce a contract from a generated dataset's shape, but you can point `test` at a hand-written contract and a real backend just as easily.

## Testing your own app against eco-faker

For frameworks and test runners that consume eco-faker as a data source — Vitest, Playwright, MSW, React Query, Apollo Client — see [Example Projects](/testing/examples): real, CI-verified projects demonstrating each combination end to end.
