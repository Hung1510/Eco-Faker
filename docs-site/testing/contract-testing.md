# Contract Testing (`test --contract`)

```bash
my-eco-gen openapi-export --users 200 --output ./contract.json
my-eco-gen test --url https://api.example.com --contract ./contract.json
```

Fires real GET requests at a live API and asserts status codes + response schemas against an OpenAPI 3.0 contract. Read-path only — byId ids are harvested from real list responses. `--header "Authorization: Bearer ..."` (repeatable).

::: tip
`--url` should be the API's *origin*, not include a path prefix your contract's paths already contain — doubling a prefix like `/api` produces 404s across every route. See the [full worked example](/testing/examples) for a concrete before/after.
:::

A status code is only a *failure* if it isn't one of the contract's own declared possible responses for that route — a documented `401` (for an auth-protected route) is a legitimate pass, not a violation. Watch for downstream effects instead: if a list request comes back empty or erroring, the corresponding `/{id}` detail check has no real id to substitute and fails with "no sample id available," even though the list request itself technically passed.

## Related

- [Exports → k6 load-test export](/cli/exports#k6-load-test-export-k6-export) — load-test the same contract-matching API
- [Mutation Testing](/testing/mutation-testing) — the write-path counterpart
- [Example Projects](/testing/examples) — a full passing + two failing scenarios (missing auth, contract drift), run end to end
