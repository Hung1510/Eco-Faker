# A development image -- distinct from the repo-root Dockerfile, which is
# a slim, multi-stage *production* build (npm ci --omit=dev, no git, no
# psql client, ENTRYPOINT is the CLI itself). This one is the opposite: a
# full dev environment for editing/testing this project's own source, with
# devDependencies, git, and psql (for poking at the seeded Postgres
# directly) all present. Doesn't COPY any source -- the dev container
# mounts the live workspace instead (see docker-compose.yml in this
# directory), so edits on the host are picked up immediately.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
