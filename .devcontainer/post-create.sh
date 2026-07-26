#!/usr/bin/env bash
# Runs once when the dev container is first created (devcontainer.json's
# postCreateCommand) -- not on every subsequent start, and not on every
# rebuild of just the `app` service either, since it checks for existing
# data before touching Postgres at all.
set -e

npm install
npm run build

ALREADY_SEEDED=$(psql -h postgres -U eco -d eco_faker -tAc \
  "SELECT to_regclass('public.orders') IS NOT NULL AND (SELECT count(*) FROM orders) > 0" 2>/dev/null || echo "f")

if [ "$ALREADY_SEEDED" = "t" ]; then
  echo "eco_faker already has data -- skipping seed. (docker compose down -v in .devcontainer/ for a clean slate.)"
else
  node dist/cli.js generate --users 300 --scenario black-friday --format sql --output /tmp/devcontainer-seed.sql
  psql -h postgres -U eco -d eco_faker -f /tmp/devcontainer-seed.sql
  echo "Seeded eco_faker @ postgres:5432 (user: eco / password: eco, db: eco_faker)."
fi

echo ""
echo "Ready. Try:"
echo "  npx tsx src/cli.ts generate --users 50 --format sql --output /tmp/seed.sql"
echo "  npm test"
