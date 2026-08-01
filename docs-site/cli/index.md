# CLI Reference

`my-eco-gen` is the CLI entry point (`node dist/cli.js` if running from source). Every subcommand supports `--help` for its full flag list.

```bash
my-eco-gen --help
my-eco-gen generate --help
```

## Configurable behavioral parameters

See [`config.schema.json`](https://github.com/Hung1510/Eco-Faker/blob/main/config.schema.json) for the full list. Highlights:

| Field | Meaning | Default |
|---|---|---|
| `abandonmentRate` | chance a cart is abandoned instead of converted | `0.35` |
| `returnRate` | chance a delivered order gets a return request | `0.08` |
| `delayProbability` | chance a shipment hits `Delayed` | `0.15` |
| `maxDelayDays` | max extra days added when delayed | `3` |
| `historicalDays` | span of history to generate | `90` |
| `scaleFactor` | number of core users | `100` |
| `multiPackageRate` | chance an order ships as 2-3 separate packages | `0.1` |
| `missingAddressRate` | chance an order has no shipping address | `0.05` |
| `anomalies.botCartRate` | chance of a bot-activity cart anomaly | `0.02` |
| `anomalies.remoteShippingRate` | chance of a remote-region shipping surcharge | `0.05` |
| `anomalies.contradictoryReturnRate` | chance of a negative-reason return with a perfect CSAT score | `0.01` |

Validated against `config.schema.json` via [ajv](https://ajv.js.org/) — invalid values throw with every violation listed.

## Command groups

| Group | Commands |
|---|---|
| [`generate`](/cli/generate) | dataset generation, product catalog, recommendation data, inventory simulation, support tickets, transactional emails, scenarios, locales, multi-store, anomalies, fraud |
| [`serve`](/cli/serve) | mock REST API, chaos mode, auth, live feeds, OpenAPI-examples mode |
| [Data Quality](/cli/data-quality) | `lint`, `fuzz`, `score`, `diff` |
| [Data Lifecycle](/cli/data-lifecycle) | `version`, `replay`, `warp`, `events` |
| [Exports](/cli/exports) | `dashboard`, `benchmark-export`, `ge-export`, `k6-export`, `otel-export`, `ai-export` |
| [`mail` & `webhook`](/cli/mail-and-webhook) | local email inbox, webhook event simulator |
| [Database Tools](/cli/db-tools) | `db-snapshot`, `anonymize`, Docker Postgres seeding |
| [Scaffolding](/cli/scaffolding) | `init next` / `init msw` / `init prisma` / `init drizzle` / `init sqlalchemy`, schema introspection |
| [`docs` & `completion`](/cli/docs-and-completion) | terminal docs lookup, shell completion, `locales` |
| [MCP server](/cli/mcp) | `mcp` — expose eco-faker as tools any MCP client can call |

Contract/mutation/scenario/Gherkin testing (`test --contract` / `--mutate` / `--scenario` / `--gherkin`) has its own dedicated section: [Testing](/testing/).
