# Database Tools

## Docker: seed a real Postgres database

```bash
docker compose up --build
psql -h localhost -U eco -d eco_faker -c "select status, count(*) from orders group by status;"
```

Brings up `postgres` (real Postgres 16) and `seed` (builds the CLI, generates a `black-friday` dataset, loads it via `psql`, exits). Edit `docker-compose.yml`'s `seed.command` to change scenario/users/format.

## DB snapshot + anonymization (`db-snapshot`)

```bash
npm install pg   # optional dependency, same as lint --sql --db-url
my-eco-gen db-snapshot --db-url "postgresql://user:pass@host:5432/proddb" --output ./snapshot/
my-eco-gen db-snapshot --db-url "..." --tables users,orders --exclude-anonymize "products.name" --output ./snapshot/
```

Connects to a real live Postgres database, read-only (`SELECT` only, no writes), and writes real rows to JSON, one file per table, with PII-shaped columns (email, phone, SSN, first/last/full name, address, date of birth, credit card, generic secrets like passwords/API keys) deterministically pseudonymized by column-*name* heuristic. The same real value always maps to the same fake replacement (the fake is derived from a SHA-256 hash of the real value, never stored reversibly), so repeated real values — the same customer's email showing up in multiple tables — stay consistent with each other in the output.

**Stated plainly, because it's a real, demonstrated limitation:** this is a column-*name* heuristic, not content inspection. A column literally named `name` holding a product name — not a person's — genuinely gets anonymized into a fake person's name by default (confirmed against a real database during this feature's own development). `--exclude-anonymize table.column` is the escape hatch for exactly that; `--anonymize table.column` is the reverse, forcing anonymization on a real PII column the heuristic misses. Review both before trusting the auto-detection on your own schema.

`--row-limit` (default 1000 per table) reads whichever rows Postgres happens to return first with no `ORDER BY` — not a representative sample, and not guaranteed to keep cross-table foreign keys intact if a referenced row falls outside another table's own limit. Fine for a small database; raise the limit (or drop it per-table) for a large one.

A real, confirmed check guards against the worst version of the name-heuristic problem: an auto-detected column is only anonymized if its real values actually fit — no column is ever treated as PII if its real values are booleans (confirmed directly: `recoveryEmailSent`, a boolean, matched the `email` name pattern and would otherwise have been corrupted into a fake email string), and an "email" classification specifically requires the real values contain "@".

## File-based anonymization (`anonymize`)

```bash
my-eco-gen anonymize --input customers.csv --output ./anonymized/
my-eco-gen anonymize --input dataset.json --output ./anonymized/ --exclude-anonymize "products.name"
my-eco-gen anonymize --input export.csv --table users --format csv --output ./anonymized/
```

The exact same deterministic pseudonymization `db-snapshot` uses (they share one implementation, `src/anonymize.ts`), applied to a local `.json` or `.csv` file instead of a live Postgres connection — for anyone with an export already but no live DB access. Accepts a flat array or `.csv` (treated as one table, named from `--table` or the input filename) or a JSON object of `table-name -> rows`. `--format json|csv` controls the output (default json), one file per table either way.

CSV parsing is a real, dependency-free RFC 4180 parser (quoted fields, `""` escaped quotes, commas/newlines inside quotes). Its one confirmed scope limit: a bare quote appearing mid-*unquoted*-field (not valid RFC 4180 to begin with) is silently lossy, not an error — real CSV writers never produce that shape.

## Related

- [Deployment](/guides/deployment) — dev container, hosted playground
