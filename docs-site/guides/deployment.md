# Deployment

## Docker: seed a real Postgres database

```bash
docker compose up --build
psql -h localhost -U eco -d eco_faker -c "select status, count(*) from orders group by status;"
```

See [Database Tools](/cli/db-tools) for the full detail.

## Dev container

Open in VS Code (or any [Dev Containers](https://containers.dev)-compatible tool), "Reopen in Container" — Node 22, git, `psql`, and a real, pre-seeded Postgres. See [Development Setup](/contributing/) for what runs on first creation.

## Hosted playground API

`Dockerfile.serve`, `render.yaml`, `fly.toml` — deploy config for running [`serve`](/cli/serve) as a public demo instance. Not deployed anywhere by default.

```bash
fly launch --dockerfile Dockerfile.serve --copy-config --now
```

## Publishing eco-faker itself

See [Publishing to npm](/contributing/publishing).
