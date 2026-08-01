# Mutation Testing (`test --mutate`)

```bash
my-eco-gen generate --users 300 --output ./eco-data.json
my-eco-gen test --url https://api.example.com --contract ./your-openapi.json --mutate --seed ./eco-data.json
```

Five checks: `not_found`, `unauthorized`, `duplicate_submission`, `race_condition`, `invalid_transition`. The last is fully automatic — any schema with an ordered status `enum` gets a real backward-transition attempt, no config needed. `duplicate_submission`/`race_condition` need `--seed <dataset.json>` to build real POST bodies; `--concurrency`, `--idempotency-header` tune the race check.

::: warning
This fires real POST/PATCH requests against `--url`. Point it at a disposable/staging environment, not production.
:::

Every check here is a single mutating request against a single resource — for a real cross-resource, multi-step workflow, see [Scenario Testing](/testing/scenario-testing).

## Related

- [Data Quality → fuzz](/cli/data-quality#fuzz) — the offline counterpart: schema-valid but logically impossible mutations to a dataset, without a live API
- [Contract Testing](/testing/contract-testing) — the read-path counterpart
