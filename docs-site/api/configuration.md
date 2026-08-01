# Configuration

See [`config.schema.json`](https://github.com/Hung1510/Eco-Faker/blob/main/config.schema.json) for the complete, authoritative field list. Highlights:

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

## Every CLI flag maps to a config field

`my-eco-gen generate --help` shows the full flag list; each one corresponds 1:1 to a field here. See [`generate`](/cli/generate) for the CLI reference, or pass the same shape directly to `generate()` as a library:

```ts
import { generate } from "eco-faker";

const dataset = generate({
  seed: 42,
  scaleFactor: 200,
  returnRate: 0.12,
  anomalies: { botCartRate: 0.05 },
});
```

## Related

- [Scenarios](/api/scenarios) — named presets that set multiple config fields at once
- [Data Lifecycle](/cli/data-lifecycle) — snapshots/versions capture this exact config shape for reproducibility
