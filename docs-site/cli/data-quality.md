# Data Quality

Tools for checking (and deliberately breaking) a dataset's referential, financial, and temporal consistency.

## lint

```bash
my-eco-gen lint --users 300 --scenario black-friday
```

Checks orphaned FKs, duplicate ids/emails, financial mismatches (`lineTotal`, order `total`), and temporal ordering (returns before their order). Exits `1` on any error.

```bash
my-eco-gen lint --sql ./seed.sql --db-url postgres://user:pass@localhost:5432/staging   # real Postgres BEGIN/ROLLBACK dry run, requires `pg`
```

## fuzz

```bash
my-eco-gen fuzz --users 300 --scenario black-friday --intensity extreme --output ./eco-data.fuzzed.json
```

Four mutation types, each schema-valid but logically impossible: `address_mismatch`, `price_inversion` (no total recompute), `time_paradox` (return before order), `inventory_oversell`.

```bash
my-eco-gen fuzz --types price_inversion,time_paradox --intensity extreme --fuzz-seed 42
my-eco-gen fuzz --input ./eco-data.json --report ./mutations.json
```

Pair with `lint` to see the mutations get caught. For firing mutated payloads at a *live* API, see [Mutation Testing](/testing/mutation-testing).

## score

```bash
my-eco-gen generate --users 500 --output ./eco-data.json
my-eco-gen score --input ./eco-data.json
```

```
Realism score: 87/100

  referential_integrity     100/100  (0 orphaned FKs, 0 duplicate ids)
  financial_consistency      98/100  (3/1240 orders off by >$0.01)
  temporal_plausibility     100/100  (0 out-of-order timestamps)
  distribution_shape         71/100  (order-value distribution: real-world e-commerce
                                       order values roughly follow a log-normal/power-law
                                       shape -- long right tail, few large orders; this
                                       dataset's tail is thinner than expected)
  uniqueness                 92/100  (12/500 emails collide)

my-eco-gen score --input ./eco-data.json --format json   # machine-readable, for CI gating
```

A composite 0-100 realism score across five dimensions, so you can objectively compare two datasets (before/after a config change, or two competing seeds) instead of eyeballing them. `referential_integrity`/`financial_consistency`/`temporal_plausibility`/`uniqueness` reuse `lint`'s own checks directly — same rules, now expressed as a score contribution instead of a pass/fail. `distribution_shape` is new: checks whether `orders.total` and cart item-count roughly follow the right-skewed shape real order-value distributions have (a handful of large orders, many small ones) via a skewness statistic, rather than looking suspiciously uniform or normal.

Each dimension's score and *why* is printed, not just a bare number — a score that can't explain itself isn't more useful than eyeballing the data yourself. `--format json` for CI: fail a build if `score.overall < 80`, or track it over time as config changes.

Also available as an MCP tool (`score_dataset`) and a `computeRealismScore(dataset)` library export.

## diff

```bash
my-eco-gen diff ./before.json ./after.json
my-eco-gen diff ./bug-42.snapshot.json ./bug-43.snapshot.json --fail-on-schema-change   # for CI
```

Row-count deltas, schema drift, and status-distribution shifts between two datasets or snapshots.

## Related

- [Mutation Testing](/testing/mutation-testing) — fire fuzzed/mutated payloads at a *live* API
- [Data Lifecycle](/cli/data-lifecycle) — snapshots, `replay`, `warp`, versioning
