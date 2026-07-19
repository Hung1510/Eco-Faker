#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generate, generateRecords } from "./generator.js";
import { generateStores } from "./multi-store.js";
import { createMockApiServer } from "./serve.js";
import { buildPostmanCollection } from "./postman.js";
import { attachLiveFeed } from "./live.js";
import { buildWebhookEvents, replayEvents } from "./webhook.js";
import { diffDatasets, formatDiffReport, loadDatasetLike } from "./diff.js";
import { serialize, type OutputFormat } from "./output/index.js";
import { parsePrismaSchema } from "./introspect/prisma.js";
import { parseDrizzleSchema } from "./introspect/drizzle.js";
import { parseSqlAlchemySchema } from "./introspect/sqlalchemy.js";
import { parseOpenApiSchema, fetchAndParseOpenApiSchema } from "./introspect/openapi.js";
import { buildSchemaMapping, type SchemaMapping } from "./introspect/mapper.js";
import { mergeOverrides } from "./config.js";
import { SCENARIOS, resolveScenario } from "./scenarios.js";
import { applySemanticFuzzing, summarizeMutations, type FuzzMutationType } from "./fuzz.js";
import { lintDataset, lintSqlAgainstDatabase } from "./lint.js";
import { buildUserJourney, pickRichestUserId, renderJourneyHtml } from "./visualize.js";
import { applyFraudSimulation, summarizeFraudSignals, type FraudType } from "./fraud.js";
import { computeAnalytics } from "./analytics.js";
import { analyticsToCsvFiles, analyticsToSql } from "./output/dashboard.js";
import { generateElasticsearchMappings, generateElasticsearchBulkNdjson } from "./output/benchmark/elasticsearch.js";
import { generateClickHouseDdl } from "./output/benchmark/clickhouse.js";
import { buildEventStream } from "./events.js";
import { main as runMcpServer } from "./mcp.js";
import type { EcoFakerConfig, Locale } from "./types.js";

const TOOL_VERSION = "0.1.0";

interface Snapshot {
  meta: { tool: "my-eco-gen"; toolVersion: string; createdAt: string; description?: string };
  referenceNow: number;
  config: Partial<EcoFakerConfig>;
}

const program = new Command();

program
  .name("my-eco-gen")
  .description("Generate a stateful, relationally-consistent fake e-commerce dataset.")
  .version(TOOL_VERSION);

/** Options shared by every command that ultimately calls generate()/generateRecords(). */
function addCoreGenerateOptions(cmd: Command): Command {
  return cmd
    .option("-u, --users <number>", "number of core users to generate (scaleFactor)", parseIntArg)
    .option("-s, --seed <number>", "deterministic PRNG seed", parseIntArg)
    .option("-l, --locale <locale>", "locale (en-US, en-GB, es-ES, de-DE, fr-FR, vi-VN)")
    .option("--historical-days <number>", "span of history to generate, in days", parseIntArg)
    .option("--abandonment-rate <number>", "0..1 chance a cart is abandoned", parseFloatArg)
    .option("--return-rate <number>", "0..1 chance a delivered order gets a return", parseFloatArg)
    .option("--delay-probability <number>", "0..1 chance a shipment is delayed", parseFloatArg)
    .option("--max-delay-days <number>", "max extra days added when delayed", parseIntArg)
    .option("--no-anomalies", "disable anomaly injection entirely")
    .option("--no-recommendation-data", "disable product views/search queries/wishlist/ratings generation")
    .option("--no-inventory-simulation", "disable warehouses/replenishment orders/stockouts/transfers generation")
    .option("--bot-cart-rate <number>", "0..1 chance of a bot-activity cart anomaly", parseFloatArg)
    .option("--remote-shipping-rate <number>", "0..1 chance of a remote-region shipping surcharge anomaly", parseFloatArg)
    .option(
      "--contradictory-return-rate <number>",
      "0..1 chance of a negative-reason return with a contradictory CSAT score",
      parseFloatArg
    )
    .option("--catalog-size <number>", "how many products to generate in the shared catalog (default: 150)", parseIntArg)
    .option(
      "--scenario <name>",
      `apply a named business-scenario preset (${Object.keys(SCENARIOS).join(" | ")}) before other flags`
    );
}

/** Resolve scenario + explicit CLI flags into a single overrides object, exiting on an unknown scenario name. */
function resolveOverrides(opts: Record<string, unknown>): Partial<EcoFakerConfig> {
  const explicitOverrides = buildOverridesFromGenerateOpts(opts);
  let scenarioOverrides: Partial<EcoFakerConfig> | undefined;
  if (opts.scenario) {
    try {
      scenarioOverrides = resolveScenario(opts.scenario as string);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }
  return mergeOverrides(scenarioOverrides, explicitOverrides);
}

/**
 * Shared by `fuzz`, `lint`, and `visualize`: load a dataset from
 * `--input <path>` (any `generate --format json` output) if given,
 * otherwise generate a fresh one from the usual `addCoreGenerateOptions`
 * flags -- same "either load or generate" pattern `diff` and `webhook`
 * already use individually.
 */
function loadOrGenerateDataset(opts: Record<string, unknown>) {
  if (opts.input) {
    return loadDatasetLike(path.resolve(process.cwd(), opts.input as string));
  }
  const overrides = resolveOverrides(opts);
  return generate(overrides, Date.now());
}

addCoreGenerateOptions(
  program
    .command("generate")
    .description("Generate users, carts, abandoned checkouts, orders, shipments, and returns.")
)
  .option("-f, --format <format>", "output format: json | sql | csv", "json")
  .option("-o, --output <path>", "output file path", "./eco-data.json")
  .option("--stores <number>", "generate N independent stores (JSON output only)", parseIntArg)
  .option("--stream", "stream NDJSON records to stdout as they're produced, instead of writing a file")
  .option("--snapshot <path>", "also save the exact seed/config/referenceNow recipe to a .snapshot.json for later replay")
  .option("--mapping <path>", "apply a mapping.json (from `my-eco-gen init`) to target an existing DB schema's column names")
  .option("--fraud-rate <number>", "0..1 chance an order is considered for a fraud tag (default: 0, disabled). See README's Fraud simulation section for the six fraud types.", parseFloatArg)
  .option("--fraud-types <list>", "comma-separated subset of: stolen_card,account_farming,reseller_behavior,refund_abuse,friendly_chargeback,coupon_abuse_ring (default: all six)")
  .option("--fraud-seed <number>", "seed for reproducible fraud-tag selection (default: 1)", parseIntArg, 1)
  .action(async (opts) => {
    const overrides = resolveOverrides(opts);
    const referenceNow = Date.now();

    if (opts.snapshot) {
      const snapshot: Snapshot = {
        meta: {
          tool: "my-eco-gen",
          toolVersion: TOOL_VERSION,
          createdAt: new Date(referenceNow).toISOString(),
          description: opts.scenario ? `scenario: ${opts.scenario}` : undefined,
        },
        referenceNow,
        config: overrides,
      };
      const snapshotPath = path.resolve(process.cwd(), opts.snapshot);
      mkdirSync(path.dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
      console.error(`Snapshot recipe saved to ${snapshotPath} (seed=${overrides.seed ?? "default"})`);
    }

    if (opts.stream) {
      await streamToStdout(overrides, referenceNow);
      return;
    }

    const format = opts.format as OutputFormat;
    if (!["json", "sql", "csv"].includes(format)) {
      console.error(`Unsupported format "${opts.format}". Use json, sql, or csv.`);
      process.exit(1);
    }

    if (opts.stores !== undefined) {
      if (format !== "json") {
        console.error("--stores is only supported with --format json for now.");
        process.exit(1);
      }
      const stores = generateStores(overrides, referenceNow, opts.stores as number);
      const outputPath = path.resolve(process.cwd(), opts.output);
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(stores, null, 2), "utf-8");
      console.log(`Generated ${stores.length} store(s):`);
      for (const store of stores) {
        console.log(`  ${store.storeId}: ${store.dataset.users.length} users, ${store.dataset.orders.length} orders`);
      }
      console.log(`Written to ${outputPath} (json)`);
      return;
    }

    const start = performance.now();
    let dataset = generate(overrides, referenceNow);
    let fraudSummary: Record<FraudType, number> | undefined;
    if (opts.fraudRate) {
      const fraudTypes = opts.fraudTypes
        ? ((opts.fraudTypes as string).split(",").map((s) => s.trim()) as FraudType[])
        : undefined;
      const fraudResult = applyFraudSimulation(dataset, {
        fraudRate: opts.fraudRate as number,
        types: fraudTypes,
        seed: opts.fraudSeed as number,
      });
      dataset = fraudResult.dataset;
      fraudSummary = summarizeFraudSignals(fraudResult.signals);
    }
    const mapping: SchemaMapping | undefined = opts.mapping
      ? (JSON.parse(readFileSync(path.resolve(process.cwd(), opts.mapping), "utf-8")) as SchemaMapping)
      : undefined;
    const serialized = serialize(dataset, format, mapping);
    const elapsed = (performance.now() - start).toFixed(1);

    const outputPath = path.resolve(process.cwd(), opts.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf-8");

    const anomalyCounts = {
      botCarts: dataset.carts.filter((c) => c.anomaly?.type === "bot_activity").length,
      remoteShippingOrders: dataset.orders.filter((o) => o.anomaly?.type === "remote_surcharge").length,
      contradictoryReturns: dataset.returnRequests.filter((r) => r.anomaly?.type === "contradictory_review").length,
    };

    console.log(`Generated dataset in ${elapsed}ms:`);
    console.log(
      `  catalog:             ${dataset.categories.length} categories, ${dataset.brands.length} brands, ${dataset.suppliers.length} suppliers, ${dataset.products.length} products`
    );
    console.log(`  users:               ${dataset.users.length}`);
    console.log(`  carts:               ${dataset.carts.length}`);
    console.log(`  abandonedCheckouts:  ${dataset.abandonedCheckouts.length}`);
    console.log(`  orders:              ${dataset.orders.length}`);
    console.log(`  shipments:           ${dataset.shipments.length}`);
    console.log(`  returnRequests:      ${dataset.returnRequests.length}`);
    if (dataset.config.recommendationData.enabled) {
      console.log(
        `  recommendationData:  ${dataset.productViews.length} views, ${dataset.searchQueries.length} searches, ${dataset.wishlistItems.length} wishlisted, ${dataset.productRatings.length} ratings`
      );
    }
    if (dataset.config.inventorySimulation.enabled) {
      console.log(
        `  inventorySimulation: ${dataset.warehouses.length} warehouses, ${dataset.replenishmentOrders.length} replenishments, ${dataset.stockoutPeriods.length} stockouts, ${dataset.warehouseTransfers.length} transfers`
      );
    }
    console.log(
      `  anomalies:           ${anomalyCounts.botCarts} bot carts, ${anomalyCounts.remoteShippingOrders} remote-shipping, ${anomalyCounts.contradictoryReturns} contradictory returns`
    );
    if (fraudSummary) {
      const total = Object.values(fraudSummary).reduce((a, b) => a + b, 0);
      const breakdown = Object.entries(fraudSummary)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `${count} ${type}`)
        .join(", ");
      console.log(`  fraud:               ${total} order(s) flagged${breakdown ? ` (${breakdown})` : ""} (JSON output only, not in SQL/CSV)`);
    }
    console.log(`Written to ${outputPath} (${format})`);
  });

program
  .command("replay")
  .description("Regenerate a byte-identical dataset from a .snapshot.json recipe saved by `generate --snapshot`.")
  .requiredOption("-i, --input <path>", "path to the .snapshot.json file")
  .option("-f, --format <format>", "output format: json | sql | csv", "json")
  .option("-o, --output <path>", "output file path", "./eco-data-replay.json")
  .action((opts) => {
    const snapshotPath = path.resolve(process.cwd(), opts.input);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8")) as Snapshot;

    const format = opts.format as OutputFormat;
    if (!["json", "sql", "csv"].includes(format)) {
      console.error(`Unsupported format "${opts.format}". Use json, sql, or csv.`);
      process.exit(1);
    }

    const dataset = generate(snapshot.config, snapshot.referenceNow);
    const serialized = serialize(dataset, format);

    const outputPath = path.resolve(process.cwd(), opts.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf-8");

    console.log(`Replayed snapshot from ${snapshotPath} (recorded ${snapshot.meta.createdAt})`);
    console.log(
      `  seed=${snapshot.config.seed ?? "default"}, referenceNow=${new Date(snapshot.referenceNow).toISOString()}`
    );
    console.log(`  users: ${dataset.users.length}, orders: ${dataset.orders.length}, shipments: ${dataset.shipments.length}`);
    console.log(`Written to ${outputPath} (${format}) -- byte-identical to the original run.`);
  });

program
  .command("init")
  .description(
    "Introspect an existing schema (Prisma, Drizzle, SQLAlchemy, or a live/local OpenAPI spec) and auto-generate a mapping.json (canonical column -> your column names)."
  )
  .requiredOption(
    "--schema <path-or-url>",
    "path to a .prisma, Drizzle (.ts/.js), or SQLAlchemy (.py) schema file -- or, with --schema-type openapi, a local .json file or a live http(s):// URL (e.g. your own API's /openapi.json)"
  )
  .option("--schema-type <type>", "prisma | drizzle | sqlalchemy | openapi (default: auto-detect from file extension)")
  .option("-o, --output <path>", "where to write the mapping file", "./mapping.json")
  .option("--tables <list>", "comma-separated subset of tables to map (default: all six)")
  .action(async (opts) => {
    const isUrl = /^https?:\/\//.test(opts.schema);
    const schemaType = opts.schemaType ?? (isUrl ? "openapi" : detectSchemaType(opts.schema));

    let parsed: { models: Record<string, string[]> } | null = null;
    try {
      if (schemaType === "openapi" && isUrl) {
        parsed = await fetchAndParseOpenApiSchema(opts.schema);
      } else if (schemaType === "openapi") {
        const source = readFileSync(path.resolve(process.cwd(), opts.schema), "utf-8");
        parsed = parseOpenApiSchema(source);
      } else if (!isUrl) {
        const schemaPath = path.resolve(process.cwd(), opts.schema);
        const schemaSource = readFileSync(schemaPath, "utf-8");
        parsed =
          schemaType === "prisma"
            ? parsePrismaSchema(schemaSource)
            : schemaType === "drizzle"
            ? parseDrizzleSchema(schemaSource)
            : schemaType === "sqlalchemy"
            ? parseSqlAlchemySchema(schemaSource)
            : null;
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
      return;
    }

    if (!parsed) {
      console.error(
        isUrl
          ? `A URL was given for --schema but --schema-type is "${schemaType}", not "openapi" -- only OpenAPI specs can be fetched from a URL.`
          : `Unrecognized --schema-type "${schemaType}". Use prisma, drizzle, sqlalchemy, or openapi.`
      );
      process.exit(1);
      return;
    }

    const modelCount = Object.keys(parsed.models).length;
    if (modelCount === 0) {
      console.error(`No models/tables found in ${opts.schema} (parsed as ${schemaType}) -- is this a valid schema?`);
      process.exit(1);
    }

    const tables = opts.tables ? (opts.tables as string).split(",").map((t) => t.trim()) : undefined;
    const mapping = buildSchemaMapping(parsed, tables);

    const outputPath = path.resolve(process.cwd(), opts.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(mapping, null, 2), "utf-8");

    console.log(`Parsed ${modelCount} model(s)/schema(s) from ${opts.schema} (${schemaType}).`);
    for (const [table, tableMapping] of Object.entries(mapping)) {
      if (!tableMapping.targetModel) {
        console.log(`  ${table}: no matching model found -- left unmapped (canonical names kept).`);
        continue;
      }
      const columns = Object.values(tableMapping.columns);
      const confident = columns.filter((c) => c.confidence >= 0.4).length;
      console.log(`  ${table} -> ${tableMapping.targetModel}: ${confident}/${columns.length} columns confidently mapped`);
    }
    console.log(`\nReview and edit ${outputPath}, then run:`);
    console.log(`  my-eco-gen generate --mapping ${opts.output} --format sql --output ./seed.sql`);
  });

program
  .command("scenarios")
  .description("List available --scenario presets and their key config values.")
  .action(() => {
    for (const [name, config] of Object.entries(SCENARIOS)) {
      console.log(`${name}`);
      for (const [key, value] of Object.entries(config)) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      }
      console.log("");
    }
  });

addCoreGenerateOptions(
  program
    .command("serve")
    .description(
      "Spin up a mock REST API (json-server style) backed by a generated dataset -- build/demo a frontend against a realistic backend."
    )
)
  .option("-p, --port <number>", "port to listen on", parseIntArg, 4000)
  .option("--chaos", "inject random latency spikes, 500s, and 429s into every /api/* response")
  .option("--chaos-latency-rate <number>", "0..1 chance of injected latency (with --chaos)", parseFloatArg)
  .option("--chaos-error-rate <number>", "0..1 chance of a simulated 500 (with --chaos)", parseFloatArg)
  .option("--chaos-rate-limit-rate <number>", "0..1 chance of a simulated 429 (with --chaos)", parseFloatArg)
  .option("--api-key <key>", "require `Authorization: Bearer <key>` on every /api/* request")
  .option("--no-openapi", "don't serve GET /openapi.json")
  .option("--postman", "serve GET /postman.json and write a .postman_collection.json file to disk at startup")
  .option("--graphql", "mount POST /graphql, executing queries against the same dataset via the GraphQL adapter (requires the optional 'graphql' package)")
  .option("--postman-output <path>", "where to write the Postman collection file", "./eco-faker.postman_collection.json")
  .option("--live", "also open a WebSocket at /live broadcasting a steady drip of dataset events")
  .option("--live-interval-ms <number>", "ms between live broadcasts", parseIntArg, 800)
  .option("--quiet", "suppress the per-request console log line (meaning header is still sent)")
  .action((opts) => {
    const overrides = resolveOverrides(opts);
    const referenceNow = Date.now();

    console.error("Generating dataset...");
    const start = performance.now();
    const dataset = generate(overrides, referenceNow);
    const elapsed = (performance.now() - start).toFixed(1);
    console.error(
      `Ready in ${elapsed}ms: ${dataset.users.length} users, ${dataset.orders.length} orders, ${dataset.shipments.length} shipments, ${dataset.returnRequests.length} returns.`
    );

    const port = opts.port as number;
    const chaos = opts.chaos
      ? {
          ...(opts.chaosLatencyRate !== undefined ? { latencyRate: opts.chaosLatencyRate as number } : {}),
          ...(opts.chaosErrorRate !== undefined ? { errorRate: opts.chaosErrorRate as number } : {}),
          ...(opts.chaosRateLimitRate !== undefined ? { rateLimitRate: opts.chaosRateLimitRate as number } : {}),
        }
      : undefined;

    const app = createMockApiServer(dataset, {
      chaos: chaos && Object.keys(chaos).length > 0 ? chaos : opts.chaos ? true : undefined,
      apiKey: opts.apiKey,
      openapi: opts.openapi !== false,
      postman: Boolean(opts.postman),
      graphql: Boolean(opts.graphql),
      quiet: Boolean(opts.quiet),
      port,
    });

    if (opts.postman) {
      const collection = buildPostmanCollection({ port, apiKey: opts.apiKey });
      const postmanPath = path.resolve(process.cwd(), opts.postmanOutput);
      mkdirSync(path.dirname(postmanPath), { recursive: true });
      writeFileSync(postmanPath, JSON.stringify(collection, null, 2), "utf-8");
      console.error(`Postman collection written to ${postmanPath}`);
    }

    const server = app.listen(port, () => {
      console.log(`Mock API running at http://localhost:${port}`);
      console.log(`  GET http://localhost:${port}/api/orders?status=delivered&page=1&pageSize=25`);
      console.log(`  GET http://localhost:${port}/api/shipments/:id`);
      console.log(`  GET http://localhost:${port}/  (endpoint list + counts)`);
      if (opts.openapi !== false) console.log(`  GET http://localhost:${port}/openapi.json  (import into Postman/Insomnia/Swagger UI)`);
      if (opts.postman) console.log(`  GET http://localhost:${port}/postman.json  (or import ${opts.postmanOutput} directly)`);
      if (opts.chaos) console.log(`  chaos mode ON: latency/500/429 injected into /api/* responses`);
      if (opts.apiKey) console.log(`  auth ON: send "Authorization: Bearer ${opts.apiKey}" or every /api/* request gets a 401`);
      if (opts.live) console.log(`  live feed: ws://localhost:${port}/live`);
      if (!opts.quiet) console.log(`  request log ON: plain-English status meanings printed per request (--quiet to silence)`);
    });

    if (opts.live) {
      attachLiveFeed(server, overrides, referenceNow, { intervalMs: opts.liveIntervalMs as number });
    }
  });

addCoreGenerateOptions(
  program
    .command("webhook")
    .description(
      "Replay the generated dataset as a paced, chronological stream of webhook events POSTed to a URL (or printed with --dry-run)."
    )
)
  .requiredOption("--url <url>", "URL to POST each event to as JSON (ignored with --dry-run)")
  .option("--speed <number>", "simulated seconds of dataset time per real second (higher = faster)", parseFloatArg, 3600)
  .option("--max-wait-ms <number>", "cap on the real-world wait between any two events, in ms", parseIntArg, 5000)
  .option("--events <list>", "comma-separated event types to emit (default: all)")
  .option("--limit <number>", "stop after N events", parseIntArg)
  .option("--dry-run", "print events instead of POSTing them")
  .action(async (opts) => {
    const overrides = resolveOverrides(opts);
    const referenceNow = Date.now();

    console.error("Building event timeline...");
    const events = buildWebhookEvents(overrides, referenceNow);
    console.error(`${events.length} events spanning the dataset's history. Replaying at ${opts.speed}x speed...`);

    const eventTypes = opts.events ? new Set((opts.events as string).split(",").map((t) => t.trim())) : undefined;

    let posted = 0;
    let failed = 0;
    const total = await replayEvents(
      events,
      { speed: opts.speed as number, maxWaitMs: opts.maxWaitMs as number, eventTypes, limit: opts.limit as number | undefined },
      async (event, index, count) => {
        if (opts.dryRun) {
          console.log(`[${index + 1}/${count}] ${event.timestamp} ${event.type}`);
          return;
        }
        try {
          const res = await fetch(opts.url as string, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
          });
          if (res.ok) posted++;
          else failed++;
          console.error(`[${index + 1}/${count}] ${event.type} -> ${res.status}`);
        } catch (err) {
          failed++;
          console.error(`[${index + 1}/${count}] ${event.type} -> FAILED: ${(err as Error).message}`);
        }
      }
    );

    console.error(
      opts.dryRun
        ? `Dry run complete: ${total} events.`
        : `Done: ${total} events replayed, ${posted} succeeded, ${failed} failed.`
    );
  });

program
  .command("diff")
  .description(
    "Structurally diff two datasets (from `generate --format json`) or snapshot recipes (from `generate --snapshot`): row counts, schema drift, status-distribution shifts."
  )
  .argument("<fileA>", "first dataset.json or snapshot.json")
  .argument("<fileB>", "second dataset.json or snapshot.json")
  .option("--fail-on-schema-change", "exit with code 1 if any table's field set differs between A and B")
  .action((fileA: string, fileB: string, opts) => {
    const a = loadDatasetLike(path.resolve(process.cwd(), fileA));
    const b = loadDatasetLike(path.resolve(process.cwd(), fileB));
    const report = diffDatasets(a, b);

    console.log(formatDiffReport(report, fileA, fileB));

    if (opts.failOnSchemaChange && report.hasSchemaChanges) {
      console.error("\nSchema drift detected -- failing as requested by --fail-on-schema-change.");
      process.exit(1);
    }
  });

addCoreGenerateOptions(
  program
    .command("fuzz")
    .description(
      "Semantic fuzzing: mutate a dataset with data that's schema-valid but logically impossible (mismatched addresses, inverted prices, time-paradox returns, oversell quantities) -- finds business-logic bugs schema validation can't catch."
    )
)
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("--intensity <level>", "low | medium | extreme", "medium")
  .option(
    "--types <list>",
    "comma-separated subset of: address_mismatch,price_inversion,time_paradox,inventory_oversell (default: all four)"
  )
  .option("--fuzz-seed <number>", "seed for reproducible mutation selection", parseIntArg, 1)
  .option("-o, --output <path>", "where to write the mutated dataset", "./eco-data.fuzzed.json")
  .option("--report <path>", "also write the mutation log as JSON to this path")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const types = opts.types
      ? ((opts.types as string).split(",").map((s) => s.trim()) as FuzzMutationType[])
      : undefined;

    const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
      intensity: opts.intensity as "low" | "medium" | "extreme",
      types,
      seed: opts.fuzzSeed as number,
    });

    const outputPath = path.resolve(process.cwd(), opts.output as string);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(mutated, null, 2), "utf-8");

    const summary = summarizeMutations(mutations);
    console.log(`Applied ${mutations.length} semantic mutation(s):`);
    for (const [type, count] of Object.entries(summary)) {
      if (count > 0) console.log(`  ${type}: ${count}`);
    }
    console.log("");
    for (const m of mutations) {
      console.log(`  [${m.type}] ${m.table}/${m.recordId}.${m.field}`);
      console.log(`    ${JSON.stringify(m.before)} -> ${JSON.stringify(m.after)}`);
      console.log(`    ${m.reason}`);
    }
    console.log(`\nMutated dataset written to ${outputPath}`);

    if (opts.report) {
      const reportPath = path.resolve(process.cwd(), opts.report as string);
      writeFileSync(reportPath, JSON.stringify({ mutations, summary }, null, 2), "utf-8");
      console.log(`Mutation report written to ${reportPath}`);
    }

    console.log(
      `\nNote: this mutates data only -- firing these payloads at a live API and asserting on the response is planned for the contract-testing engine ("my-eco-gen test --contract"), which isn't built yet. For now, feed ${path.basename(outputPath)} into your own seed/insert pipeline (or "my-eco-gen lint --input ${path.basename(outputPath)}") and see what breaks.`
    );
  });

addCoreGenerateOptions(
  program
    .command("lint")
    .description(
      "Pre-flight data quality gate: check a dataset for orphaned foreign keys, duplicate ids/emails, and financial/temporal inconsistencies -- entirely offline, no database required."
    )
)
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("--sql <path>", "also dry-run this .sql file against a real Postgres database inside BEGIN/ROLLBACK (requires --db-url and the optional 'pg' package)")
  .option("--db-url <url>", "Postgres connection string for --sql (never committed to -- always rolled back)")
  .action(async (opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const issues = lintDataset(dataset);

    if (issues.length === 0) {
      console.log("ok: no lint issues found (referential integrity, uniqueness, financial/temporal consistency).");
    } else {
      const errors = issues.filter((i) => i.severity === "error");
      const warnings = issues.filter((i) => i.severity === "warning");
      for (const issue of issues) {
        const prefix = issue.severity === "error" ? "error" : "warning";
        const location = issue.recordId ? `${issue.table}/${issue.recordId}` : issue.table;
        console.log(`${prefix}: [${issue.rule}] ${location}: ${issue.message}`);
      }
      console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
    }

    if (opts.sql) {
      if (!opts.dbUrl) {
        console.error("\n--sql requires --db-url.");
        process.exit(1);
      }
      const sql = readFileSync(path.resolve(process.cwd(), opts.sql as string), "utf-8");
      console.log(`\nDry-running ${opts.sql} against ${opts.dbUrl} inside BEGIN/ROLLBACK...`);
      try {
        const result = await lintSqlAgainstDatabase(sql, opts.dbUrl as string);
        if (result.ok) {
          console.log("ok: SQL applied cleanly against the real schema's constraints (then rolled back).");
        } else {
          console.log(`error: the database rejected the SQL: ${result.error}`);
          process.exit(1);
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    }

    if (issues.some((i) => i.severity === "error")) {
      process.exit(1);
    }
  });

addCoreGenerateOptions(
  program
    .command("visualize")
    .description(
      "Render one customer's full journey (signup -> cart -> order -> shipments -> returns) as a self-contained, animated HTML timeline (D3, opens directly in a browser)."
    )
)
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("--user <id>", "user id to visualize (default: the user with the richest journey)")
  .option("-o, --output <path>", "output HTML path", "./journey.html")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const userId = (opts.user as string | undefined) ?? pickRichestUserId(dataset);
    const user = dataset.users.find((u) => u.id === userId);
    if (!user) {
      console.error(`No user with id "${userId}" in this dataset.`);
      process.exit(1);
    }

    const events = buildUserJourney(dataset, userId);
    const html = renderJourneyHtml(user, events);

    const outputPath = path.resolve(process.cwd(), opts.output as string);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, html, "utf-8");

    console.log(`${user.firstName} ${user.lastName} (${userId}): ${events.length} events.`);
    console.log(`Journey timeline written to ${outputPath} -- open it directly in a browser.`);
  });

program
  .command("dashboard")
  .description(
    "Compute analytics (daily revenue, conversion funnel, retention cohorts, customer LTV, CAC) from a dataset and export it for a BI tool -- entirely offline, no database or API keys required."
  )
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("-f, --format <format>", "output format: csv | sql | json", "csv")
  .option(
    "-o, --output <path>",
    "output path -- a directory for --format csv (one file per table), a single file otherwise (default: ./dashboard/ or ./dashboard.sql / ./dashboard.json)"
  )
  .option(
    "--marketing-spend <number>",
    "assumed total marketing spend for the CAC calculation -- this is the one figure this dataset has nothing else to derive it from, so it's a plain configurable assumption rather than a hidden one (default: 5000)",
    parseFloatArg
  )
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const report = computeAnalytics(dataset, {
      assumedMonthlyMarketingSpend: opts.marketingSpend as number | undefined,
    });
    const format = (opts.format as string) ?? "csv";

    if (format === "csv") {
      const files = analyticsToCsvFiles(report);
      const outputDir = path.resolve(process.cwd(), (opts.output as string) ?? "./dashboard");
      mkdirSync(outputDir, { recursive: true });
      for (const [filename, content] of Object.entries(files)) {
        writeFileSync(path.join(outputDir, filename), content, "utf-8");
      }
      console.log(`Written ${Object.keys(files).length} CSV files to ${outputDir}/`);
      console.log("Import directly: PowerBI (Get Data > Text/CSV), Excel, or Google Sheets.");
    } else if (format === "sql") {
      const sql = analyticsToSql(report);
      const outputPath = path.resolve(process.cwd(), (opts.output as string) ?? "./dashboard.sql");
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, sql, "utf-8");
      console.log(`Written to ${outputPath}`);
      console.log(
        "Load into a real Postgres database, then point Metabase or Superset at it -- neither tool has a native static seed-file format; both build questions/dashboards against a live database connection."
      );
    } else if (format === "json") {
      const outputPath = path.resolve(process.cwd(), (opts.output as string) ?? "./dashboard.json");
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8");
      console.log(`Written to ${outputPath}`);
    } else {
      console.error(`Unknown --format "${format}". Use csv, sql, or json.`);
      process.exit(1);
      return;
    }

    console.log(
      `\n${report.ltvSummary.totalCustomers} customers, ${report.ltvSummary.payingCustomers} paying, ` +
        `avg LTV $${report.ltvSummary.averageLTV}, CAC $${report.cac.cac} ` +
        `(assuming $${report.cac.assumedMonthlyMarketingSpend} spend / ${report.cac.newCustomersAcquired} new customers -- override with --marketing-spend).`
    );
  });

program
  .command("benchmark-export")
  .description(
    "Export a dataset for benchmarking Elasticsearch or ClickHouse. Postgres is already covered by `generate --format sql` or `--format csv` + `\\copy`; ClickHouse ingests that same CSV output natively (`FORMAT CSVWithNames`), so this command's ClickHouse target is DDL only, not a second copy of the data in a new format."
  )
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .requiredOption("--target <target>", "elasticsearch | clickhouse")
  .option("-o, --output <path>", "output directory (default: ./benchmark-export/)")
  .option("--index-prefix <prefix>", "Elasticsearch index name prefix (default: eco-faker)", "eco-faker")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    const outputDir = path.resolve(process.cwd(), (opts.output as string) ?? "./benchmark-export");
    mkdirSync(outputDir, { recursive: true });

    if (opts.target === "elasticsearch") {
      const mappings = generateElasticsearchMappings(dataset);
      const bulk = generateElasticsearchBulkNdjson(dataset, opts.indexPrefix as string);
      let mappingCount = 0;
      let bulkCount = 0;
      for (const [table, mapping] of Object.entries(mappings)) {
        writeFileSync(path.join(outputDir, `${table}.mapping.json`), JSON.stringify(mapping, null, 2), "utf-8");
        mappingCount++;
      }
      for (const [table, content] of Object.entries(bulk)) {
        if (content === "") continue;
        writeFileSync(path.join(outputDir, `${table}.bulk.ndjson`), content, "utf-8");
        bulkCount++;
      }
      console.log(`Written ${mappingCount} index mappings and ${bulkCount} bulk NDJSON files to ${outputDir}/`);
      console.log(
        `Load with, e.g.: curl -s -H "Content-Type: application/json" -XPUT localhost:9200/${opts.indexPrefix}-orders -d @${outputDir}/orders.mapping.json`
      );
      console.log(`Then bulk-index: curl -s -H "Content-Type: application/x-ndjson" -XPOST localhost:9200/_bulk --data-binary @${outputDir}/orders.bulk.ndjson`);
    } else if (opts.target === "clickhouse") {
      const ddl = generateClickHouseDdl(dataset);
      const ddlPath = path.join(outputDir, "schema.sql");
      writeFileSync(ddlPath, ddl, "utf-8");
      console.log(`Written ClickHouse DDL to ${ddlPath}`);
      console.log(
        "Data itself isn't duplicated here -- ClickHouse ingests the existing CSV output natively. Generate it, then load each table:"
      );
      console.log("  my-eco-gen generate --format csv --output ./eco-data.csv");
      console.log('  clickhouse-client --query "INSERT INTO orders FORMAT CSVWithNames" < orders.csv   # (split the combined CSV per table first)');
    } else {
      console.error(`Unknown --target "${opts.target}". Use elasticsearch or clickhouse.`);
      process.exit(1);
      return;
    }
  });

program
  .command("events")
  .description(
    "Build a comprehensive, chronologically-ordered event stream from a dataset -- user.created, cart.item_added, order.created, shipment.delivered, product.viewed, replenishment.received, and more, across all 18 tables. Every event carries aggregateId/aggregateType for real event-sourcing replay, not just a flat webhook-style list (see the `webhook` command for real-time-paced delivery to a URL instead)."
  )
  .option("--input <path>", "load an existing dataset.json instead of generating a fresh one")
  .option("-f, --format <format>", "output format: ndjson | json", "ndjson")
  .option("-o, --output <path>", "output file path (default: ./events.ndjson or ./events.json)")
  .option("--event-types <list>", "comma-separated event types to include (default: all)")
  .action((opts) => {
    const dataset = loadOrGenerateDataset(opts);
    let events = buildEventStream(dataset);

    if (opts.eventTypes) {
      const wanted = new Set((opts.eventTypes as string).split(",").map((t) => t.trim()));
      events = events.filter((e) => wanted.has(e.type));
    }

    const format = (opts.format as string) ?? "ndjson";
    const outputPath = path.resolve(
      process.cwd(),
      (opts.output as string) ?? (format === "json" ? "./events.json" : "./events.ndjson")
    );
    mkdirSync(path.dirname(outputPath), { recursive: true });

    if (format === "ndjson") {
      writeFileSync(outputPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    } else if (format === "json") {
      writeFileSync(outputPath, JSON.stringify(events, null, 2), "utf-8");
    } else {
      console.error(`Unknown --format "${format}". Use ndjson or json.`);
      process.exit(1);
      return;
    }

    const byType = new Map<string, number>();
    for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    console.log(`Written ${events.length} events (${byType.size} event types) to ${outputPath}`);
  });

program
  .command("mcp")
  .description(
    "Run eco-faker as an MCP server over stdio -- exposes generate_dataset, query_table, fuzz_dataset, fraud_simulate, compute_analytics, build_event_stream, lint_dataset, visualize_journey, and list_scenarios as tools an MCP client (Claude Desktop, Claude Code, etc.) can call directly. See README's \"MCP server\" section for client config."
  )
  .action(async () => {
    await runMcpServer();
  });

program.parse();

function detectSchemaType(schemaPath: string): "prisma" | "drizzle" | "sqlalchemy" | "openapi" | undefined {
  if (schemaPath.endsWith(".prisma")) return "prisma";
  if (schemaPath.endsWith(".py")) return "sqlalchemy";
  if (schemaPath.endsWith(".ts") || schemaPath.endsWith(".js")) return "drizzle";
  if (schemaPath.endsWith(".json")) return "openapi";
  return undefined;
}

function buildOverridesFromGenerateOpts(opts: Record<string, unknown>): Partial<EcoFakerConfig> {
  const overrides: Partial<EcoFakerConfig> = {};
  if (opts.users !== undefined) overrides.scaleFactor = opts.users as number;
  if (opts.seed !== undefined) overrides.seed = opts.seed as number;
  if (opts.locale !== undefined) overrides.locale = opts.locale as Locale;
  if (opts.historicalDays !== undefined) overrides.historicalDays = opts.historicalDays as number;
  if (opts.abandonmentRate !== undefined) overrides.abandonmentRate = opts.abandonmentRate as number;
  if (opts.returnRate !== undefined) overrides.returnRate = opts.returnRate as number;
  if (opts.delayProbability !== undefined) overrides.delayProbability = opts.delayProbability as number;
  if (opts.maxDelayDays !== undefined) overrides.maxDelayDays = opts.maxDelayDays as number;
  if (opts.catalogSize !== undefined) overrides.catalogSize = opts.catalogSize as number;

  const anomalies: Partial<EcoFakerConfig["anomalies"]> = {};
  if (opts.anomalies === false) anomalies.enabled = false;
  if (opts.botCartRate !== undefined) anomalies.botCartRate = opts.botCartRate as number;
  if (opts.remoteShippingRate !== undefined) anomalies.remoteShippingRate = opts.remoteShippingRate as number;
  if (opts.contradictoryReturnRate !== undefined) anomalies.contradictoryReturnRate = opts.contradictoryReturnRate as number;
  if (Object.keys(anomalies).length > 0) {
    overrides.anomalies = anomalies as EcoFakerConfig["anomalies"];
  }
  if (opts.recommendationData === false) {
    overrides.recommendationData = { enabled: false };
  }
  if (opts.inventorySimulation === false) {
    overrides.inventorySimulation = { enabled: false };
  }

  return overrides;
}

/**
 * High-volume stream mode: emits one NDJSON line per record the instant
 * it's produced, honoring stdout backpressure (awaiting 'drain' when
 * write() reports its buffer is full) rather than buffering the whole
 * dataset in memory first. Suitable for piping directly into
 * `kafka-console-producer`, a bulk-insert script, or a data lake ingester:
 *
 *   my-eco-gen generate --users 100000 --stream | kafka-console-producer ...
 */
async function streamToStdout(overrides: Partial<EcoFakerConfig>, referenceNow: number): Promise<void> {
  let count = 0;
  for (const { table, record } of generateRecords(overrides, referenceNow)) {
    const line = JSON.stringify({ table, ...record }) + "\n";
    const canContinue = process.stdout.write(line);
    if (!canContinue) {
      await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
    }
    count++;
  }
  console.error(`Streamed ${count} records to stdout.`);
}

function parseIntArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new Error(`Expected an integer, got "${value}"`);
  return parsed;
}

function parseFloatArg(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) throw new Error(`Expected a number, got "${value}"`);
  return parsed;
}

