# Data Lifecycle

Snapshots, time-travel, and named dataset versions.

## Event sourcing mode (`events`)

```bash
my-eco-gen generate --users 300 --output ./eco-data.json
my-eco-gen events --input ./eco-data.json --output ./events.ndjson
```

Chronologically-ordered event stream across all 18 tables, every event carrying `aggregateId`/`aggregateType`. `--event-types`, `--format json`. Also an MCP tool (`build_event_stream`).

## Time-travel debug mode (snapshots)

```bash
my-eco-gen generate --users 100 --seed 42 --format json --output ./run1.json --snapshot ./bug-42.snapshot.json
my-eco-gen replay --input ./bug-42.snapshot.json --format json --output ./replay.json
```

A snapshot stores just the recipe (`seed`, config, `referenceNow`), not the dataset — `replay` reproduces it byte-identically.

## Time-travel regression (`warp`)

```bash
my-eco-gen warp --snapshot ./bug-42.snapshot.json --days +30 --diff
```

Reproduces a snapshot with every timestamp shifted by N days, everything else identical — for testing time-relative logic (overdue checks, SLA windows) against a fixed scenario at a different point in wall-clock time. `--diff` reuses the [`diff`](/cli/data-quality#diff) engine to compare original vs. warped.

## Data versioning (`version`)

```bash
my-eco-gen version save baseline --users 200 --seed 1 --message "before the promo"
my-eco-gen version branch baseline promo-test --users 200 --seed 1 --abandonment-rate 0.2 --message "lower abandonment during promo"
my-eco-gen version diff baseline promo-test
my-eco-gen version log promo-test
my-eco-gen version list
```

A local, named store of dataset *recipes* (`.eco-faker/versions/<name>.json` — same `config` + `referenceNow` shape as `generate --snapshot`, not the generated data itself), so you can save a run under a memorable name instead of a file path, branch a new named version from an existing one (explicit flags override the parent's values, same precedence as everywhere else), diff any two by name, and trace a version's full lineage back to its root. `--dir` points any of these at a different store location; default is `.eco-faker/versions` in the current directory.

## Related

- [Data Quality](/cli/data-quality) — `diff`, `lint`, `fuzz`, `score`
- [Configuration](/api/configuration) — the full config shape a snapshot/version recipe captures
