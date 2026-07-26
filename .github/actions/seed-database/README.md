# eco-faker: seed a database

A reusable GitHub Action that generates a fresh [eco-faker](https://www.npmjs.com/package/eco-faker) dataset, optionally lints it, and seeds a real Postgres database with it -- the "test with fresh data on every PR" workflow, packaged instead of hand-copied into every consuming repo's own workflow file.

## Usage

```yaml
jobs:
  seed-and-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: eco
          POSTGRES_PASSWORD: eco
          POSTGRES_DB: eco_faker
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20.x

      - name: Install postgresql-client (for psql)
        run: sudo apt-get update && sudo apt-get install -y postgresql-client

      - uses: Hung1510/Eco-Faker/.github/actions/seed-database@main
        with:
          database-url: postgres://eco:eco@localhost:5432/eco_faker
          scenario: black-friday
          users: "300"

      # ...your own test steps against the now-seeded database...
```

## Inputs

| Input | Required | Default | Meaning |
|---|---|---|---|
| `database-url` | yes | -- | Postgres connection string to seed |
| `scenario` | no | (none) | Named scenario preset (`black-friday`, `post-holiday-returns`, `flash-sale`, `supply-chain-crisis`, `steady-state`). Ignored if `config-file` is set |
| `users` | no | `200` | Number of core users to generate. Ignored if `config-file` is set |
| `seed` | no | `1` | Seed for reproducible generation. Ignored if `config-file` is set |
| `config-file` | no | (none) | Path to a scenario file (`--scenario-file`, YAML or JSON) for full config control -- overrides `scenario`/`users`/`seed` |
| `lint` | no | `true` | Run `my-eco-gen lint` against the generated dataset before seeding, failing the job if it finds any real issue |
| `eco-faker-version` | no | `latest` | npm version/tag of `eco-faker` to install |

## Outputs

| Output | Meaning |
|---|---|
| `seed-file` | Path to the generated `.sql` file that was loaded |
| `row-counts` | JSON object of table name -> row count for the generated dataset |

## What this does and doesn't do

Requires `psql` on the runner (`postgresql-client` -- not preinstalled on `ubuntu-latest`, install it as a step before this action, as in the example above) and a reachable Postgres instance (a `services:` block, as above, or any Postgres URL the runner can reach). MySQL/other databases aren't a target here -- eco-faker's own SQL output is Postgres-flavored (`REFERENCES`, `TEXT PRIMARY KEY`), so this action seeds Postgres specifically rather than claiming broader compatibility it doesn't have.

Lint runs against the dataset before it's seeded (`lint: true`, the default) -- on a real `generate()` call this should never find anything (a clean `generate()` output is exactly what eco-faker's own test suite asserts), so a lint failure here means something is actually wrong, not a flaky check to route around.

**Not run against real GitHub Actions infrastructure.** The exact shell commands this action runs (`generate --format json`, `generate --format sql`, `lint --input`) were verified locally against the real, compiled CLI -- all three work exactly as scripted. The action's YAML itself (composite action schema, `$GITHUB_OUTPUT` file-append convention, `${{ inputs.x }}` interpolation) was validated for syntax but not exercised inside an actual workflow run on a real runner. If something in the YAML plumbing doesn't behave as expected, that's the part to look at first.
