# Scenarios

## Presets

```bash
my-eco-gen scenarios   # list all presets
```

| Scenario | Story |
|---|---|
| `black-friday` | Traffic spike, overwhelmed checkout |
| `post-holiday-returns` | Weeks after peak season, carrier backlog |
| `flash-sale` | Short, intense burst, stock races out |
| `supply-chain-crisis` | Logistics network under strain |
| `steady-state` | Ordinary day-to-day traffic |

## Library API

```ts
import { generate, SCENARIOS, resolveScenario, mergeOverrides } from "eco-faker";

const dataset = generate(mergeOverrides(resolveScenario("black-friday"), { scaleFactor: 500 }));
```

`resolveScenario(name)` returns the named preset's config overrides; `mergeOverrides(base, overrides)` layers explicit values on top, matching the same precedence the CLI uses (explicit flags win over the scenario).

## Scenario composer (`--scenario-file`)

```yaml
# my-holiday-crunch.yaml
name: my-holiday-crunch
inherits:
  - black-friday
  - ./base-tuning.yaml
overrides:
  scaleFactor: 250
  seed: 42
```

```bash
my-eco-gen generate --scenario-file ./my-holiday-crunch.yaml --output ./eco-data.json
my-eco-gen scenario resolve ./my-holiday-crunch.yaml   # debug/author without generating
```

**Precedence, most-specific-wins:** own `overrides` > later `inherits` entries > earlier ones > explicit CLI flags win over all of it. Circular inheritance is detected and reported with the full chain. Also an MCP tool (`resolve_scenario_file`).

## Temporal scenarios

See [Temporal scenario engine](/cli/generate#temporal-scenario-engine-temporal) in the `generate` reference — one dataset whose config varies over calendar time.

## Related

- [`generate`](/cli/generate) — the CLI surface for all of the above
- [Configuration](/api/configuration) — the config shape scenarios override
