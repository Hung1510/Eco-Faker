# ---- build stage: compile TypeScript ----
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY config.schema.json ./
RUN npm run build

# ---- runtime stage ----
FROM node:20-slim
# postgresql-client gives the seed container a `psql` binary so
# docker-compose can generate SQL and load it into Postgres in one step.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY config.schema.json ./

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--help"]
