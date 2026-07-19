import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generate } from "./generator.js";
import { mergeOverrides } from "./config.js";
import { SCENARIOS, resolveScenario, type ScenarioName } from "./scenarios.js";
import { applySemanticFuzzing, summarizeMutations, type FuzzMutationType } from "./fuzz.js";
import { applyFraudSimulation, summarizeFraudSignals, type FraudType } from "./fraud.js";
import { computeAnalytics } from "./analytics.js";
import { buildEventStream } from "./events.js";
import { lintDataset, lintSqlAgainstDatabase } from "./lint.js";
import { buildUserJourney, pickRichestUserId, renderJourneyHtml } from "./visualize.js";
import { TABLE_ROUTES, applyFiltersToRecords, applySortToRecords, paginateRecords, type DatasetArrayKey } from "./serve.js";
import type { Dataset, EcoFakerConfig, Locale } from "./types.js";

const LOCALES: [Locale, ...Locale[]] = ["en-US", "en-GB", "es-ES", "de-DE", "fr-FR", "vi-VN"];
const SCENARIO_NAMES = Object.keys(SCENARIOS) as [ScenarioName, ...ScenarioName[]];
const FUZZ_TYPES: [FuzzMutationType, ...FuzzMutationType[]] = [
  "address_mismatch",
  "price_inversion",
  "time_paradox",
  "inventory_oversell",
];
const FRAUD_TYPES: [FraudType, ...FraudType[]] = [
  "stolen_card",
  "account_farming",
  "reseller_behavior",
  "refund_abuse",
  "friendly_chargeback",
  "coupon_abuse_ring",
];

/**
 * In-memory dataset store, keyed by a UUID handed back to the calling
 * agent. Tools return small summaries (counts, a handful of sample rows,
 * a lint report) plus this id -- never the full dataset -- so a single
 * `generate_dataset` call doesn't flood an agent's context with
 * potentially thousands of records. Every other tool takes a `datasetId`
 * and looks the real data up here. Capped at MAX_STORED_DATASETS with
 * oldest-first eviction (Map preserves insertion order) since this is a
 * long-running process -- nothing here is meant to persist across server
 * restarts.
 */
const MAX_STORED_DATASETS = 20;
const datasets = new Map<string, Dataset>();

function storeDataset(dataset: Dataset): string {
  const id = randomUUID();
  datasets.set(id, dataset);
  if (datasets.size > MAX_STORED_DATASETS) {
    const oldest = datasets.keys().next().value;
    if (oldest !== undefined) datasets.delete(oldest);
  }
  return id;
}

function requireDataset(datasetId: string): Dataset {
  const dataset = datasets.get(datasetId);
  if (!dataset) {
    throw new Error(
      `No dataset with id "${datasetId}". Either it was never generated in this session, or it aged out (only the most recent ${MAX_STORED_DATASETS} datasets are kept in memory). Call generate_dataset first.`
    );
  }
  return dataset;
}

function datasetCounts(dataset: Dataset): Record<string, number> {
  return Object.fromEntries(
    (Object.entries(TABLE_ROUTES) as [string, DatasetArrayKey][]).map(([route, key]) => [route, dataset[key].length])
  );
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

function buildConfigOverrides(args: {
  scenario?: string;
  seed?: number;
  scaleFactor?: number;
  locale?: string;
}): Partial<EcoFakerConfig> {
  let overrides: Partial<EcoFakerConfig> = {};
  if (args.scenario) overrides = mergeOverrides(overrides, resolveScenario(args.scenario));
  const explicit: Partial<EcoFakerConfig> = {};
  if (args.seed !== undefined) explicit.seed = args.seed;
  if (args.scaleFactor !== undefined) explicit.scaleFactor = args.scaleFactor;
  if (args.locale !== undefined) explicit.locale = args.locale as Locale;
  return mergeOverrides(overrides, explicit);
}

/** Builds the MCP server and registers every eco-faker tool. Exported separately from `main()` so tests can drive it in-process without spawning a stdio subprocess. */
export function createEcoFakerMcpServer(): McpServer {
  const server = new McpServer({ name: "eco-faker", version: "0.2.0" });

  server.registerTool(
    "generate_dataset",
    {
      title: "Generate an e-commerce dataset",
      description:
        "Generate a stateful, relationally-consistent fake e-commerce dataset (users, carts, orders, shipments, returns -- financials balance, foreign keys resolve, timelines are chronologically valid). Returns a datasetId plus counts and a small sample of orders -- pass the datasetId into fuzz_dataset, lint_dataset, visualize_journey, or query_table instead of re-passing data.",
      inputSchema: {
        scenario: z
          .enum(SCENARIO_NAMES)
          .optional()
          .describe(`A named preset (${SCENARIO_NAMES.join(", ")}). Explicit fields below override it field-by-field.`),
        seed: z.number().int().optional().describe("Seed for deterministic, reproducible output. Omit for a fresh random dataset."),
        scaleFactor: z.number().int().min(1).max(5000).optional().describe("Roughly how many users to generate (default: 100)."),
        locale: z.enum(LOCALES).optional().describe("Locale for names/addresses/currency formatting."),
      },
    },
    async (args) => {
      try {
        const overrides = buildConfigOverrides(args);
        const dataset = generate(overrides);
        const datasetId = storeDataset(dataset);
        return textResult({
          datasetId,
          counts: datasetCounts(dataset),
          sampleOrders: dataset.orders.slice(0, 3),
        });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "query_table",
    {
      title: "Query a table within a generated dataset",
      description:
        "Fetch a page of records from one table of a previously generated dataset, with the same filter/sort/pagination semantics as `serve`'s REST API and the MSW adapter -- so you can inspect real records (e.g. 'delivered orders over $200') without pulling the whole dataset into context.",
      inputSchema: {
        datasetId: z.string().describe("A datasetId returned by generate_dataset or fuzz_dataset."),
        table: z.enum(Object.keys(TABLE_ROUTES) as [string, ...string[]]).describe("Which table to query."),
        filters: z
          .record(z.string())
          .optional()
          .describe("Exact-match filters, e.g. { status: 'delivered' }. Matches any top-level field on the record."),
        sort: z.string().optional().describe("Field name to sort by."),
        order: z.enum(["asc", "desc"]).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional().describe("Default 10, capped at 100 to keep results small."),
      },
    },
    async (args) => {
      try {
        const dataset = requireDataset(args.datasetId);
        const key = TABLE_ROUTES[args.table];
        const rows = dataset[key] as unknown as Record<string, unknown>[];
        const query: Record<string, string | undefined> = {
          ...(args.filters ?? {}),
          sort: args.sort,
          order: args.order,
          page: String(args.page ?? 1),
          pageSize: String(args.pageSize ?? 10),
        };
        const filtered = applySortToRecords(applyFiltersToRecords(rows, query), query);
        return textResult(paginateRecords(filtered, query));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "fuzz_dataset",
    {
      title: "Semantic fuzzing -- mutate a dataset with data that's schema-valid but logically impossible",
      description:
        "Apply semantic fuzzing to a previously generated dataset: mismatched shipping addresses, inverted line-item prices, return requests dated before their order, implausible per-order quantities. Every mutation is still schema-valid, so this finds business-logic bugs schema validation can't catch. Returns a *new* datasetId for the mutated copy -- the original is untouched.",
      inputSchema: {
        datasetId: z.string().describe("A datasetId returned by generate_dataset."),
        intensity: z.enum(["low", "medium", "extreme"]).optional().describe("How many mutations to attempt per type (default: medium)."),
        types: z.array(z.enum(FUZZ_TYPES)).optional().describe("Restrict to a subset of mutation types (default: all four)."),
        seed: z.number().int().optional().describe("Seed for reproducible mutation selection (default: 1)."),
      },
    },
    async (args) => {
      try {
        const dataset = requireDataset(args.datasetId);
        const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
          intensity: args.intensity,
          types: args.types,
          seed: args.seed,
        });
        const mutatedId = storeDataset(mutated);
        return textResult({
          datasetId: mutatedId,
          sourceDatasetId: args.datasetId,
          mutationCount: mutations.length,
          summary: summarizeMutations(mutations),
          mutations,
        });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "fraud_simulate",
    {
      title: "Fraud simulation -- tag orders with realistic fraud risk signals",
      description:
        "Flag a subset of orders in a previously generated dataset with realistic fraud signals (stolen_card, account_farming, reseller_behavior, refund_abuse, friendly_chargeback, coupon_abuse_ring) -- a riskScore and evidence signals per order, in the shape a real fraud-detection system's output would take. Some signals are structurally grounded: account_farming really does make several other users share the flagged order's address (a real, queryable pattern), and reseller_behavior really does bump a line item's quantity while keeping financials correct. Useful for fraud-detection demos, ML training data, or analytics dashboards. Returns a *new* datasetId for the tagged copy -- the original is untouched.",
      inputSchema: {
        datasetId: z.string().describe("A datasetId returned by generate_dataset or fuzz_dataset."),
        fraudRate: z.number().min(0).max(1).optional().describe("Fraction of orders to consider flagging (default: 0.02)."),
        types: z.array(z.enum(FRAUD_TYPES)).optional().describe("Restrict to a subset of fraud types (default: all six)."),
        seed: z.number().int().optional().describe("Seed for reproducible fraud-tag selection (default: 1)."),
      },
    },
    async (args) => {
      try {
        const dataset = requireDataset(args.datasetId);
        const { dataset: tagged, signals } = applyFraudSimulation(dataset, {
          fraudRate: args.fraudRate,
          types: args.types,
          seed: args.seed,
        });
        const taggedId = storeDataset(tagged);
        return textResult({
          datasetId: taggedId,
          sourceDatasetId: args.datasetId,
          flaggedCount: signals.length,
          summary: summarizeFraudSignals(signals),
          signals,
        });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "compute_analytics",
    {
      title: "Compute analytics -- daily revenue, conversion funnel, retention cohorts, customer LTV, CAC",
      description:
        "Computes daily revenue, a conversion funnel (viewed -> added_to_cart -> checkout_started -> purchased), monthly retention cohorts, per-customer LTV, and a CAC estimate from an already-generated dataset -- a pure, deterministic aggregation, no RNG involved. The 'viewed' funnel stage is only included if the dataset actually has recommendation data (productViews). CAC requires an assumed marketing spend figure since this dataset has nothing else to derive one from -- pass marketingSpend explicitly or accept the $5000 default.",
      inputSchema: {
        datasetId: z.string().describe("A datasetId returned by generate_dataset, fuzz_dataset, or fraud_simulate."),
        marketingSpend: z.number().optional().describe("Assumed total marketing spend for the CAC calculation (default: 5000)."),
      },
    },
    async (args) => {
      try {
        const dataset = requireDataset(args.datasetId);
        const report = computeAnalytics(dataset, { assumedMonthlyMarketingSpend: args.marketingSpend });
        return textResult(report);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "build_event_stream",
    {
      title: "Build a chronological event stream -- user.created, cart.item_added, order.created, shipment.delivered, etc.",
      description:
        "Builds a comprehensive, chronologically-ordered event stream from an already-generated dataset across all 18 tables, each event carrying aggregateId/aggregateType for real event-sourcing replay. Returns counts (total + per event type) and a small sample rather than the full stream, which can run into the thousands of events -- use eventTypes to filter down to what you actually need, or the `events` CLI command to write the complete stream to a file.",
      inputSchema: {
        datasetId: z.string().describe("A datasetId returned by generate_dataset, fuzz_dataset, or fraud_simulate."),
        eventTypes: z.array(z.string()).optional().describe("Only include these event types (e.g. ['order.created', 'shipment.delivered']). Default: all."),
        sampleSize: z.number().optional().describe("How many sample events to return (default: 10)."),
      },
    },
    async (args) => {
      try {
        const dataset = requireDataset(args.datasetId);
        let events = buildEventStream(dataset);
        if (args.eventTypes && args.eventTypes.length > 0) {
          const wanted = new Set(args.eventTypes);
          events = events.filter((e) => wanted.has(e.type));
        }
        const byType: Record<string, number> = {};
        for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
        return textResult({
          totalEvents: events.length,
          eventTypeCounts: byType,
          sample: events.slice(0, args.sampleSize ?? 10),
        });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "lint_dataset",
    {
      title: "Pre-flight data quality check",
      description:
        "Check a dataset for orphaned foreign keys, duplicate ids/emails, and financial/temporal inconsistencies -- entirely offline. Running this against a fuzz_dataset result is a quick way to confirm a specific mutation is actually detectable. Optionally also dry-runs a real .sql file against a live Postgres inside BEGIN/ROLLBACK if sql + databaseUrl are given (requires the optional 'pg' package on the server; never commits anything).",
      inputSchema: {
        datasetId: z.string().describe("A datasetId returned by generate_dataset or fuzz_dataset."),
        sql: z.string().optional().describe("Raw SQL to dry-run against a real database (advanced; requires databaseUrl)."),
        databaseUrl: z.string().optional().describe("Postgres connection string for the --sql dry run. Never used for anything but a rolled-back BEGIN/ROLLBACK."),
      },
    },
    async (args) => {
      try {
        const dataset = requireDataset(args.datasetId);
        const issues = lintDataset(dataset);
        const result: Record<string, unknown> = {
          issueCount: issues.length,
          errorCount: issues.filter((i) => i.severity === "error").length,
          warningCount: issues.filter((i) => i.severity === "warning").length,
          issues,
        };
        if (args.sql) {
          if (!args.databaseUrl) {
            return errorResult("`sql` was provided without `databaseUrl` -- both are required to dry-run against a real database.");
          }
          const sqlResult = await lintSqlAgainstDatabase(args.sql, args.databaseUrl);
          result.sqlDryRun = sqlResult;
        }
        return textResult(result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "visualize_journey",
    {
      title: "Render a customer's journey as an HTML timeline",
      description:
        "Build one user's full lifecycle (signup, carts, checkout recovery, orders, shipment tracking, returns) and render it as a self-contained, offline-capable animated HTML timeline. Writes the file to disk (it can be hundreds of KB, so it's not returned inline) and returns the path plus a text summary of the events.",
      inputSchema: {
        datasetId: z.string().describe("A datasetId returned by generate_dataset or fuzz_dataset."),
        userId: z.string().optional().describe("Which user to visualize (default: whichever user has the richest journey)."),
        outputPath: z.string().optional().describe("Where to write the HTML file (default: ./journey-<userId>.html in the current working directory)."),
      },
    },
    async (args) => {
      try {
        const dataset = requireDataset(args.datasetId);
        const userId = args.userId ?? pickRichestUserId(dataset);
        const user = dataset.users.find((u) => u.id === userId);
        if (!user) {
          return errorResult(`No user with id "${userId}" in dataset ${args.datasetId}.`);
        }
        const events = buildUserJourney(dataset, userId);
        const html = renderJourneyHtml(user, events);
        const outputPath = path.resolve(process.cwd(), args.outputPath ?? `./journey-${userId}.html`);
        writeFileSync(outputPath, html, "utf-8");
        return textResult({
          path: outputPath,
          user: { id: user.id, name: `${user.firstName} ${user.lastName}` },
          eventCount: events.length,
          events: events.map((e) => ({ type: e.type, label: e.label, timestamp: e.timestamp })),
        });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  const SCENARIO_DESCRIPTIONS: Record<ScenarioName, string> = {
  "black-friday": "High traffic, high abandonment from overwhelmed checkout flows, but shipments are still fast -- the delay hasn't caught up with the order spike yet.",
  "post-holiday-returns": "Weeks after a peak season: low new-cart activity, but a wave of returns and delayed shipments as carriers work through backlog.",
  "flash-sale": "Short, intense burst: very high abandonment (stock races out before checkout completes), tiny historical window, low return rate.",
  "supply-chain-crisis": "Logistics network under strain: most shipments run late, multi-package splits spike, and returns rise as delayed/damaged goods pile up.",
  "steady-state": "Ordinary day-to-day traffic -- effectively the default config, named for symmetry.",
};

server.registerTool(
    "list_scenarios",
    {
      title: "List available scenario presets",
      description: "List every named scenario preset (e.g. 'black-friday', 'steady-state') available to generate_dataset, with a short description of each.",
      inputSchema: {},
    },
    async () => {
      return textResult(SCENARIO_DESCRIPTIONS);
    }
  );

  return server;
}

/** Entry point for the `my-eco-gen mcp` CLI command -- connects the server over stdio, the standard transport for local MCP clients (Claude Desktop, Claude Code, etc). */
export async function main(): Promise<void> {
  const server = createEcoFakerMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
