# MCP server

```bash
my-eco-gen mcp
```

Runs eco-faker as an [MCP](https://modelcontextprotocol.io) server over stdio, exposing these tools:

| Tool | What it does |
|---|---|
| `generate_dataset` | Generate a dataset — returns a `datasetId`, counts, a 3-row sample |
| `generate_temporal_dataset` | Generate a dataset whose config varies over calendar time |
| `generate_otel_traces` | OTLP/JSON traces for a dataset — counts + sample |
| `generate_ai_dataset` | Text2SQL/RAG/agent-scenarios/eval-set for a dataset |
| `score_dataset` | Composite realism score for a dataset |
| `query_table` | Filter/sort/paginate one table |
| `fuzz_dataset` | Semantic fuzzing — returns a new `datasetId` |
| `fraud_simulate` | Fraud risk tagging — returns a new `datasetId` |
| `compute_analytics` | Revenue/funnel/cohorts/LTV/CAC |
| `build_event_stream` | Chronological event stream |
| `resolve_scenario_file` | Resolves a scenario file's inherits chain |
| `lint_dataset` | Offline data-quality check |
| `visualize_journey` | Writes a customer-journey HTML timeline |
| `list_scenarios` | Lists scenario presets |

Datasets are kept server-side (in-memory, 20 most recent) and referenced by `datasetId` across calls.

```json
{
  "mcpServers": {
    "eco-faker": { "command": "npx", "args": ["-y", "eco-faker", "mcp"] }
  }
}
```
